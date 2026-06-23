-- Backfill Responsibilities / Benefits / Qualifications onto existing jobs so they
-- show up (editable) in the Create/Edit form, instead of being auto-generated only.
-- Mirrors client/src/lib/jobContent.ts. Safe to run once; only fills jobs that
-- don't already have custom content. Run in the Supabase SQL Editor.

-- 1) Make sure the columns exist (idempotent).
alter table job_listings add column if not exists responsibilities text;
alter table job_listings add column if not exists benefits        text;
alter table job_listings add column if not exists qualifications   text;

-- 2) Backfill from each job's category (type) + tags + listing_type + remote.
update job_listings j
set
  responsibilities = (
    (case j.type
       when 'Software Engineering' then '["Build, test, and ship features across the product","Write clean, maintainable, well-documented code","Participate in code reviews and pair with teammates","Debug issues and improve performance and reliability","Collaborate closely with design and product"]'::jsonb
       when 'Data'        then '["Explore data and build models that drive decisions","Create dashboards and clear, actionable reports","Clean, transform, and validate datasets","Present findings to technical and non-technical stakeholders"]'::jsonb
       when 'Design'      then '["Design intuitive user flows and interfaces","Run user research and usability tests","Build interactive prototypes in Figma","Contribute to and maintain the design system"]'::jsonb
       when 'Marketing'   then '["Plan and run campaigns across channels","Create content that resonates with the audience","Analyze funnels, channels, and key metrics","Grow and engage the community"]'::jsonb
       when 'Operations'  then '["Improve and document day-to-day processes","Coordinate workflows across teams","Track service metrics and report progress","Support planning and execution of initiatives"]'::jsonb
       when 'Finance'     then '["Support financial modeling and reporting","Analyze performance, budgets, and forecasts","Prepare analyses and decks for leadership","Help keep operations accurate and on-track"]'::jsonb
       when 'Product'     then '["Write specs, user stories, and acceptance criteria","Coordinate the team and keep the roadmap on track","Analyze usage data and iterate on the product","Partner with engineering and design to ship"]'::jsonb
       else '["Own your work end-to-end and communicate progress","Collaborate across the team to hit shared goals","Learn quickly and contribute real value early"]'::jsonb
     end)
    ||
    (case when jsonb_array_length(coalesce(j.tags, '[]')::jsonb) > 0
       then jsonb_build_array('Work hands-on with ' || (
              select string_agg(value, ', ' order by ord)
              from (
                select value, ord
                from jsonb_array_elements_text(coalesce(j.tags, '[]')::jsonb) with ordinality as t(value, ord)
                order by ord limit 3
              ) s
            ) || '.')
       else '[]'::jsonb
     end)
  )::text,

  benefits = (
    '["Flexible schedule","Training & development","Mentorship from senior team members"]'::jsonb
    || jsonb_build_array(case when j.remote = 1 then 'Flexible work-from-home options' else 'Collaborative on-site culture' end)
    || jsonb_build_array(case when j.listing_type in ('Internship','Fellowship') then 'A real, portfolio-worthy project' else 'Clear growth and progression' end)
  )::text,

  qualifications = (
    coalesce((
      select jsonb_agg('Familiarity with ' || value order by ord)
      from (
        select value, ord
        from jsonb_array_elements_text(coalesce(j.tags, '[]')::jsonb) with ordinality as t(value, ord)
        order by ord limit 4
      ) s
    ), '[]'::jsonb)
    || '["Excellent communication and organizational skills","Strong attention to detail and ability to manage priorities"]'::jsonb
    || jsonb_build_array(case when j.listing_type in ('Internship','Fellowship') then 'Currently enrolled or a recent graduate' else 'Relevant experience or a strong portfolio' end)
  )::text
where coalesce(j.responsibilities, '') in ('', '[]', 'null');
