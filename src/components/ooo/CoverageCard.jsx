// ── CoverageCard ──────────────────────────────────────────────────────
// Sidebar widget for Briefing that lists the caller's active coverages
// with live merge counts. Counts are derived client-side from the
// already-loaded IntegrationsContext queues, so we avoid a per-render
// roundtrip to the server (and the OOO person's queues are merged into
// the caller's workspace anyway — the data is local).
//
// Inputs:
//   • queueUnified  — usually pulled from IntegrationsContext
//   • tickets       — Zendesk + Jira tickets (from useQueueSync)
//   • onOpen        — opens the OOO view focused on the handover

import { useMemo } from 'react';
import Avatar from '../ui/Avatar';
import { useMyActiveCoverages } from '../../hooks/useMyActiveCoverages';
import { useTeamMembers } from '../../hooks/useTeamMembers';

function formatRange(start, end) {
  if (!start || !end) return '';
  const fmt = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  return start === end ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
}

function countAssigned(items, email) {
  if (!Array.isArray(items) || !email) return 0;
  const lc = email.toLowerCase();
  let n = 0;
  for (const r of items) {
    const ae = (r?.assigneeEmail || '').toLowerCase();
    if (ae === lc) n += 1;
  }
  return n;
}

function CoverageCard({ tickets, queueUnified, onOpen }) {
  const { items: coverages } = useMyActiveCoverages();
  const { items: members } = useTeamMembers();

  const membersByEmail = useMemo(() => {
    const m = new Map();
    for (const x of (members || [])) {
      if (x?.email) m.set(x.email.toLowerCase(), x);
    }
    return m;
  }, [members]);

  // Pre-extract source arrays for counting.
  const onboarding = queueUnified?.onboardingData?.items || [];
  const offboarding = queueUnified?.offboardingData?.items || [];
  const amendments = queueUnified?.amendmentsData?.items || [];
  const workbench = queueUnified?.workbenchData?.items || [];

  const rows = useMemo(() => {
    return coverages.map(c => {
      const email = c.requester_email;
      const t = countAssigned(tickets, email);
      const onb = countAssigned(onboarding, email);
      const off = countAssigned(offboarding, email);
      const amd = countAssigned(amendments, email);
      const wb = countAssigned(workbench, email);
      return {
        ...c,
        member: membersByEmail.get((email || '').toLowerCase()) || null,
        counts: { tickets: t, onboarding: onb, offboarding: off, amendments: amd, workbench: wb,
                  total: t + onb + off + amd + wb },
      };
    });
  }, [coverages, tickets, onboarding, offboarding, amendments, workbench, membersByEmail]);

  if (rows.length === 0) return null;

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border-light)',
        borderRadius: 16,
        padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <i className="bi-people-fill" style={{ color: 'var(--purple, #7c3aed)', fontSize: 14 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Coverage</span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          ({rows.length} active)
        </span>
      </div>

      {rows.map(r => (
        <div key={r.handover_id} style={{
          display: 'flex', flexDirection: 'column', gap: 6,
          padding: '10px 12px',
          borderRadius: 10,
          background: 'rgba(124, 58, 237, 0.04)',
          border: '1px solid rgba(124, 58, 237, 0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar name={r.member?.name || r.requester_email} initials={r.member?.initials} src={r.member?.avatarUrl || r.member?.avatar_url} size="sm" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{r.requester_name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                {formatRange(r.start_date, r.end_date)}{r.country_codes?.length > 0 ? ` · ${r.country_codes.join(', ')}` : ' · full coverage'}
              </div>
            </div>
            {onOpen && (
              <button
                type="button"
                onClick={() => onOpen?.(r)}
                style={{
                  padding: '4px 10px', borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text-secondary)',
                  fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Open
              </button>
            )}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 6,
            fontSize: 10,
            color: 'var(--text-secondary)',
          }}>
            {[
              { label: 'Tickets',  n: r.counts.tickets },
              { label: 'Onb',      n: r.counts.onboarding },
              { label: 'Off',      n: r.counts.offboarding },
              { label: 'Amend',    n: r.counts.amendments },
              { label: 'Workbench',n: r.counts.workbench },
            ].map(stat => (
              <div key={stat.label} style={{
                background: 'var(--surface)',
                border: '1px solid var(--border-light)',
                borderRadius: 6,
                padding: '4px 6px',
                textAlign: 'center',
              }}>
                <div style={{ fontWeight: 700, color: stat.n > 0 ? 'var(--text)' : 'var(--text-secondary)' }}>+{stat.n}</div>
                <div>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default CoverageCard;
