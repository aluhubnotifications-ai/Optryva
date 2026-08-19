-- ============================================================================
-- Optryva — Supabase (Postgres) schema + seed.  (Africa / Rwanda edition)
-- Run this whole file once in the Supabase SQL Editor (New query → Run).
-- Idempotent: tables use IF NOT EXISTS and seed rows use ON CONFLICT DO NOTHING.
--
-- Ported from server/src/db.ts. JSON-shaped fields stay as `text` (the app
-- (de)serializes them) and 0/1 "boolean" flags stay as integer, so the existing
-- route code keeps working unchanged once we connect.
--
-- Companies + students + jobs are all based in Rwanda / Africa.
-- All seeded accounts share the password:  Demo2026!   (logins at bottom).
-- ============================================================================

-- ---------- schema ----------------------------------------------------------
create table if not exists app_users (
  id             text primary key,
  email          text unique not null,
  password_hash  text not null,
  email_verified integer not null default 1,
  created_at     text not null
);

create table if not exists profiles (
  id            text primary key references app_users(id) on delete cascade,
  user_type     text not null,                 -- student | company | school
  full_name     text not null,
  email         text not null,
  avatar_url    text,
  cover_url     text,
  bio           text,
  school        text,
  major         text,
  year          integer,
  location      text,
  linkedin      text,
  github        text,
  twitter       text,
  website       text,
  cv_filename   text,
  cv_uploaded_at text,
  cv_text       text,
  cv_url        text,                          -- résumé file as a data URL
  desired_roles text,                          -- JSON array
  preferred_industries text,                   -- JSON array
  work_type     text,
  location_pref text,
  open_to_internship integer,
  open_to_fulltime   integer,
  skills        text,                          -- JSON array
  company_name  text,
  industry      text,
  company_size  text,
  student_domains text,                        -- JSON array of school student email domains
  is_private    integer not null default 0,    -- school privacy: only matching domains can see it
  posted_by_role text,
  plan          text not null default 'free',
  plan_activated_at text,
  created_at    text not null
);

create table if not exists resume_profiles (
  id text primary key,
  student_id text not null references profiles(id) on delete cascade,
  name text not null,
  target_roles text not null default '[]',
  preferred_industries text not null default '[]',
  pref_countries text not null default '[]',
  pref_listing_types text not null default '[]',
  skills text not null default '[]',
  work_type text not null default 'any',
  cv_filename text,
  cv_url text,
  active integer not null default 1,
  created_at text not null,
  updated_at text not null
);

create table if not exists job_listings (
  id            text primary key,
  company_id    text not null references profiles(id) on delete cascade,
  title         text not null,
  description   text not null,
  type          text not null,
  listing_type  text not null,
  location      text not null,
  country       text not null,
  remote        integer not null default 0,
  pay           text,
  currency      text,
  duration      text,
  deadline      text,
  tags          text,                          -- JSON array
  responsibilities text,                        -- JSON array (optional, company-specified)
  benefits      text,                           -- JSON array (optional)
  qualifications text,                          -- JSON array (optional)
  status        text not null default 'active',
  apply_url     text,
  allowed_years text,                          -- JSON array of numbers
  allowed_schools text,                        -- JSON array of strings
  students_only integer not null default 0,    -- restrict to posting school's student domains
  posted_by_role text not null default 'company',
  original_company_name text,
  original_company_logo_url text,
  created_at    text not null
);

create table if not exists applications (
  id            text primary key,
  student_id    text not null references profiles(id) on delete cascade,
  job_id        text not null references job_listings(id) on delete cascade,
  status        text not null default 'pending',
  cover_note    text,
  documents     text,                          -- JSON array
  full_name     text not null,
  email         text not null,
  phone         text,
  school        text,
  year          integer,
  linkedin      text,
  timeline      text,                          -- JSON array
  created_at    text not null,
  unique (student_id, job_id)
);

create table if not exists messages (
  id            text primary key,
  thread_id     text not null,
  scope         text not null,                 -- application | dm
  sender_id     text not null,
  kind          text not null default 'text',
  body          text,
  attachment    text,                          -- JSON
  reactions     text,                          -- JSON
  read          integer not null default 0,
  deleted       integer not null default 0,
  created_at    text not null
);

create table if not exists company_follows (
  student_id    text not null,
  company_id    text not null,
  email_notifications integer not null default 1,
  primary key (student_id, company_id)
);

create table if not exists company_ratings (
  id            text primary key,
  rater_id      text not null,
  ref_type      text not null,
  ref_id        text not null,
  stars         integer not null,
  comment       text,
  created_at    text not null,
  unique (rater_id, ref_type, ref_id)
);

create table if not exists notifications (
  id            text primary key,
  user_id       text not null,
  type          text not null,
  title         text not null,
  body          text not null,
  read          integer not null default 0,
  ref_id        text,
  created_at    text not null
);

create table if not exists ai_match_cache (
  student_id    text not null,
  job_id        text not null,
  payload       text not null,                 -- JSON AiMatch
  stale         integer not null default 0,
  created_at    text not null,
  primary key (student_id, job_id)
);

create index if not exists idx_jobs_company on job_listings(company_id);
create index if not exists idx_resume_profiles_student on resume_profiles(student_id);
create index if not exists idx_apps_student on applications(student_id);
create index if not exists idx_apps_job     on applications(job_id);
create index if not exists idx_msgs_thread  on messages(thread_id);
create index if not exists idx_notes_user   on notifications(user_id);

-- ---------- seed ------------------------------------------------------------
-- bcrypt('Demo2026!', 12) — the same hash is inlined for every demo account.

-- users (all accounts)
insert into app_users (id, email, password_hash, email_verified, created_at) values
  ('u_student',  'amara@student.dev',        '$2a$12$P5sBYErQ1/g5vp4fvothmOTbeinj4st/K2Hax31bHTKD0cogUr8Aq', 1, (now() - interval '40 days')::text),
  ('u_student2', 'eric@student.dev',         '$2a$12$P5sBYErQ1/g5vp4fvothmOTbeinj4st/K2Hax31bHTKD0cogUr8Aq', 1, (now() - interval '40 days')::text),
  ('u_student3', 'aisha@student.dev',        '$2a$12$P5sBYErQ1/g5vp4fvothmOTbeinj4st/K2Hax31bHTKD0cogUr8Aq', 1, (now() - interval '40 days')::text),
  ('c_bk',       'careers@bk.rw',            '$2a$12$P5sBYErQ1/g5vp4fvothmOTbeinj4st/K2Hax31bHTKD0cogUr8Aq', 1, (now() - interval '40 days')::text),
  ('c_andela',   'jobs@andela.com',          '$2a$12$P5sBYErQ1/g5vp4fvothmOTbeinj4st/K2Hax31bHTKD0cogUr8Aq', 1, (now() - interval '40 days')::text),
  ('c_zipline',  'careers@zipline.rw',       '$2a$12$P5sBYErQ1/g5vp4fvothmOTbeinj4st/K2Hax31bHTKD0cogUr8Aq', 1, (now() - interval '40 days')::text),
  ('c_irembo',   'people@irembo.rw',         '$2a$12$P5sBYErQ1/g5vp4fvothmOTbeinj4st/K2Hax31bHTKD0cogUr8Aq', 1, (now() - interval '40 days')::text),
  ('c_mtn',      'careers@mtn.rw',           '$2a$12$P5sBYErQ1/g5vp4fvothmOTbeinj4st/K2Hax31bHTKD0cogUr8Aq', 1, (now() - interval '40 days')::text),
  ('c_kasha',    'jobs@kasha.rw',            '$2a$12$P5sBYErQ1/g5vp4fvothmOTbeinj4st/K2Hax31bHTKD0cogUr8Aq', 1, (now() - interval '40 days')::text),
  ('s_careers',  'careers@ur.ac.rw',         '$2a$12$P5sBYErQ1/g5vp4fvothmOTbeinj4st/K2Hax31bHTKD0cogUr8Aq', 1, (now() - interval '40 days')::text)
on conflict (id) do nothing;

-- profiles: students (all African)
insert into profiles (id,user_type,full_name,email,avatar_url,bio,school,major,year,location,linkedin,github,website,cv_filename,cv_uploaded_at,cv_text,desired_roles,preferred_industries,work_type,location_pref,open_to_internship,open_to_fulltime,skills,company_name,industry,company_size,posted_by_role,plan,created_at) values
  ('u_student','student','Amara Okeke','amara@student.dev','https://i.pravatar.cc/240?img=47',
   'Final-year CS student building products that scale across emerging markets.',
   'University of Rwanda','Computer Science',3,'Kigali, Rwanda',
   'https://linkedin.com/in/amara','https://github.com/amara','https://amara.dev',
   'Amara_Okeke_CV.pdf',(now() - interval '8 days')::text,
   'Amara Okeke. BSc Computer Science. Skills: React, TypeScript, Node.js, Python, PostgreSQL, Docker, AWS, REST APIs, Tailwind CSS. Projects: real-time logistics dashboard (React, WebSockets, Node); ML price-prediction model (Python, scikit-learn). Frontend intern at a fintech startup — shipped a payments onboarding flow used by 10k users.',
   '["Software Engineering","Product Management"]','["Technology","Finance"]','hybrid','Remote / Kigali',1,1,
   '["React","TypeScript","Node.js","Python","PostgreSQL","Figma"]',null,null,null,null,'free',(now() - interval '40 days')::text),
  ('u_student2','student','Eric Niyonshuti','eric@student.dev','https://i.pravatar.cc/240?img=12',
   null,'University of Rwanda','Data Science',2,'Kigali, Rwanda',null,null,null,null,null,null,
   '["Data Science"]','[]','remote',null,1,0,'["Python","SQL","Pandas","Machine Learning"]',null,null,null,null,'free',(now() - interval '40 days')::text),
  ('u_student3','student','Aisha Mohammed','aisha@student.dev','https://i.pravatar.cc/240?img=45',
   null,'University of Nairobi','Design & Interaction',4,'Nairobi, Kenya',null,null,null,null,null,null,
   '["Design"]','[]','hybrid',null,null,1,'["Figma","UI Design","Prototyping","React"]',null,null,null,null,'free',(now() - interval '40 days')::text)
on conflict (id) do nothing;

-- profiles: companies (Rwanda / Africa) + school — real, full profiles
insert into profiles (id,user_type,full_name,email,avatar_url,cover_url,bio,location,website,linkedin,twitter,desired_roles,preferred_industries,skills,company_name,industry,company_size,posted_by_role,plan,created_at) values
  ('c_bk','company','Bank of Kigali','careers@bk.rw',
   'https://www.google.com/s2/favicons?domain=bk.rw&sz=256',
   'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1600&q=80',
   'Bank of Kigali (BK Group Plc) is Rwanda''s largest commercial bank by assets. Founded in 1966 and listed on the Rwanda and Nairobi stock exchanges, BK serves over 350,000 customers through retail, corporate, and fast-growing digital banking.',
   'Kigali, Rwanda','https://www.bk.rw','https://www.linkedin.com/company/bank-of-kigali','https://twitter.com/BankofKigali',
   '[]','[]','[]','Bank of Kigali','Banking & Finance','1001-5000','company','standard',(now() - interval '40 days')::text),
  ('c_andela','company','Andela','jobs@andela.com',
   'https://www.google.com/s2/favicons?domain=andela.com&sz=256',
   'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1600&q=80',
   'Andela is a global talent network that connects companies with vetted, remote software engineers from Africa and beyond. Founded in 2014, Andela has built engineering hubs across Kigali, Lagos, Nairobi, and Kampala.',
   'Kigali, Rwanda · Remote (Africa)','https://www.andela.com','https://www.linkedin.com/company/andela','https://twitter.com/Andela',
   '[]','[]','[]','Andela','Technology','501-1000','company','standard',(now() - interval '40 days')::text),
  ('c_zipline','company','Zipline','careers@zipline.rw',
   'https://www.google.com/s2/favicons?domain=flyzipline.com&sz=256',
   'https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=1600&q=80',
   'Zipline operates the world''s largest autonomous drone-delivery network. From its distribution centers in Muhanga and Kayonza, Zipline has delivered blood and essential medicines to health facilities across Rwanda since 2016.',
   'Muhanga, Rwanda','https://www.flyzipline.com','https://www.linkedin.com/company/zipline','https://twitter.com/flyzipline',
   '[]','[]','[]','Zipline','Healthcare & Logistics','201-500','company','standard',(now() - interval '40 days')::text),
  ('c_irembo','company','Irembo','people@irembo.rw',
   'https://www.google.com/s2/favicons?domain=irembo.gov.rw&sz=256',
   'https://images.unsplash.com/photo-1564507592333-c60657eea523?w=1600&q=80',
   'Irembo is Rwanda''s e-government platform, digitizing more than 100 public services — from birth certificates to driving-permit exams — for millions of citizens. Built and run from Kigali.',
   'Kigali, Rwanda','https://irembo.gov.rw','https://www.linkedin.com/company/irembo','https://twitter.com/IremboGov',
   '[]','[]','[]','Irembo','Technology (GovTech)','51-200','company','standard',(now() - interval '40 days')::text),
  ('c_mtn','company','MTN Rwanda','careers@mtn.rw',
   'https://www.google.com/s2/favicons?domain=mtn.com&sz=256',
   'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1600&q=80',
   'MTN Rwanda is the country''s leading telecom operator, providing mobile voice, data, and MTN Mobile Money (MoMo) services to over 6 million subscribers since 1998. Part of the pan-African MTN Group.',
   'Kigali, Rwanda','https://www.mtn.co.rw','https://www.linkedin.com/company/mtn-rwanda','https://twitter.com/mtnrwanda',
   '[]','[]','[]','MTN Rwanda','Telecommunications','501-1000','company','standard',(now() - interval '40 days')::text),
  ('c_kasha','company','Kasha','jobs@kasha.rw',
   'https://www.google.com/s2/favicons?domain=kasha.co&sz=256',
   'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=1600&q=80',
   'Kasha is an e-commerce platform delivering health, personal-care, and beauty products — including discreet access to reproductive health — to customers across Rwanda and Kenya. Founded in 2016.',
   'Kigali, Rwanda','https://kasha.co','https://www.linkedin.com/company/kasha-global','https://twitter.com/kasha_global',
   '[]','[]','[]','Kasha','E-commerce','51-200','company','standard',(now() - interval '40 days')::text),
  ('s_careers','school','UR Career Services','careers@ur.ac.rw',
   'https://www.google.com/s2/favicons?domain=ur.ac.rw&sz=256',
   'https://images.unsplash.com/photo-1562774053-701939374585?w=1600&q=80',
   'University of Rwanda Career Services connects students with internships, fellowships, and graduate roles, posting curated opportunities on behalf of partner employers across Africa.',
   'Kigali, Rwanda','https://ur.ac.rw',null,null,
   '[]','[]','[]','UR Career Services','Education','11-50','school','premium',(now() - interval '40 days')::text)
on conflict (id) do nothing;

-- jobs (each company has at least one)
insert into job_listings (id,company_id,title,description,type,listing_type,location,country,remote,pay,currency,duration,deadline,tags,status,apply_url,allowed_years,allowed_schools,posted_by_role,original_company_name,original_company_logo_url,created_at) values
  -- Bank of Kigali
  ('j_bk1','c_bk','Finance Analyst Intern','Support FP&A with modeling, reporting, and analysis across our retail and SME banking lines.','Finance','Internship','Kigali, Rwanda','Rwanda',0,'RWF 450,000 / month','RWF','6 months',(now() + interval '20 days')::text,'["Excel","Financial Modeling","Analytics","SQL"]','active',null,'[]','[]','company',null,null,(now() - interval '3 days')::text),
  ('j_bk2','c_bk','Backend Engineer','Build and scale the APIs behind BK''s mobile banking and payments. Java, PostgreSQL, event-driven.','Software Engineering','Full-time','Kigali, Rwanda · Hybrid','Rwanda',0,'RWF 18,000,000 – 26,000,000 / yr','RWF','Permanent',(now() + interval '30 days')::text,'["Java","PostgreSQL","Microservices","AWS"]','active','https://bk.rw/careers','[]','[]','company',null,null,(now() - interval '3 days')::text),
  -- Andela
  ('j_an1','c_andela','Frontend Engineer Intern','Build product UIs with React, TypeScript, and a strong design system. Mentorship and real ownership.','Software Engineering','Internship','Remote (Africa)','Rwanda',1,'$1,500 / month','USD','6 months',(now() + interval '20 days')::text,'["React","TypeScript","Tailwind CSS","REST APIs","Git"]','active',null,'[]','[]','company',null,null,(now() - interval '3 days')::text),
  ('j_an2','c_andela','Software Engineer','Own features end-to-end across distributed teams. TypeScript, Node.js, React, cloud-native.','Software Engineering','Full-time','Remote (Africa)','Rwanda',1,'$45,000 – $70,000 / yr','USD','Permanent',(now() + interval '34 days')::text,'["TypeScript","Node.js","React","Cloud"]','active',null,'[]','[]','company',null,null,(now() - interval '3 days')::text),
  -- Zipline
  ('j_zp1','c_zipline','Data Science Intern','Turn delivery and health data into insights that keep our drone network optimal. Python, pandas, scikit-learn.','Data','Internship','Muhanga, Rwanda · Remote','Rwanda',1,'$1,200 / month','USD','6 months',(now() + interval '20 days')::text,'["Python","Pandas","Machine Learning","SQL"]','active',null,'[3,4]','[]','company',null,null,(now() - interval '3 days')::text),
  -- Irembo
  ('j_ir1','c_irembo','Product Design Fellowship','A 12-week fellowship for emerging designers building public-service products. Research to high-fidelity prototypes.','Design','Fellowship','Kigali, Rwanda · Remote','Rwanda',1,'$1,000 / month stipend','USD','12 weeks',(now() + interval '20 days')::text,'["Figma","UI Design","User Research","Prototyping"]','active',null,'[]','[]','company',null,null,(now() - interval '3 days')::text),
  ('j_ir2','c_irembo','Product Manager','Own the roadmap for citizen-facing govtech services used by millions. Discovery to delivery.','Product','Full-time','Kigali, Rwanda · Hybrid','Rwanda',0,'RWF 15,000,000 – 22,000,000 / yr','RWF','Permanent',(now() + interval '28 days')::text,'["Product Strategy","Roadmapping","Analytics","Agile"]','active',null,'[]','[]','company',null,null,(now() - interval '3 days')::text),
  -- MTN Rwanda
  ('j_mtn1','c_mtn','Cloud Platform Intern','Work on Kubernetes, observability, and CI/CD that keep mobile-money services healthy at national scale.','Software Engineering','Internship','Kigali, Rwanda','Rwanda',0,'RWF 500,000 / month','RWF','6 months',(now() + interval '20 days')::text,'["Kubernetes","Docker","Go","CI/CD"]','active',null,'[]','[]','company',null,null,(now() - interval '1 days')::text),
  -- Kasha
  ('j_ks1','c_kasha','Product Designer','Design e-commerce experiences that reach customers across East Africa. Research to polished UI.','Design','Full-time','Kigali, Rwanda · Hybrid','Rwanda',0,'RWF 14,000,000 – 20,000,000 / yr','RWF','Permanent',(now() + interval '23 days')::text,'["Figma","UI Design","Design Systems","Prototyping"]','active',null,'[]','[]','company',null,null,(now() - interval '3 days')::text),
  -- University of Rwanda Career Services (school-posted)
  ('j_sc1','s_careers','Software Engineering Intern (via Andela)','Posted by UR Career Services on behalf of Andela. Summer SWE internship across web and cloud teams.','Software Engineering','Internship','Kigali, Rwanda · Remote','Rwanda',1,'$1,500 / month','USD','6 months',(now() + interval '20 days')::text,'["Algorithms","JavaScript","Cloud","Git"]','active','https://andela.com/careers','[3,4]','[]','school','Andela','/logos/andela.svg',(now() - interval '3 days')::text),
  ('j_sc2','s_careers','Women in Tech Leadership Fellowship','A 16-week sponsored fellowship: mentorship, a stipend, and a capstone. Open to students across Africa.','Product','Fellowship','Remote (Africa)','Rwanda',1,'$2,000 stipend','USD','16 weeks',(now() + interval '14 days')::text,'["Leadership","Mentorship","Capstone"]','active',null,'[]','[]','school',null,null,(now() - interval '3 days')::text)
on conflict (id) do nothing;

-- one sample application + follow + notification (Amara → Andela)
insert into applications (id,student_id,job_id,status,cover_note,documents,full_name,email,school,year,timeline,created_at) values
  ('a1','u_student','j_an1','shortlisted','I have shipped React + TypeScript dashboards in production.',
   '[{"kind":"cv","name":"Amara_Okeke_CV.pdf","url":"#","mime":"application/pdf","size":234000}]',
   'Amara Okeke','amara@student.dev','University of Rwanda',3,
   ('[{"status":"applied","at":"' || (now() - interval '5 days')::text || '"},{"status":"reviewed","at":"' || (now() - interval '4 days')::text || '"},{"status":"shortlisted","at":"' || (now() - interval '2 days')::text || '"}]'),
   (now() - interval '5 days')::text)
on conflict (student_id, job_id) do nothing;

insert into company_follows (student_id, company_id, email_notifications) values
  ('u_student','c_andela',1)
on conflict (student_id, company_id) do nothing;

insert into notifications (id,user_id,type,title,body,read,ref_id,created_at) values
  ('n1','u_student','status_change','You''ve been shortlisted! 🎉',
   'Andela moved your application for Frontend Engineer Intern to Shortlisted.',0,'a1',(now() - interval '2 days')::text)
on conflict (id) do nothing;

-- ============================================================================
-- LOGINS  (password for ALL accounts: Demo2026!)
--   student  amara@student.dev      Amara Okeke      (University of Rwanda)
--   student  eric@student.dev       Eric Niyonshuti  (University of Rwanda)
--   student  aisha@student.dev      Aisha Mohammed   (University of Nairobi)
--   company  careers@bk.rw          Bank of Kigali   (Finance, Kigali)
--   company  jobs@andela.com        Andela           (Technology, Kigali/Remote)
--   company  careers@zipline.rw     Zipline          (Healthcare, Muhanga)
--   company  people@irembo.rw       Irembo           (GovTech, Kigali)
--   company  careers@mtn.rw         MTN Rwanda       (Telecom, Kigali)
--   company  jobs@kasha.rw          Kasha            (E-commerce, Kigali)
--   school   careers@ur.ac.rw       UR Career Services (Kigali)
-- ============================================================================
