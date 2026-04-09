export async function register() {
  // Only run migrations on the server, not during build
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DATABASE_URL) {
    try {
      const { runMigrations } = await import('./src/lib/migrate');
      await runMigrations();

      const { query } = await import('./src/lib/db');

      // Seed members if table is empty
      const { rows: memberRows } = await query('SELECT COUNT(*) as count FROM members');
      if (parseInt(memberRows[0].count) === 0) {
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
        await query("SELECT setval('members_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM members), false)");
        console.log('[db] Members seeded.');
      }

      // Seed tasks if table is empty
      const { rows: taskRows } = await query('SELECT COUNT(*) as count FROM tasks');
      if (parseInt(taskRows[0].count) === 0) {
        console.log('[db] Seeding tasks, activity, notes, escalations, projects, requests, announcements...');
        const {
          SEED_TASKS, SEED_TASK_ACTIVITY, SEED_TASK_NOTES,
          SEED_ESCALATIONS, SEED_PROJECTS, SEED_REQUESTS, SEED_ANNOUNCEMENTS,
        } = await import('./src/lib/seed-data');

        // --- Tasks ---
        for (const t of SEED_TASKS) {
          await query(
            `INSERT INTO tasks (external_id, source, subject, description, status, priority, assignee_id, country_code, tags, external_url, reporter_id, source_created_at, snoozed_until)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (external_id) DO NOTHING`,
            [t.external_id, t.source, t.subject, t.description, t.status, t.priority, t.assignee_id, t.country_code, t.tags, t.external_url, t.reporter_id, t.source_created_at, t.snoozed_until || null]
          );
        }

        // --- Task Activity ---
        for (const a of SEED_TASK_ACTIVITY) {
          const { rows } = await query('SELECT id FROM tasks WHERE external_id = $1', [a.ext_id]);
          if (rows.length > 0) {
            const occurredAt = new Date(Date.now() - a.offset_mins * 60000).toISOString();
            await query(
              `INSERT INTO task_activity (task_id, event_type, event_text, actor_name, occurred_at)
               VALUES ($1,$2,$3,$4,$5)`,
              [rows[0].id, a.event_type, a.event_text, a.actor_name, occurredAt]
            );
          }
        }

        // --- Task Notes ---
        for (const n of SEED_TASK_NOTES) {
          const { rows } = await query('SELECT id FROM tasks WHERE external_id = $1', [n.ext_id]);
          if (rows.length > 0) {
            await query(
              `INSERT INTO task_notes (task_id, author_id, author_name, body, is_internal)
               VALUES ($1,$2,$3,$4,$5)`,
              [rows[0].id, n.author_id, n.author_name, n.body, n.is_internal]
            );
          }
        }

        // --- Escalations ---
        for (const e of SEED_ESCALATIONS) {
          let taskId = null;
          if (e.ext_id) {
            const { rows } = await query('SELECT id FROM tasks WHERE external_id = $1', [e.ext_id]);
            if (rows.length > 0) taskId = rows[0].id;
          }
          const escalatedAt = new Date(Date.now() - (e.offset_days || 0) * 86400000).toISOString();
          const respondedAt = e.manager_response ? escalatedAt : null;
          await query(
            `INSERT INTO escalations (task_id, subject, reason, escalated_by, escalated_at, manager_id, manager_name, status, manager_response_status, manager_response, manager_responded_at, escalation_source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [taskId, e.subject, e.reason, e.escalated_by, escalatedAt, e.manager_id, e.manager_name, e.status, e.manager_response_status, e.manager_response || null, respondedAt, e.escalation_source]
          );
        }

        // --- Projects ---
        for (const p of SEED_PROJECTS) {
          await query(
            `INSERT INTO projects (title, type, status, priority, owner_id, team_id, deadline, description, progress)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [p.title, p.type, p.status, p.priority, p.owner_id, p.team_id, p.deadline, p.description, p.progress]
          );
        }

        // --- Requests ---
        for (const r of SEED_REQUESTS) {
          await query(
            `INSERT INTO requests (subject, description, to_team, status, priority, from_member_id, external_ref, due_date, resolved_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [r.subject, r.description, r.to_team, r.status, r.priority, r.from_member_id, r.external_ref, r.due_date, r.resolved_at || null]
          );
        }

        // --- Announcements ---
        for (const a of SEED_ANNOUNCEMENTS) {
          await query(
            `INSERT INTO announcements (type, title, body, target, priority, is_popup, status, author_id, pinned, link)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [a.type, a.title, a.body, a.target, a.priority, a.is_popup, a.status, a.author_id, a.pinned || false, a.link || null]
          );
        }

        console.log('[db] All seed data inserted.');
      }
    } catch (err) {
      console.error('[db] Startup migration/seed error:', err.message);
      // Don't crash — app falls back to mock data
    }
  }
}
