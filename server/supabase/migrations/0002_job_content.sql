-- Add optional rich-content fields to job listings so companies can specify
-- Responsibilities / Benefits / Qualifications when creating a listing.
-- Stored as JSON arrays in text columns (same convention as `tags`).
-- Run once in the Supabase SQL Editor.

alter table job_listings add column if not exists responsibilities text;
alter table job_listings add column if not exists benefits        text;
alter table job_listings add column if not exists qualifications   text;
