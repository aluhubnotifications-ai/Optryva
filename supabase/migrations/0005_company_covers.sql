-- Fix the UR Career Services cover photo. The originally seeded Unsplash photo
-- (photo-1523050854058-8df90110c9f1) was removed and now returns HTTP 404, so the
-- cover banner rendered blank. The other six companies' covers still resolve (200).
-- Replaced with a verified university-campus photo. You can also change any cover
-- in-app: Company Profile → cover banner → "Add cover" / "Change cover".
-- Run in the Supabase SQL Editor.

update profiles
set cover_url = 'https://images.unsplash.com/photo-1562774053-701939374585?w=1600&q=80'
where id = 's_careers';
