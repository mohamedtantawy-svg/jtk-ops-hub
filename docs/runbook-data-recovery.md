# Runbook — CNPG data wipe / restore

How to restore the Ops Hub Postgres data when the in-cluster CNPG cluster is empty or stale, using a S3 basebackup taken by the daily ScheduledBackup.

This runbook documents the procedure executed on **2026-05-06** to recover from a `database.enabled: false` reconciliation cycle that destroyed the in-cluster PVC the day prior.

## When to use this

- Team is reporting "I don't see my announcements / HR Hub tickets / leader alerts"
- Row counts in `announcements`, `hr_hub_request`, `team_member_overrides` are at or near zero
- The CNPG cluster `jtk-ops-hub-v2-pg` was recently recreated (check `kubectl -n jtk-ops-hub-v2 get cluster ... -o yaml | grep creationTimestamp`)
- A `database.enabled: false → true` cycle in Helm values is visible in recent commit history

## Symptoms vs cause matrix

| Symptom | Likely cause |
|---|---|
| App loads, login works, all features show empty lists | DB connected but PVC was recreated empty |
| Login fails with 5xx | DATABASE_URL not set (different problem; check pod env) |
| Some tables full, some empty | Partial restore from a previous incident; resume from where it stopped |

## Prerequisites

- Original tarball backup at hand (e.g. `~/Desktop/ops-hub/jtk-ops-hub-v2-backup-YYYYMMDDTHHMMSS.tar.gz`) **or** S3 access to `s3://<bucket>/jtk-ops-hub-v2/db_backup/`
- macOS or Linux with `tar`, `node`, `npm`
- Postgres 16 binaries (`postgres`, `pg_ctl`, `pg_dump`, `psql`, `pg_resetwal`) — install via Postgres.app DMG or Homebrew
- Access to Nexus's **SQL Migration** panel (or `DATABASE_URL` to run psql directly)

## Step 1 — Extract the basebackup locally

```bash
mkdir -p /tmp/ops-hub-pgdata
tar -xzf ~/Desktop/ops-hub/jtk-ops-hub-v2-backup-<TIMESTAMP>.tar.gz -C /tmp/ops-hub-pgdata
chmod 700 /tmp/ops-hub-pgdata
```

Verify it's a complete PG 16 data directory:

```bash
cat /tmp/ops-hub-pgdata/PG_VERSION   # → 16
ls /tmp/ops-hub-pgdata/base/         # → 1, 4, 5, 16385 (16385 is the `app` DB)
```

## Step 2 — Sanitize CNPG-specific config

The basebackup carries CNPG operator config that references `/controller/...` paths that don't exist on macOS. Strip them and rotate the WAL pointer to make the directory startable without WAL replay.

```bash
mkdir -p /tmp/ops-hub-pg-run
mv /tmp/ops-hub-pgdata/backup_label /tmp/ops-hub-pgdata/.backup_label.orig
: > /tmp/ops-hub-pgdata/custom.conf       # truncate
: > /tmp/ops-hub-pgdata/override.conf
chmod 600 /tmp/ops-hub-pgdata/postgresql.auto.conf
: > /tmp/ops-hub-pgdata/postgresql.auto.conf

# Trust auth for local recovery (replace pg_hba.conf)
cat > /tmp/ops-hub-pgdata/pg_hba.conf <<'EOF'
local all all trust
host  all all 127.0.0.1/32 trust
host  all all ::1/128 trust
EOF

# Reset WAL state — required because basebackup is taken without accompanying
# WAL segments (those live separately in S3). Without this, postgres refuses
# to start with "could not locate a valid checkpoint record".
/path/to/pg16/bin/pg_resetwal -f /tmp/ops-hub-pgdata
```

⚠ **`pg_resetwal -f` is a one-way operation.** It only modifies WAL bookkeeping, not the data files. The original tarball remains intact on disk — re-extract if you need to start over.

## Step 3 — Start postgres against the extracted backup

```bash
/path/to/pg16/bin/pg_ctl -D /tmp/ops-hub-pgdata \
  -l /tmp/ops-hub-pg-run/server.log \
  -o "-c listen_addresses=localhost -c port=5433 -c unix_socket_directories=/tmp/ops-hub-pg-run -c ssl=off -c archive_mode=off -c logging_collector=off -c shared_preload_libraries=''" \
  start
```

Verify connection:

```bash
/path/to/pg16/bin/psql -h localhost -p 5433 -U app -d app -c '\dt'
```

## Step 4 — Generate FK-safe SQL dumps

Member FKs (`announcements.author_id`, `hr_hub_log.actor_id`, etc.) reference `members.id`. Since live's IDs may differ from backup's (post-wipe auth-flow auto-creates new rows), generate inserts that resolve `author_id` by **email lookup at insert time**, falling to NULL if the member isn't found:

```sql
INSERT INTO public.announcements (..., author_id, ...) VALUES (...,
  (SELECT id FROM public.members WHERE email = '<author_email>' LIMIT 1),
  ...) ON CONFLICT DO NOTHING;
```

For tables where `user_id` is NOT NULL (e.g. `feedback_votes.user_id`), use `INSERT ... SELECT` so the row is silently skipped if no member matches:

```sql
INSERT INTO public.feedback_votes (...) 
SELECT ..., m.id, ...
FROM public.members m
WHERE m.email = '<voter_email>'
ON CONFLICT DO NOTHING;
```

## Step 5 — Strip heavy fields (attachments, screenshots)

Base64-encoded attachments inflate per-row size dramatically (some `feedback_requests` rows reach 1.7 MB each). Strip them in metadata-only restores; they're recoverable later via UPDATE statements if needed.

Columns to NULL during restore:
- `feedback_requests.screenshot`, `feedback_requests.attachments`
- `hr_hub_request.attachments`, `hr_hub_comment.attachments`
- `announcements.image_url`, `announcement_requests.image_url`
- `leader_alert.attachments`, `leader_alert_comment.attachments`

## Step 6 — Critical upsert pattern for `team_member_overrides`

**This is the trap that bit us on 2026-05-06.** The login flow at three endpoints (`auth/login`, `auth/google/callback`, `me`) creates a "shell row" in `team_member_overrides` with `(email, last_login_at, login_count)` — all other columns NULL. If a backup restore uses `ON CONFLICT (email) DO NOTHING`, those shells are preserved over the backup's full data, and the affected users disappear from the Team tab.

**Use this pattern instead:**

```sql
INSERT INTO team_member_overrides (...) VALUES (...)
ON CONFLICT (email) DO UPDATE SET
  name           = COALESCE(EXCLUDED.name, team_member_overrides.name),
  initials       = COALESCE(EXCLUDED.initials, team_member_overrides.initials),
  title          = COALESCE(EXCLUDED.title, team_member_overrides.title),
  access         = COALESCE(EXCLUDED.access, team_member_overrides.access),
  manager_email  = COALESCE(EXCLUDED.manager_email, team_member_overrides.manager_email),
  team           = COALESCE(EXCLUDED.team, team_member_overrides.team),
  region         = COALESCE(EXCLUDED.region, team_member_overrides.region),
  service        = COALESCE(EXCLUDED.service, team_member_overrides.service),
  country        = COALESCE(EXCLUDED.country, team_member_overrides.country),
  avatar_url     = COALESCE(EXCLUDED.avatar_url, team_member_overrides.avatar_url),
  start_date     = COALESCE(EXCLUDED.start_date, team_member_overrides.start_date),
  is_new         = EXCLUDED.is_new,
  is_deleted     = EXCLUDED.is_deleted,
  on_leave       = EXCLUDED.on_leave,
  -- DO NOT touch last_login_at or login_count: live's are more recent
  is_announcements_admin = team_member_overrides.is_announcements_admin OR EXCLUDED.is_announcements_admin,
  is_access_admin        = team_member_overrides.is_access_admin OR EXCLUDED.is_access_admin,
  is_hr_hub_admin        = team_member_overrides.is_hr_hub_admin OR EXCLUDED.is_hr_hub_admin,
  is_leader_alerts_admin = team_member_overrides.is_leader_alerts_admin OR EXCLUDED.is_leader_alerts_admin,
  updated_at     = EXCLUDED.updated_at;
```

This fills NULLs from backup, preserves any post-wipe edits, OR's admin grants, and never touches login activity.

## Step 7 — Members upsert with sequence alignment

`members.id` is auto-increment. Restoring with explicit IDs without bumping the sequence creates conflicts on subsequent auto-create logins.

```sql
-- Always do this BEFORE inserting members with explicit IDs:
SELECT setval('members_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM members), false);
```

Then use email-keyed upsert (no explicit id, let auto-increment handle it):

```sql
INSERT INTO members (name, initials, role, team, region, country, email, avatar_url, is_active, created_at, updated_at)
VALUES (...)
ON CONFLICT (email) DO UPDATE SET
  name = COALESCE(members.name, EXCLUDED.name),
  ...
  updated_at = NOW();
```

The `lead_id` self-FK requires a second pass, since lead_id can point forward (lead's id > member's id). Run UPDATE statements separately after all members are inserted:

```sql
UPDATE members SET lead_id = (SELECT id FROM members WHERE email = '<lead_email>' LIMIT 1)
WHERE email = '<member_email>';
```

## Step 8 — Loading the SQL into live

Two paths, ranked by reliability:

### A) Direct psql with DATABASE_URL (preferred, ~30s for full restore)

Get DATABASE_URL from Nexus (Secrets / Environment panel) or the AWS Secrets Manager `jtk-ops-hub-v2` secret. Then:

```bash
export DATABASE_URL='postgres://app:PASSWORD@HOST:5432/app?sslmode=require'
/path/to/pg16/bin/psql "$DATABASE_URL" -f /path/to/restore-all.sql
```

The whole script is wrapped in `BEGIN ... COMMIT` — any error rolls back atomically. Rotate the password in AWS afterward.

### B) Nexus SQL Migration panel (chunked, ~10-15 min)

Nexus invokes psql via `psql -c "$SQL"`, which has an **`ARG_MAX` limit around 256 KB**. Anything larger fails with `argument list too long`. Chunk SQL files at ≤ 60 KB and paste each chunk via:

```bash
cat /tmp/restore-chunks/<file>.sql | pbcopy
```

Then in Chrome → SQL Migration panel → ⌘A Delete → ⌘V → Run Migration.

⚠ Don't switch back to a chat window between `pbcopy` and the paste — the clipboard gets overwritten if you copy anything else.

⚠ TextEdit caches files; re-opening the same path with `open -e` shows stale content. Use `pbcopy` for clipboard, not `open -e` + manual copy.

## Step 9 — Verify

```sql
-- Critical user-content row counts (live should equal-or-exceed expected)
SELECT 'announcements' AS tbl, count(*) AS live, 15 AS expected FROM announcements
UNION ALL SELECT 'hr_hub_request', count(*), 120 FROM hr_hub_request
UNION ALL SELECT 'team_member_overrides', count(*), 93 FROM team_member_overrides
UNION ALL SELECT 'members', count(*), 98 FROM members;

-- Admin grants restored
SELECT email, is_access_admin, is_announcements_admin, is_hr_hub_admin, is_leader_alerts_admin
FROM team_member_overrides
WHERE is_access_admin OR is_announcements_admin OR is_hr_hub_admin OR is_leader_alerts_admin;

-- Manager hierarchy intact
SELECT
  (SELECT count(*) FROM members) AS total_members,
  (SELECT count(*) FROM members WHERE lead_id IS NOT NULL) AS with_lead,
  (SELECT count(*) FROM members m WHERE m.lead_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM members lm WHERE lm.id = m.lead_id)) AS broken_lead_fk;
```

Then hard-refresh the app (`⌘Shift+R`) to flush the 5-second roster cache.

## Step 10 — Cleanup

```bash
/path/to/pg16/bin/pg_ctl -D /tmp/ops-hub-pgdata stop -m fast
rm -rf /tmp/ops-hub-pgdata /tmp/ops-hub-pg-run /tmp/restore-*.sql /tmp/restore-chunks
```

Keep the original tarball — it's your forever-snapshot.

## What can go wrong and how to detect it

| Failure mode | Detection | Recovery |
|---|---|---|
| `psql exec failed: argument list too long` | Nexus error message | Chunk smaller (≤ 60 KB) |
| `duplicate key value violates unique constraint "members_pkey"` | Nexus error | Run `setval('members_id_seq', ...)` before INSERTs |
| `null value in column "user_id" of relation "feedback_votes"` | Nexus error | Use `INSERT ... SELECT FROM members WHERE email=...` pattern |
| `violates foreign key constraint "fk_announcements_author"` | Nexus error | Resolve FK via email subquery as in Step 4 |
| Restore "succeeded" but UI still shows missing data | Run Step 9 SQL checks | Likely the shell-row trap from Step 6 — rerun with COALESCE upsert |
| All chunks succeed but `members < 98` | Run Step 9 | Live had auto-created shell rows; rerun with email-keyed members upsert + setval |

## What this runbook does NOT cover

- Restoring `feedback_requests.screenshot` and `*.attachments` JSONB blobs (separate UPDATE pass — generate from backup tarball as needed)
- Restoring `tasks` / `task_activity` / `task_notes` / `escalations` / `projects` / `requests` (mostly demo seeds; user-created rows are typically transient and not worth the FK-chain complexity)
- Restoring CNPG cluster from S3 directly via barman-cloud-restore (this requires Kubernetes / S3 access; preferred path is platform team)

## Future hardening that would prevent recurrence

See the data-safety audit findings — open PRs from 2026-05-06:

1. Storage class with `reclaimPolicy: Retain` (chart change)
2. CNPG `instances: 2` (HA + extra data copy)
3. Backup retention `90d` on ScheduledBackup
4. Login tracking moved to a separate `member_logins` table (eliminates shell-row trap)
5. Country-owners seed: stop the wipe-and-reseed; replace with safe upsert
6. Boot-time wipe alarm in `instrumentation.js`
