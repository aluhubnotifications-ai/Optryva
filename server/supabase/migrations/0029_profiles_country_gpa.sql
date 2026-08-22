-- § Students can record their GPA (free text, any format) and company/school
-- posters get a `country` so opportunity filtering by country is reliable.
-- Companies are locked to their own country when posting; schools may choose
-- a country per opportunity.
alter table profiles
  add column if not exists country text,
  add column if not exists gpa text;
