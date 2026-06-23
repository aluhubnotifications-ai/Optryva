-- Add a new school — African Leadership University (Kigali, Rwanda) —
-- with a login, a full profile, and 5 school-posted opportunities.
-- Login:  careers@alueducation.com  /  Demo2026!  (shared demo password)
-- Run in the Supabase SQL Editor. Safe to re-run (on conflict do nothing).

-- 1) Auth account (bcrypt('Demo2026!', 12) — same hash as the other demo accounts)
insert into app_users (id, email, password_hash, email_verified, created_at) values
  ('s_alu', 'careers@alueducation.com', '$2a$12$P5sBYErQ1/g5vp4fvothmOTbeinj4st/K2Hax31bHTKD0cogUr8Aq', 1, now()::text)
on conflict (id) do nothing;

-- 2) School profile
insert into profiles
  (id,user_type,full_name,email,avatar_url,cover_url,bio,location,website,linkedin,twitter,
   desired_roles,preferred_industries,skills,company_name,industry,company_size,posted_by_role,plan,created_at)
values
  ('s_alu','school','African Leadership University','careers@alueducation.com',
   'https://www.google.com/s2/favicons?domain=alueducation.com&sz=256',
   'https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=1600&q=80',
   'African Leadership University develops the next generation of African leaders. With campuses in Kigali and Mauritius, ALU offers a mission-driven education and connects its students with fellowships, internships, and entrepreneurial opportunities that drive lasting impact across the continent.',
   'Kigali, Rwanda','https://www.alueducation.com',
   'https://www.linkedin.com/school/african-leadership-university/',null,
   '[]','[]','[]','African Leadership University','Education','201-500','school','premium',now()::text)
on conflict (id) do nothing;

-- 3) Five school-posted opportunities
insert into job_listings
  (id,company_id,title,description,type,listing_type,location,country,remote,pay,currency,duration,
   deadline,tags,status,apply_url,allowed_years,allowed_schools,posted_by_role,original_company_name,
   original_company_logo_url,created_at)
values
  ('j_alu1','s_alu','Young Leaders Fellowship',
   'A flagship one-year fellowship developing emerging African leaders through coursework in leadership, entrepreneurship, and African studies, plus a real-world capstone project.',
   'Leadership','Fellowship','Kigali, Rwanda','Rwanda',0,
   '$2,000 / month stipend','USD','1 year',(now() + interval '25 days')::text,
   '["Leadership","Public Speaking","Project Management","Mentorship"]','active',
   'https://www.alueducation.com','[]','[]','school',null,null,(now() - interval '2 days')::text),

  ('j_alu2','s_alu','Entrepreneurship Program Intern',
   'Support ALU''s entrepreneurship curriculum and venture incubator: coach student founders, run pitch workshops, and help ventures reach launch.',
   'Business','Internship','Kigali, Rwanda · Hybrid','Rwanda',0,
   'RWF 450,000 / month','RWF','6 months',(now() + interval '20 days')::text,
   '["Entrepreneurship","Business Development","Pitching","Finance"]','active',
   null,'[]','[]','school',null,null,(now() - interval '2 days')::text),

  ('j_alu3','s_alu','Teaching Fellow — Mathematics & Sciences',
   'Teach and mentor exceptional students from across Africa. Design engaging STEM lessons, run labs, and support learners toward top global universities.',
   'Education','Full-time','Kigali, Rwanda','Rwanda',0,
   'RWF 14,000,000 – 20,000,000 / yr','RWF','Permanent',(now() + interval '35 days')::text,
   '["Teaching","Curriculum Design","STEM","Mentorship"]','active',
   null,'[]','[]','school',null,null,(now() - interval '2 days')::text),

  ('j_alu4','s_alu','Community Impact Fellowship (Pan-African)',
   'A 12-week remote fellowship pairing fellows with community organizations across Africa to design and deliver high-impact social projects.',
   'Social Impact','Fellowship','Remote (Africa)','Rwanda',1,
   '$1,500 / month stipend','USD','12 weeks',(now() + interval '18 days')::text,
   '["Community Development","Project Management","Leadership","Impact Measurement"]','active',
   null,'[]','[]','school',null,null,(now() - interval '2 days')::text),

  ('j_alu5','s_alu','Global Scholars Summer Internship',
   'Join the ALU team for the summer supporting admissions, alumni programs, and pan-African scholar networks. Research, communications, and event delivery.',
   'Operations','Internship','Kigali, Rwanda · Remote','Rwanda',1,
   '$1,200 / month','USD','3 months',(now() + interval '22 days')::text,
   '["Research","Communications","Event Planning","Data"]','active',
   null,'[]','[]','school',null,null,(now() - interval '2 days')::text)
on conflict (id) do nothing;
