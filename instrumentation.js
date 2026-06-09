// ── Boot-time wipe alarm ────────────────────────────────────────────────────
// Tables that should never be empty in a healthy production boot. Every boot
// we read current row counts, compare to the snapshot stored in
// app_settings.boot_row_counts_snapshot, and log a LOUD warning if any table
// dropped by ≥ 50% (or non-zero → zero). This is observability only — never
// fails boot, never deletes anything. It's an early-warning system so that
// a silent wipe (like the 2026-05-05 CNPG-recreation incident) is screaming
// in the pod logs within seconds of pod start, instead of being discovered
// by a confused user a day later.
//
// Rationale: a "table emptied by mistake" failure mode is what bit us hardest
// during the May 6 recovery — the pod came up, login worked, the UI rendered,
// but the queue/announcements/HR Hub were silently empty. A cheap 5-query
// SELECT count(*) at boot would have caught it immediately.
const WIPE_ALARM_TABLES = [
  'announcements',
  'hr_hub_request',
  'team_member_overrides',
  'feedback_requests',
  'members',
  // OOO / Handovers (Phase 1, 2026-05-11) — once seeded, a wipe of these
  // would silently empty the calendar and lose every in-flight handover.
  'time_off_events',
  'handovers',
];

async function checkForWipe(query) {
  const current = {};
  for (const t of WIPE_ALARM_TABLES) {
    try {
      const { rows } = await query(`SELECT count(*)::bigint AS c FROM public.${t}`);
      current[t] = parseInt(rows[0]?.c ?? 0, 10);
    } catch (err) {
      // Table may not exist yet on a brand-new env mid-migration; just skip.
      current[t] = null;
    }
  }

  let previous = null;
  try {
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = 'boot_row_counts_snapshot' LIMIT 1`,
    );
    if (rows[0]?.value) previous = rows[0].value;
  } catch {
    // app_settings not ready yet — first boot of a fresh env. Move on.
  }

  if (previous && typeof previous === 'object') {
    const dropped = [];
    for (const t of WIPE_ALARM_TABLES) {
      const prev = Number(previous[t] ?? 0);
      const curr = Number(current[t] ?? 0);
      if (current[t] === null) continue; // skipped table — don't compare
      // Trigger if previous was non-trivial AND current is < half OR exactly 0.
      if (prev >= 5 && (curr === 0 || curr < prev * 0.5)) {
        dropped.push({ table: t, before: prev, now: curr });
      }
    }
    if (dropped.length > 0) {
      const banner = '━'.repeat(72);
      console.error(banner);
      console.error('🚨 [boot-wipe-alarm] DATA LOSS DETECTED on this boot 🚨');
      console.error('   Tables that shrank sharply since the previous boot:');
      for (const d of dropped) {
        console.error(`     - ${d.table}: ${d.before} → ${d.now} rows (lost ${d.before - d.now})`);
      }
      console.error('   This usually means the underlying CNPG PVC was');
      console.error('   recreated empty (database.enabled flip, storage class');
      console.error('   reclaim, manual delete, etc.). DO NOT continue making');
      console.error('   destructive changes — see docs/runbook-data-recovery.md');
      console.error('   for the restore procedure.');
      console.error(banner);
    } else {
      console.log('[boot-wipe-alarm] OK — no sharp row-count drops since last boot.');
    }
  } else {
    console.log('[boot-wipe-alarm] No prior snapshot; baseline established for next boot.');
  }

  // Persist current snapshot for next boot's comparison. Best-effort.
  try {
    await query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('boot_row_counts_snapshot', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(current)],
    );
  } catch (err) {
    console.warn('[boot-wipe-alarm] Failed to update snapshot:', err?.message);
  }
}

export async function register() {
  // Watchdog runs in every server boot regardless of DB availability —
  // memory issues happen even when the DB is offline (mock-data paths,
  // build pre-render, etc.). Imported dynamically + Node-runtime gated
  // so the Edge bundle (used by middleware) never pulls in
  // `process.memoryUsage`, which Turbopack's static analyser flags as
  // Edge-runtime incompatible.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { startMemoryWatchdog } = await import('./src/lib/memory-watchdog');
      startMemoryWatchdog();
    } catch (err) {
      console.warn('[memory-watchdog] could not start:', err?.message);
    }
  }

  // Only run migrations on the server, not during build
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DATABASE_URL) {
    try {
      const { runMigrations } = await import('./src/lib/migrate');
      await runMigrations();

      const { query } = await import('./src/lib/db');

      // Detect data loss BEFORE the seed step below — seeding members/tasks
      // when their tables are empty masks a wipe by re-creating demo content.
      // We want the alarm to fire on the original empty state, not the post-
      // seed state.
      try {
        await checkForWipe(query);
      } catch (alarmErr) {
        console.warn('[boot-wipe-alarm] checkForWipe failed (non-fatal):', alarmErr?.message);
      }

      // Phase 3 — start the handover scope cache. Eager-loads delegation
      // map at boot and refreshes every 60 s. Without this the coverer's
      // workspace would NOT pick up the OOO person's queues until the
      // next handover write triggered an invalidation. Wrapped in try so
      // a missing table (fresh env mid-migration) never blocks boot.
      try {
        const { startHandoverScopeCacheRefresher } = await import('./src/lib/handover-scope-cache-loader');
        startHandoverScopeCacheRefresher();
      } catch (cacheErr) {
        console.warn('[handover-scope-cache] start failed (non-fatal):', cacheErr?.message);
      }

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
        console.log('[db] Seeding tasks, activity, notes, escalations, projects, requests...');
        const {
          SEED_TASKS, SEED_TASK_ACTIVITY, SEED_TASK_NOTES,
          SEED_ESCALATIONS, SEED_PROJECTS, SEED_REQUESTS,
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

        // Announcements are deliberately NOT seeded. They were previously
        // bootstrapped from SEED_ANNOUNCEMENTS, but that meant the demo
        // "HRX Continuity & Redundancy Plan" and "Payroll Freeze" popups
        // resurfaced on every fresh container with an empty tasks table,
        // even after an approver had archived or deleted them server-side
        // on the previous deployment. Announcements must be authored
        // through the app, full stop.

        console.log('[db] All seed data inserted.');
      }

      // ── Zendesk SLA background sync ─────────────────────────────────
      // Pulls policy_metrics (real FRT/NRT breach times) into our local
      // `zendesk_ticket_sla` table so the queue route's per-row pills
      // reflect Zendesk's actual SLA — not our local "anchor + 24h"
      // approximation. Runs out-of-band so the queue stays cheap.
      //
      // Schedule: 30 s after boot (priming kick), then every 10 min.
      // Multi-pod safe via the DB lock in zendesk-sla-sync.js — only
      // one pod runs at a time; the others no-op until the lock or the
      // soft TTL frees.
      //
      // Disable knob: set OPS_HUB_DISABLE_ZD_SLA_SYNC=1 to skip the
      // scheduler (for the cron-driven deploys where an external
      // CronJob hits /api/v1/cron/zendesk-sla-sync instead).
      if (!process.env.OPS_HUB_DISABLE_ZD_SLA_SYNC) {
        try {
          const { runZendeskSlaSync } = await import('./src/lib/zendesk-sla-sync');
          // Don't await — the sync can take 20-40 s on a cold cache and
          // we don't want it delaying the rest of the boot path.
          setTimeout(() => {
            runZendeskSlaSync().catch(err => {
              console.warn('[zd-sla-sync] priming run failed:', err?.message);
            });
          }, 30_000);
          setInterval(() => {
            runZendeskSlaSync().catch(err => {
              console.warn('[zd-sla-sync] scheduled run failed:', err?.message);
            });
          }, 10 * 60 * 1000).unref?.();
          console.log('[zd-sla-sync] scheduled — priming in 30 s, then every 10 min');
        } catch (err) {
          console.warn('[zd-sla-sync] could not schedule:', err?.message);
        }
      }

      // ── Work-tasks SLA sync (Phase 3, 2026-05-25) ──────────────────
      // Hourly pass that fires task_due_soon (24h before due) +
      // task_overdue notifications for open work_tasks. Idempotent via
      // work_task_sla_notifications ledger; multi-pod safe via the
      // app_settings soft-TTL gate. Priming run 90 s after boot.
      if (!process.env.OPS_HUB_DISABLE_TASKS_SLA_SYNC) {
        try {
          const { runTasksSlaSync } = await import('./src/lib/work-tasks-sla-sync');
          setTimeout(() => {
            runTasksSlaSync().catch(err => {
              console.warn('[tasks-sla-sync] priming run failed:', err?.message);
            });
          }, 90_000);
          setInterval(() => {
            runTasksSlaSync().catch(err => {
              console.warn('[tasks-sla-sync] scheduled run failed:', err?.message);
            });
          }, 60 * 60 * 1000).unref?.();
          console.log('[tasks-sla-sync] scheduled — priming in 90 s, then every 60 min');
        } catch (err) {
          console.warn('[tasks-sla-sync] could not schedule:', err?.message);
        }
      }

      // ── Performance cycle heartbeat (Phase F, 2026-06-09) ──────────
      // Opens the month's perf cycles + fans out monthly reminder
      // notifications (managers: reviews due; members: reflect /
      // acknowledge). The runner self-gates to ~once per UTC day via an
      // app_settings soft-TTL, so a 6 h interval just guarantees the day
      // gets claimed even with restarts. Idempotent per (kind,member,
      // period) — nobody is nudged twice in a month. Multi-pod safe.
      // Disable knob: OPS_HUB_DISABLE_PERF_CYCLE_SYNC=1.
      if (!process.env.OPS_HUB_DISABLE_PERF_CYCLE_SYNC) {
        try {
          const { runPerformanceCycleSync } = await import('./src/lib/performance-cycle-sync');
          setTimeout(() => {
            runPerformanceCycleSync().catch(err => {
              console.warn('[perf-cycle] priming run failed:', err?.message);
            });
          }, 120_000);
          setInterval(() => {
            runPerformanceCycleSync().catch(err => {
              console.warn('[perf-cycle] scheduled run failed:', err?.message);
            });
          }, 6 * 60 * 60 * 1000).unref?.();
          console.log('[perf-cycle] scheduled — priming in 120 s, then every 6 h (self-gated daily)');
        } catch (err) {
          console.warn('[perf-cycle] could not schedule:', err?.message);
        }
      }
    } catch (err) {
      console.error('[db] Startup migration/seed error:', err.message);
      // Don't crash — app falls back to mock data
    }
  }
}
