-- 0020_async_job_functions.down.sql
DROP FUNCTION IF EXISTS public.fn_complete_async_job(uuid, text, integer);
DROP FUNCTION IF EXISTS public.fn_claim_async_jobs(text, text, integer, integer);

