-- Give every company (and the school) a proper logo that actually loads.
-- NOTE: Clearbit's free logo CDN (logo.clearbit.com) was shut down and no longer
-- resolves (ERR_NAME_NOT_RESOLVED), so we use Google's favicon service at 256px —
-- verified to return a real image for each of these domains.
-- Run in the Supabase SQL Editor. You can also change any logo in-app:
-- Company Profile → "Upload" or "Use link".

update profiles set avatar_url = 'https://www.google.com/s2/favicons?domain=bk.rw&sz=256'          where id = 'c_bk';
update profiles set avatar_url = 'https://www.google.com/s2/favicons?domain=andela.com&sz=256'     where id = 'c_andela';
update profiles set avatar_url = 'https://www.google.com/s2/favicons?domain=flyzipline.com&sz=256' where id = 'c_zipline';
update profiles set avatar_url = 'https://www.google.com/s2/favicons?domain=irembo.gov.rw&sz=256'  where id = 'c_irembo';
update profiles set avatar_url = 'https://www.google.com/s2/favicons?domain=mtn.com&sz=256'         where id = 'c_mtn';
update profiles set avatar_url = 'https://www.google.com/s2/favicons?domain=kasha.co&sz=256'        where id = 'c_kasha';
update profiles set avatar_url = 'https://www.google.com/s2/favicons?domain=ur.ac.rw&sz=256'        where id = 's_careers';
