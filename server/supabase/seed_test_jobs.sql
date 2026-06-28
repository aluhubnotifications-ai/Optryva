-- ============================================================================
-- TEST DATA: 100 jobs spread across every existing company AND school.
-- ~80% internships, full descriptions + responsibilities/benefits/qualifications.
-- Visible to EVERY student: allowed_years/allowed_schools empty, students_only=0,
-- status='active'. Idempotent (ids 'jtest_1'..'jtest_100'; on conflict do nothing).
--
-- Run in the Supabase SQL Editor. To remove later:
--   delete from job_listings where id like 'jtest_%';
-- ============================================================================

with companies as (
  select id, company_name, user_type,
         row_number() over (order by created_at, id) as rn,
         count(*) over () as cnt
  from profiles
  where user_type in ('company','school')
),
roles(k, jtype, role, tags, resp) as (
  values
    (1,'Software Engineering','Software Engineer','["JavaScript","TypeScript","React","Node.js","Git"]','["Build and ship product features","Write clean, tested code","Take part in code reviews","Debug and improve performance"]'),
    (2,'Data Science','Data Analyst','["Python","SQL","Pandas","Data Visualization","Statistics"]','["Analyze datasets for insights","Build dashboards and reports","Clean and model data","Present findings to stakeholders"]'),
    (3,'Product','Product Manager','["Roadmapping","User Research","Analytics","Agile","Communication"]','["Define and prioritize the roadmap","Write specs and user stories","Partner with design and engineering","Measure feature impact"]'),
    (4,'Design','Product Designer','["Figma","UI Design","Prototyping","User Research","Design Systems"]','["Design intuitive UI flows","Build prototypes in Figma","Run usability tests","Maintain the design system"]'),
    (5,'Marketing','Marketing Associate','["Content","SEO","Social Media","Analytics","Copywriting"]','["Create content across channels","Run campaigns and track results","Improve SEO and reach","Analyze marketing metrics"]'),
    (6,'Finance','Finance Analyst','["Excel","Financial Modeling","Accounting","Analytics","SQL"]','["Build financial models","Prepare reports and analysis","Support budgeting and forecasting","Track KPIs"]'),
    (7,'Operations','Operations Associate','["Project Management","Process Improvement","Excel","Communication"]','["Streamline daily operations","Coordinate cross-team projects","Improve processes","Maintain documentation"]'),
    (8,'Machine Learning','ML Engineer','["Python","PyTorch","Machine Learning","Data Pipelines","SQL"]','["Train and evaluate ML models","Build data pipelines","Ship models to production","Monitor model performance"]'),
    (9,'Business Development','Business Development Associate','["Sales","CRM","Negotiation","Communication","Market Research"]','["Source and qualify leads","Build client relationships","Prepare proposals","Work toward growth targets"]'),
    (10,'Software Engineering','Backend Engineer','["Java","PostgreSQL","APIs","Microservices","Cloud"]','["Design and build APIs","Optimize databases","Ensure reliability and scale","Collaborate across services"]')
),
gs as (
  select g,
         ((g - 1) % (select cnt from companies limit 1)) + 1 as crn,
         ((g - 1) % 10) + 1 as rk,
         case when g % 5 = 0
              then (array['Full-time','Fellowship','Part-time'])[((g / 5) % 3) + 1]
              else 'Internship'
         end as lt
  from generate_series(1, 100) g
)
insert into job_listings (
  id, company_id, title, description, type, listing_type, location, country, remote,
  pay, currency, duration, deadline, tags, responsibilities, benefits, qualifications,
  status, apply_url, allowed_years, allowed_schools, students_only, posted_by_role,
  original_company_name, original_company_logo_url, created_at
)
select
  'jtest_' || gs.g,
  c.id,
  r.role || case when gs.lt = 'Internship' then ' Intern' else '' end,
  'Join ' || c.company_name || ' as a ' || r.role
    || case when gs.lt = 'Internship' then ' intern' else '' end
    || '. You''ll work on real, high-impact ' || lower(r.jtype)
    || ' projects alongside an experienced team, ship work used by real users, and grow fast with hands-on mentorship. '
    || 'A great fit for an ambitious, early-career candidate who wants genuine ownership and learning velocity at '
    || c.company_name || '.',
  r.jtype,
  gs.lt,
  (array['Kigali, Rwanda','Remote (Africa)','Nairobi, Kenya','Lagos, Nigeria','Remote (Global)','Kampala, Uganda'])[(gs.g % 6) + 1],
  (array['Rwanda','Remote','Kenya','Nigeria','Remote','Uganda'])[(gs.g % 6) + 1],
  case when (gs.g % 6) + 1 in (2, 5) then 1 else 0 end,
  case when gs.lt = 'Internship'
       then (array['$800 / month','$1,000 / month','$1,200 / month','RWF 450,000 / month'])[(gs.g % 4) + 1]
       else (array['$45,000 – $65,000 / yr','$55,000 – $80,000 / yr','RWF 14,000,000 – 22,000,000 / yr','$2,500 stipend'])[(gs.g % 4) + 1]
  end,
  case when (gs.g % 4) = 3 then 'RWF' else 'USD' end,
  case when gs.lt = 'Internship'
       then (array['3 months','6 months','12 weeks','Summer'])[(gs.g % 4) + 1]
       else 'Permanent'
  end,
  (now() + (((gs.g % 30) + 10)::text || ' days')::interval)::text,
  r.tags,
  r.resp,
  '["Mentorship from a senior team","Monthly stipend","Certificate of completion","Networking & community","Path to full-time"]',
  '["Pursuing or recently completed a relevant degree","Foundational skills in ' || r.role || '","Comfortable with collaboration tools and Git","Self-driven, curious, and detail-oriented"]',
  'active',
  null,
  '[]',
  '[]',
  0,
  case when c.user_type = 'school' then 'school' else 'company' end,
  null,
  null,
  (now() - ((gs.g % 21)::text || ' days')::interval)::text
from gs
join companies c on c.rn = gs.crn
join roles r on r.k = gs.rk
on conflict (id) do nothing;

-- Sanity check: how many test jobs now exist
select count(*) as test_jobs from job_listings where id like 'jtest_%';
