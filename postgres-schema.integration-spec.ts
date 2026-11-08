import { Pool } from 'pg';

const enabled = Boolean(process.env.DATABASE_URL);
(enabled ? describe : describe.skip)('PostGIS tracker schema integration', () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  });
  afterAll(async () => { if (pool) await pool.end(); });

  it('has PostGIS and the independent tracker protocol columns', async () => {
    const spatial = await pool.query('SELECT PostGIS_Version() AS version');
    expect(spatial.rows[0].version).toBeTruthy();
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'tracking_devices' AND column_name IN ('device_label','last_protocol','manufacturer','model_name','imei','serial_number','battery_percent','signal_strength_dbm','network_type','telemetry_updated_at')`,
    );
    expect(columns.rows.map((row: { column_name: string }) => row.column_name).sort()).toEqual(['battery_percent','device_label','imei','last_protocol','manufacturer','model_name','network_type','serial_number','signal_strength_dbm','telemetry_updated_at']);
  });
});
