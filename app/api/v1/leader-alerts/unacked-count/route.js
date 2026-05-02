// ── /api/v1/leader-alerts/unacked-count ──────────────────────────────────
// GET — number of (status != 'resolved') alerts at or above the configured
//        severity threshold that the current user has NOT yet acked. Drives
//        the sidebar Leaders Alerts badge ("N unacked").
//
// Threshold is read from leader_alert_settings.notifications.sidebarBadgeMinSeverity
// (default: 'medium'). Cached at the request level — the FE polls this on
// the same 30 s cadence as the existing notification bell, so we don't try
// to over-optimise.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { query } from '../../../../../src/lib/db';
import { readAllSettings } from '../../../../../src/lib/leader-alerts-helpers';

const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const settings = await readAllSettings();
    const minSev = settings?.notifications?.sidebarBadgeMinSeverity || 'medium';
    const minRank = SEVERITY_RANK[minSev] ?? 1;
    const allowed = Object.entries(SEVERITY_RANK)
      .filter(([_, rank]) => rank >= minRank)
      .map(([k]) => k);

    const { rows } = await query(
      `SELECT COUNT(*)::int AS count
         FROM leader_alert a
        WHERE a.status <> 'resolved'
          AND a.severity = ANY($2::text[])
          AND NOT EXISTS (
            SELECT 1 FROM leader_alert_ack ack
             WHERE ack.alert_id = a.id
               AND LOWER(ack.email) = $1
          )`,
      [user.email.toLowerCase(), allowed],
    );
    return NextResponse.json({ count: rows[0]?.count || 0, threshold: minSev });
  } catch (err) {
    console.error('[leader-alerts.unacked-count]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}
