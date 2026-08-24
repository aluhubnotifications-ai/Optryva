import { Router } from '@/lib/http'
import { sb, must, j } from '@/db'
import { requireAuth } from '@/lib/auth'
import { uid, now } from '@/lib/util'

export const onboarding = Router()
onboarding.use(requireAuth)

// Get onboarding progress for current user
onboarding.get('/progress', async (req, res) => {
  const progress = must(await sb
    .from('onboarding_progress')
    .select('*')
    .eq('account_id', req.user!.id)
    .maybeSingle())
  res.json(progress ?? {
    account_id: req.user!.id,
    role: 'student',
    current_step: 1,
    completed_steps: 0,
    skipped_steps: '[]',
    updated_at: now(),
  })
})

// Update onboarding progress (autosave)
const progressSchema = {
  current_step: 'number',
  completed_steps: 'number',
  skipped_steps: 'string', // JSON array
  step_data: 'object', // flexible step data
}

onboarding.patch('/progress', async (req, res) => {
  const body = req.body ?? {}
  const { current_step, completed_steps, skipped_steps, step_data } = body
  
  const update: Record<string, any> = { updated_at: now() }
  if (typeof current_step === 'number') update.current_step = current_step
  if (typeof completed_steps === 'number') update.completed_steps = completed_steps
  if (typeof skipped_steps === 'string') update.skipped_steps = skipped_steps
  if (step_data) update.step_data = j.stringify(step_data)
  
  // If all steps completed, mark completed_at
  if (completed_steps >= 5) update.completed_at = now()
  
  must(await sb.from('onboarding_progress').upsert({
    account_id: req.user!.id,
    ...update,
  }, { onConflict: 'account_id' }))
  
  res.json({ ok: true })
})

// Save step 1: Career direction
onboarding.post('/step/career-direction', async (req, res) => {
  const { direction, custom_direction } = req.body ?? {}
  if (!direction && !custom_direction) return res.status(400).json({ error: 'missing_direction' })
  
  const id = req.user!.id
  const ts = now()
  const name = custom_direction || direction
  
  // Create or update first resume profile with this direction
  const existing = await sb.from('resume_profiles').select('id').eq('student_id', id).maybeSingle()
  
  if (existing.data?.length) {
    must(await sb.from('resume_profiles').update({
      name,
      target_roles: j.stringify([direction].filter(Boolean)),
      updated_at: ts,
    }).eq('student_id', id))
  } else {
    must(await sb.from('resume_profiles').insert({
      id: uid('rp'),
      student_id: id,
      name,
      target_roles: j.stringify([direction].filter(Boolean)),
      preferred_industries: '[]',
      pref_countries: '[]',
      pref_listing_types: '[]',
      skills: '[]',
      work_type: 'any',
      active: 1,
      created_at: ts,
      updated_at: ts,
    }))
  }
  
  // Update onboarding progress
  must(await sb.from('onboarding_progress').upsert({
    account_id: id,
    role: 'student',
    current_step: 2,
    completed_steps: 1,
    skipped_steps: '[]',
    updated_at: ts,
  }, { onConflict: 'account_id' }))
  
  res.json({ ok: true })
})

// Save step 2: Résumé
onboarding.post('/step/resume', async (req, res) => {
  const { cv_text, cv_url, cv_filename } = req.body ?? {}
  if (!cv_text?.trim() && !cv_url) return res.status(400).json({ error: 'missing_resume' })
  
  const id = req.user!.id
  const ts = now()
  
  const update: Record<string, any> = { updated_at: ts }
  if (cv_text?.trim()) update.cv_text = cv_text.trim()
  if (cv_url) update.cv_url = cv_url
  if (cv_filename) update.cv_filename = cv_filename
  if (cv_url) update.cv_uploaded_at = ts
  
  must(await sb.from('profiles').update(update).eq('id', id))
  
  // Update onboarding progress
  must(await sb.from('onboarding_progress').upsert({
    account_id: id,
    role: 'student',
    current_step: 3,
    completed_steps: 2,
    skipped_steps: '[]',
    updated_at: ts,
  }, { onConflict: 'account_id' }))
  
  res.json({ ok: true })
})

// Save step 3: Evidence
onboarding.post('/step/evidence', async (req, res) => {
  const { evidence_ids } = req.body ?? {} // array of evidence item IDs
  const ids = Array.isArray(evidence_ids) ? evidence_ids : []
  
  const id = req.user!.id
  const ts = now()
  
  // Update resume profile with selected evidence
  must(await sb.from('resume_profiles').update({
    selected_evidence_ids: j.stringify(ids),
    updated_at: ts,
  }).eq('student_id', id))
  
  // Update onboarding progress
  must(await sb.from('onboarding_progress').upsert({
    account_id: id,
    role: 'student',
    current_step: 4,
    completed_steps: 3,
    skipped_steps: '[]',
    updated_at: ts,
  }, { onConflict: 'account_id' }))
  
  res.json({ ok: true })
})

// Save step 4: Preferences
onboarding.post('/step/preferences', async (req, res) => {
  const {
    target_roles,
    industries,
    locations,
    work_modes,
    opportunity_types,
    availability_start,
    availability_end,
    availability_hours,
    academic_schedule,
    compensation_paid_only,
    compensation_stipend_ok,
    compensation_unpaid_ok,
    compensation_min_amount,
    work_authorization,
    excluded_roles,
    excluded_countries,
    excluded_industries,
    excluded_schedules,
  } = req.body ?? {}
  
  const id = req.user!.id
  const ts = now()
  
  // Create preference profile
  const prefId = uid('pp')
  must(await sb.from('preference_profiles').insert({
    id: prefId,
    student_id: id,
    target_roles: j.stringify(target_roles ?? []),
    industries: j.stringify(industries ?? []),
    locations: j.stringify(locations ?? []),
    work_modes: j.stringify(work_modes ?? []),
    opportunity_types: j.stringify(opportunity_types ?? []),
    availability_start,
    availability_end,
    availability_hours,
    academic_schedule,
    compensation_paid_only: compensation_paid_only ? 1 : 0,
    compensation_stipend_ok: compensation_stipend_ok ? 1 : 0,
    compensation_unpaid_ok: compensation_unpaid_ok ? 1 : 0,
    compensation_min_amount,
    work_authorization: j.stringify(work_authorization ?? []),
    excluded_roles: j.stringify(excluded_roles ?? []),
    excluded_countries: j.stringify(excluded_countries ?? []),
    excluded_industries: j.stringify(excluded_industries ?? []),
    excluded_schedules: j.stringify(excluded_schedules ?? []),
    created_at: ts,
    updated_at: ts,
  }))
  
  // Link to resume profile
  must(await sb.from('resume_profiles').update({
    preference_profile_id: prefId,
    updated_at: ts,
  }).eq('student_id', id))
  
  // Also sync to profile for backward compatibility
  must(await sb.from('profiles').update({
    desired_roles: j.stringify(target_roles ?? []),
    preferred_industries: j.stringify(industries ?? []),
    pref_countries: j.stringify(locations ?? []),
    pref_listing_types: j.stringify(opportunity_types ?? []),
    work_type: work_modes?.[0] ?? 'any',
    updated_at: ts,
  }).eq('id', id))
  
  // Update onboarding progress
  must(await sb.from('onboarding_progress').upsert({
    account_id: id,
    role: 'student',
    current_step: 5,
    completed_steps: 4,
    skipped_steps: '[]',
    updated_at: ts,
  }, { onConflict: 'account_id' }))
  
  res.json({ ok: true })
})

// Save step 5: Privacy & AI controls
onboarding.post('/step/privacy', async (req, res) => {
  const {
    profile_private,
    discoverable,
    ai_recommendations,
    evidence_reuse,
    university_access,
    notifications,
  } = req.body ?? {}
  
  const id = req.user!.id
  const ts = now()
  const version = '1'
  
  // Save consents
  const consents = [
    { consent_type: 'profile_visibility', granted: !profile_private && discoverable ? 1 : 0 },
    { consent_type: 'ai_recommendations', granted: ai_recommendations ? 1 : 0 },
    { consent_type: 'evidence_reuse', granted: evidence_reuse ? 1 : 0 },
    { consent_type: 'university_access', granted: university_access ? 1 : 0 },
    { consent_type: 'notifications', granted: notifications ? 1 : 0 },
  ]
  
  for (const c of consents) {
    await sb.from('consents').upsert({
      id: uid('c'),
      account_id: id,
      consent_type: c.consent_type,
      version,
      granted: c.granted,
      granted_at: c.granted ? ts : null,
      withdrawn_at: c.granted ? null : ts,
    }, { onConflict: 'account_id,consent_type,version' })
  }
  
  // Update resume profile visibility
  const visibility = profile_private ? 'private' : (discoverable ? 'discoverable' : 'private')
  await sb.from('resume_profiles').update({
    visibility,
    updated_at: ts,
  }).eq('student_id', id)
  
  // Update onboarding progress - COMPLETE
  must(await sb.from('onboarding_progress').upsert({
    account_id: id,
    role: 'student',
    current_step: 5,
    completed_steps: 5,
    skipped_steps: '[]',
    completed_at: ts,
    updated_at: ts,
  }, { onConflict: 'account_id' }))
  
  // Invalidate match cache so fresh matches run
  must(await sb.from('ai_match_cache').update({ stale: 1 }).eq('student_id', id))
  
  res.json({ ok: true, complete: true })
})

// Skip a step
onboarding.post('/skip-step', async (req, res) => {
  const { step } = req.body ?? {}
  if (!step) return res.status(400).json({ error: 'missing_step' })
  
  const id = req.user!.id
  const ts = now()
  
  const progress = must(await sb
    .from('onboarding_progress')
    .select('*')
    .eq('account_id', id)
    .maybeSingle()) as any
  
  const skipped = progress ? JSON.parse(progress.skipped_steps ?? '[]') : []
  if (!skipped.includes(step)) skipped.push(step)
  
  const completed = Math.max(progress?.completed_steps ?? 0, step - 1)
  const nextStep = Math.min(step + 1, 5)
  
  must(await sb.from('onboarding_progress').upsert({
    account_id: id,
    role: 'student',
    current_step: nextStep,
    completed_steps: completed,
    skipped_steps: j.stringify(skipped),
    updated_at: ts,
  }, { onConflict: 'account_id' }))
  
  res.json({ ok: true })
})