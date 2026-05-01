// ── HrHubView ───────────────────────────────────────────────────────────────
// Stage 1 stub for the HR Hub tab. The schema, settings seed, and API
// routes are live; this surface is intentionally empty until Stage 2 wires
// the `+`-button popup picker, the create flows, and the list/detail UI.
//
// The empty-state copy doubles as a smoke test: hit /hr-hub with a valid
// session and you should see the Stage 1 status banner. If you see
// "Forbidden" instead, the access-type wiring is wrong — check that
// 'hr-hub' is in ALL_VIEWS and your access type's `views` array.
//
// HR_HUB_PLAN.md is the source of truth for what lands when.

import { useEffect, useState } from 'react';

export default function HrHubView({ user }) {
  const [stageStatus, setStageStatus] = useState(null);

  // Lightweight smoke check: ping the API root and confirm the schema is
  // alive. Helps surface a clean error state if the migration didn't run
  // (e.g., DB unreachable on this pod).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = (typeof localStorage !== 'undefined') ? localStorage.getItem('ops_hub_token') : null;
        const r = await fetch('/api/v1/hr-hub/requests?scope=mine&limit=1', {
          headers: t ? { Authorization: `Bearer ${t}` } : undefined,
        });
        if (cancelled) return;
        if (r.ok) {
          const j = await r.json().catch(() => ({}));
          setStageStatus({ ok: true, total: Array.isArray(j.items) ? j.items.length : 0 });
        } else {
          setStageStatus({ ok: false, status: r.status });
        }
      } catch (err) {
        if (!cancelled) setStageStatus({ ok: false, error: err?.message || 'network error' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, color: '#1b1b1b' }}>HR Hub</h1>
      <p style={{ fontSize: 14, color: '#616161', marginTop: 0, marginBottom: 24 }}>
        A single place to raise HR Requests, HR Reports, Escalation Zero submissions, and Ops Hub feedback.
      </p>

      <div style={{
        background: '#f7f5f2',
        border: '1px solid #e8e8e8',
        borderRadius: 12,
        padding: 16,
        fontSize: 13,
        color: '#1b1b1b',
        lineHeight: 1.55,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Stage 1 — Foundation (live)</div>
        <ul style={{ margin: 0, paddingLeft: 20, color: '#3f3f3f' }}>
          <li>Database schema + seeded defaults for the 4 flows</li>
          <li>API routes (read + write) gated by your existing JWT</li>
          <li>HR Hub Admin access type assignable from the Team tab</li>
        </ul>
        <div style={{ marginTop: 12, fontSize: 12, color: '#7a7059' }}>
          Stage 2 will land the <strong>+ button popup</strong> with the 4 flow picker and the create forms.
          Stage 3 brings the list + detail views, Stage 4 the Slack-style comments + notifications.
          See <code>HR_HUB_PLAN.md</code> for the full roadmap.
        </div>
      </div>

      <div style={{ marginTop: 16, fontSize: 12, color: '#9e9e9e' }}>
        Backend reachability: {stageStatus == null
          ? 'checking…'
          : stageStatus.ok
            ? `OK (you currently have ${stageStatus.total} request${stageStatus.total === 1 ? '' : 's'})`
            : `error (${stageStatus.status || stageStatus.error})`}
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: '#9e9e9e' }}>
        Signed in as <strong>{user?.email || 'unknown'}</strong>
      </div>
    </div>
  );
}
