-- Add covering indexes for private alert-table foreign keys flagged by Supabase performance advisors.
-- Non-destructive; safe to run during a reviewed migration window.
CREATE INDEX IF NOT EXISTS darb_alert_rules_created_by_idx
  ON private.darb_alert_rules (created_by);
CREATE INDEX IF NOT EXISTS darb_alert_rules_organization_id_idx
  ON private.darb_alert_rules (organization_id);
CREATE INDEX IF NOT EXISTS darb_alerts_acknowledged_by_idx
  ON private.darb_alerts (acknowledged_by);
CREATE INDEX IF NOT EXISTS darb_alerts_rule_id_idx
  ON private.darb_alerts (rule_id);
