-- Store match scores per (student, job, resume) so a student with multiple
-- résumé profiles can see how each résumé scores against the same opportunity.
-- Previously ai_match_cache was keyed on (student_id, job_id) only — the resume_id
-- column existed but was never populated, so all scores reflected the single
-- "active" resume at scoring time.

-- 1. Backfill existing rows: associate each orphaned (resume_id IS NULL) score
--    with the student's first/oldest résumé so nothing is lost.
update ai_match_cache c
set resume_id = r.id
from resume_profiles r
where c.resume_id is null
  and r.student_id = c.student_id
  and r.id = (
    select first_resume.id
    from resume_profiles first_resume
    where first_resume.student_id = c.student_id
    order by first_resume.created_at asc, first_resume.id asc
    limit 1
  );

-- 2. For any rows still NULL (student had no résumé at backfill time), set a
--    sentinel value to avoid PK conflicts on multi-null.
--    PostgreSQL PK allows multiple NULLs, but the app's upsert uses
--    onConflict 'student_id,job_id,resume_id' which treats NULLs as equal.
--    So we use a sentinel string instead.
update ai_match_cache
set resume_id = '__legacy__'
where resume_id is null;

-- 3. Change the primary key to include resume_id (after backfill so no NULLs).
alter table ai_match_cache drop constraint if exists ai_match_cache_pkey;
alter table ai_match_cache add primary key (student_id, job_id, resume_id);
