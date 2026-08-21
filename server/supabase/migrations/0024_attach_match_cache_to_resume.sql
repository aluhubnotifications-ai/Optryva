-- Associate existing match scores with the equal first résumé.
-- Keep the existing primary key so cached scores are preserved without rescoring.
alter table ai_match_cache add column if not exists resume_id text references resume_profiles(id) on delete set null;

update ai_match_cache c
set resume_id = r.id
from resume_profiles r
where r.student_id = c.student_id
  and r.id = (
    select first_resume.id
    from resume_profiles first_resume
    where first_resume.student_id = c.student_id
    order by first_resume.created_at asc, first_resume.id asc
    limit 1
  )
  and c.resume_id is null;

create index if not exists idx_match_cache_resume on ai_match_cache(resume_id);
