export async function register() {
  // Only run migrations on the server, not during build
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DATABASE_URL) {
    try {
      const { runMigrations } = await import('./src/lib/migrate');
      await runMigrations();

      // Seed members if table is empty
      const { query } = await import('./src/lib/db');
      const { rows } = await query('SELECT COUNT(*) as count FROM members');
      if (parseInt(rows[0].count) === 0) {
        console.log('[db] Seeding members...');
        const { MEMBERS } = await import('./src/lib/seed');
        for (const m of MEMBERS) {
          await query(
            `INSERT INTO members (id, name, initials, role, team, region, country, lead_id, email)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (email) DO NOTHING`,
            [m.id, m.name, m.initials, m.role, m.team, m.region, m.country, m.lead, m.email]
          );
        }
        // Reset sequence to max id + 1
        await query("SELECT setval('members_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM members), false)");
        console.log('[db] Members seeded.');
      }
    } catch (err) {
      console.error('[db] Startup migration/seed error:', err.message);
      // Don't crash — app falls back to mock data
    }
  }
}
