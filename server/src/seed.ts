// ⚠️ DEPRECATED for Postgres/Supabase. This seed uses SQLite-only syntax
// (INSERT OR IGNORE) and is no longer wired into the server. The canonical
// schema + seed now live in server/supabase/init.sql — run that once in the
// Supabase SQL Editor. Kept only for reference.
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { db, initSchema, j } from '@/db'

const days = (n: number) => new Date(Date.now() - n * 86400000).toISOString()
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString()

export function runSeed() {
  initSchema()
  const hash = bcrypt.hashSync('Demo2026!', 12)

  const insUser = db.prepare('INSERT OR IGNORE INTO app_users (id,email,password_hash,email_verified,created_at) VALUES (?,?,?,1,?)')
  const insProfile = db.prepare(`INSERT OR IGNORE INTO profiles
    (id,user_type,full_name,email,avatar_url,bio,school,major,year,location,linkedin,github,website,cv_filename,cv_uploaded_at,cv_text,
     desired_roles,preferred_industries,work_type,location_pref,open_to_internship,open_to_fulltime,skills,company_name,industry,company_size,posted_by_role,plan,created_at)
    VALUES (@id,@user_type,@full_name,@email,@avatar_url,@bio,@school,@major,@year,@location,@linkedin,@github,@website,@cv_filename,@cv_uploaded_at,@cv_text,
     @desired_roles,@preferred_industries,@work_type,@location_pref,@open_to_internship,@open_to_fulltime,@skills,@company_name,@industry,@company_size,@posted_by_role,@plan,@created_at)`)

  function profile(p: any) {
    insUser.run(p.id, p.email, hash, days(40))
    insProfile.run({
      avatar_url: null, bio: null, school: null, major: null, year: null, location: null, linkedin: null, github: null, website: null,
      cv_filename: null, cv_uploaded_at: null, cv_text: null, desired_roles: '[]', preferred_industries: '[]', work_type: null,
      location_pref: null, open_to_internship: null, open_to_fulltime: null, skills: '[]', company_name: null, industry: null,
      company_size: null, posted_by_role: null, plan: 'free', created_at: days(40), ...p,
    })
  }

  // Students
  profile({
    id: 'u_student', user_type: 'student', full_name: 'Amara Okeke', email: 'amara@student.dev', avatar_url: 'https://i.pravatar.cc/240?img=47',
    bio: 'Final-year CS student building products that scale across emerging markets.', school: 'University of Cape Town', major: 'Computer Science', year: 3,
    location: 'Cape Town, South Africa', linkedin: 'https://linkedin.com/in/amara', github: 'https://github.com/amara', website: 'https://amara.dev',
    cv_filename: 'Amara_Okeke_CV.pdf', cv_uploaded_at: days(8),
    cv_text: 'Amara Okeke. BSc Computer Science. Skills: React, TypeScript, Node.js, Python, PostgreSQL, Docker, AWS, REST APIs, Tailwind CSS. Projects: real-time logistics dashboard (React, WebSockets, Node); ML price-prediction model (Python, scikit-learn). Frontend intern at a fintech startup — shipped a payments onboarding flow used by 10k users.',
    desired_roles: j.stringify(['Software Engineering', 'Product Management']), preferred_industries: j.stringify(['Technology', 'Finance']),
    work_type: 'hybrid', location_pref: 'Remote / Cape Town', open_to_internship: 1, open_to_fulltime: 1,
    skills: j.stringify(['React', 'TypeScript', 'Node.js', 'Python', 'PostgreSQL', 'Figma']),
  })
  profile({ id: 'u_student2', user_type: 'student', full_name: 'Diego Martins', email: 'diego@student.dev', avatar_url: 'https://i.pravatar.cc/240?img=12', school: 'Universidade de São Paulo', major: 'Data Science', year: 2, location: 'São Paulo, Brazil', skills: j.stringify(['Python', 'SQL', 'Pandas', 'Machine Learning']), desired_roles: j.stringify(['Data Science']), work_type: 'remote', open_to_internship: 1, open_to_fulltime: 0 })
  profile({ id: 'u_student3', user_type: 'student', full_name: 'Priya Sharma', email: 'priya@student.dev', avatar_url: 'https://i.pravatar.cc/240?img=45', school: 'National University of Singapore', major: 'Design & Interaction', year: 4, location: 'Singapore', skills: j.stringify(['Figma', 'UI Design', 'Prototyping', 'React']), desired_roles: j.stringify(['Design']), work_type: 'hybrid', open_to_fulltime: 1 })

  // Companies + school
  const companies = [
    { id: 'c_nimbus', name: 'Cloudflare', email: 'university@cloudflare.com', logo: '/logos/cloudflare.svg', industry: 'Technology', size: '1001-5000', loc: 'Remote (Global)' },
    { id: 'c_paystream', name: 'Flutterwave', email: 'careers@flutterwave.com', logo: '/logos/flutterwave.svg', industry: 'Finance', size: '501-1000', loc: 'Lagos, Nigeria · Remote' },
    { id: 'c_verdant', name: 'Helium Health', email: 'jobs@heliumhealth.com', logo: '/logos/heliumhealth.svg', industry: 'Healthcare', size: '201-500', loc: 'Lagos, Nigeria · Remote' },
    { id: 'c_orbit', name: 'Jumia', email: 'people@jumia.com', logo: '/logos/jumia.svg', industry: 'E-commerce', size: '1001-5000', loc: 'Pan-African · Remote' },
  ]
  for (const c of companies) {
    profile({ id: c.id, user_type: 'company', full_name: c.name, company_name: c.name, email: c.email, avatar_url: c.logo, industry: c.industry, company_size: c.size, location: c.loc, posted_by_role: 'company', plan: 'standard', bio: `${c.name} — a leading employer building products with real traction.` })
  }
  profile({ id: 's_careers', user_type: 'school', full_name: 'Global Career Services', company_name: 'Global Career Services', email: 'careers@university.edu', industry: 'Education', company_size: '11-50', location: 'Global', posted_by_role: 'school', plan: 'premium', bio: 'We post curated opportunities on behalf of partner employers.' })

  // Jobs
  const insJob = db.prepare(`INSERT OR IGNORE INTO job_listings
    (id,company_id,title,description,type,listing_type,location,country,remote,pay,currency,duration,deadline,tags,status,apply_url,allowed_years,allowed_schools,posted_by_role,original_company_name,original_company_logo_url,created_at)
    VALUES (@id,@company_id,@title,@description,@type,@listing_type,@location,@country,@remote,@pay,@currency,@duration,@deadline,@tags,'active',@apply_url,@allowed_years,@allowed_schools,@posted_by_role,@ocn,@ocl,@created_at)`)
  const J = (o: any) => {
    const b: any = {
      apply_url: null, currency: 'USD', duration: '6 months', allowed_years: '[]', allowed_schools: '[]',
      posted_by_role: 'company', ocn: null, ocl: null,
      ...o,
      remote: o.remote ? 1 : 0,
      tags: j.stringify(o.tags),
      deadline: inDays(o.dl ?? 20),
      created_at: days(o.age ?? 3),
    }
    delete b.age
    delete b.dl
    insJob.run(b)
  }

  J({ id: 'j1', company_id: 'c_nimbus', title: 'Frontend Engineer Intern', description: 'Build our developer dashboard with React, TypeScript, and a strong design system. Mentorship and real ownership.', type: 'Software Engineering', listing_type: 'Internship', location: 'Remote (Global)', country: 'Remote', remote: true, pay: '$2,500 / month', tags: ['React', 'TypeScript', 'Tailwind CSS', 'REST APIs', 'Git'] })
  J({ id: 'j3', company_id: 'c_verdant', title: 'Data Science Intern', description: 'Turn health data into actionable insights. Python, pandas, scikit-learn, and a real mission.', type: 'Data', listing_type: 'Internship', location: 'Nairobi, Kenya · Remote', country: 'Kenya', remote: true, pay: '$1,800 / month', tags: ['Python', 'Pandas', 'Machine Learning', 'SQL'], allowed_years: j.stringify([3, 4]) })
  J({ id: 'j4', company_id: 'c_orbit', title: 'Product Design Fellowship', description: 'A 12-week fellowship for emerging designers. From research to high-fidelity prototypes.', type: 'Design', listing_type: 'Fellowship', location: 'Remote (Global)', country: 'Remote', remote: true, pay: '$2,000 / month stipend', tags: ['Figma', 'UI Design', 'User Research', 'Prototyping'] })
  J({ id: 'j6', company_id: 's_careers', title: 'Software Engineering Intern (via Microsoft)', description: 'Posted by Global Career Services on behalf of Microsoft. Summer SWE internship across cloud and AI teams.', type: 'Software Engineering', listing_type: 'Internship', location: 'Seattle, USA · Hybrid', country: 'United States', remote: false, pay: '$7,500 / month', tags: ['Algorithms', 'C#', 'Cloud', 'Azure'], allowed_years: j.stringify([3, 4]), posted_by_role: 'school', ocn: 'Microsoft', ocl: '/logos/microsoft.svg', apply_url: 'https://careers.microsoft.com/students' })
  J({ id: 'j9', company_id: 'c_nimbus', title: 'Cloud Platform Intern', description: 'Work on Kubernetes, observability, and CI/CD. Ship tooling that keeps thousands of deployments healthy.', type: 'Software Engineering', listing_type: 'Internship', location: 'Remote (Global)', country: 'Remote', remote: true, pay: '$2,600 / month', tags: ['Kubernetes', 'Docker', 'Go', 'CI/CD'], age: 1 })
  J({ id: 'j13', company_id: 'c_paystream', title: 'Finance Analyst Intern', description: 'Support FP&A with modeling, reporting, and analysis across our global business.', type: 'Finance', listing_type: 'Internship', location: 'New York, USA · Hybrid', country: 'United States', remote: false, pay: '$4,500 / month', tags: ['Excel', 'Financial Modeling', 'Analytics', 'SQL'] })
  J({ id: 'j17', company_id: 'c_paystream', title: 'Backend Engineer', description: 'Design and scale payment APIs processing millions of transactions. Node.js, PostgreSQL, event-driven.', type: 'Software Engineering', listing_type: 'Full-time', location: 'London, UK · Hybrid', country: 'United Kingdom', remote: false, pay: '£55,000 – £70,000 / yr', currency: 'GBP', duration: 'Permanent', dl: 30, apply_url: 'https://flutterwave.com/careers/backend', tags: ['Node.js', 'PostgreSQL', 'Microservices', 'AWS'] })
  J({ id: 'j19', company_id: 'c_nimbus', title: 'Frontend Engineer', description: 'Own features across our developer dashboard end-to-end. React, TypeScript, strong design system.', type: 'Software Engineering', listing_type: 'Full-time', location: 'Remote (Global)', country: 'Remote', remote: true, pay: '$90,000 – $120,000 / yr', duration: 'Permanent', dl: 34, tags: ['React', 'TypeScript', 'Tailwind CSS', 'Testing'] })
  J({ id: 'j21', company_id: 'c_orbit', title: 'Product Designer', description: 'Design merchant-facing products used across emerging markets. Research to polished UI.', type: 'Design', listing_type: 'Full-time', location: 'Singapore · Hybrid', country: 'Singapore', remote: false, pay: 'S$80,000 – S$100,000 / yr', currency: 'SGD', duration: 'Permanent', dl: 23, tags: ['Figma', 'UI Design', 'Design Systems', 'Prototyping'] })
  J({ id: 'j23', company_id: 's_careers', title: 'Women in Tech Leadership Fellowship', description: 'A 16-week sponsored fellowship: mentorship, a stipend, and a capstone project. Open worldwide.', type: 'Product', listing_type: 'Fellowship', location: 'Remote (Global)', country: 'Remote', remote: true, pay: '$3,000 stipend', duration: '16 weeks', dl: 14, posted_by_role: 'school', tags: ['Leadership', 'Mentorship', 'Capstone'] })

  // Applications + follow + notification
  db.prepare(`INSERT OR IGNORE INTO applications (id,student_id,job_id,status,cover_note,documents,full_name,email,school,year,timeline,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('a1', 'u_student', 'j1', 'shortlisted', 'I have shipped React + TypeScript dashboards in production.', j.stringify([{ kind: 'cv', name: 'Amara_Okeke_CV.pdf', url: '#', mime: 'application/pdf', size: 234000 }]), 'Amara Okeke', 'amara@student.dev', 'University of Cape Town', 3, j.stringify([{ status: 'applied', at: days(5) }, { status: 'reviewed', at: days(4) }, { status: 'shortlisted', at: days(2) }]), days(5))
  db.prepare('INSERT OR IGNORE INTO company_follows (student_id,company_id,email_notifications) VALUES (?,?,1)').run('u_student', 'c_nimbus')
  db.prepare('INSERT OR IGNORE INTO notifications (id,user_id,type,title,body,read,ref_id,created_at) VALUES (?,?,?,?,?,0,?,?)').run('n1', 'u_student', 'status_change', 'You\'ve been shortlisted! 🎉', 'Cloudflare moved your application for Frontend Engineer Intern to Shortlisted.', 'a1', days(2))

  console.log('Seed complete: 3 students, 4 companies + 1 school, 10 jobs. Password for all: Demo2026!')
}

// Allow `npm run seed`
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) runSeed()
