CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;
SELECT cron.schedule(
  'darb-gps-history-retention',
  '0 3 * * *',
  $$DELETE FROM public.vehicle_locations
    WHERE recorded_at < now() - interval '365 days';$$
);
