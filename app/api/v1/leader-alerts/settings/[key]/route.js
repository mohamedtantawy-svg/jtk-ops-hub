// ── /api/v1/leader-alerts/settings/[key] ─────────────────────────────────
// PUT — write a single settings key (categories | statuses | notifications).
// Alerts Admin only. Stamps `leader_alert_settings_history` with the actor +
// JSON diff so we can audit who changed what.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { query, withTransaction } from '../../../../../../src/lib/db';
import { canAdministerLeaderAlerts, bustSettingsCache } from '../../../../../../src/lib/leader-alerts-helpers';

const ALLOWED_KEYS = new Set(['categories', 'statuses', 'notifications']);

function shallowSanitiseValue(key, value) {
  if (value == null) throw new Error('value is required');
  if (key === 'categories' || key === 'statuses') {
    if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
    if (value.length === 0) throw new Error(`${key} must not be empty`);
    if (value.length > 50) throw new Error(`${key} cannot exceed 50 entries`);
    return value.map(v => ({
      id: typeof v.id === 'string' ? v.id.trim().slice(0, 60) : null,
      label: typeof v.label === 'string' ? v.label.trim().slice(0, 80) : null,
      color: typeof v.color === 'string' ? v.color.trim().slice(0, 12) : null,
      icon: typeof v.icon === 'string' ? v.icon.trim().slice(0, 60) : null,
    })).filter(v => v.label);
  }
  if (key === 'notifications') {
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('notifications must be an object');
    return value;
  }
  throw new Error(`Unsupported key: ${key}`);
}

export async function PUT(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { key } = params;
  if (!ALLOWED_KEYS.has(key)) {
    return NextResponse.json({ error: `Unknown settings key: ${key}` }, { status: 400 });
  }

  const allowed = await canAdministerLeaderAlerts(user);
  if (!allowed) {
    return NextResponse.json({ error: 'Alerts Admin only' }, { status: 403 });
  }

  let payload;
  try { payload = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  let cleanValue;
  try { cleanValue = shallowSanitiseValue(key, payload?.value); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: 400 }); }

  try {
    const { rows: prev } = await query(
      `SELECT value_json FROM leader_alert_settings WHERE key = $1`,
      [key],
    );
    const before = prev[0]?.value_json || null;

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO leader_alert_settings (key, value_json, updated_by_email, updated_at)
         VALUES ($1, $2::jsonb, $3, NOW())
         ON CONFLICT (key) DO UPDATE
         SET value_json = EXCLUDED.value_json,
             updated_by_email = EXCLUDED.updated_by_email,
             updated_at = NOW()`,
        [key, JSON.stringify(cleanValue), user.email.toLowerCase()],
      );
      await client.query(
        `INSERT INTO leader_alert_settings_history (key, before_json, after_json, actor_email, actor_name)
         VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)`,
        [
          key,
          before ? JSON.stringify(before) : null,
          JSON.stringify(cleanValue),
          user.email.toLowerCase(),
          user.name || null,
        ],
      );
    });

    bustSettingsCache();

    return NextResponse.json({ ok: true, key, value: cleanValue });
  } catch (err) {
    console.error('[leader-alerts.settings.put]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}
