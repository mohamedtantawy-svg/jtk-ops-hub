// ── StaleCountryDocsBanner ────────────────────────────────────────────────
// Phase D of HANDOVER_TEMPLATE_REVAMP_PLAN.md (§5.4). For country owners,
// surface a banner on Home whenever any of the countries they own has a
// handover doc that's:
//   • status = 'draft' (never published), OR
//   • status = 'published' but updated > 90 days ago, OR
//   • sections_filled < 3 (we treat as "thin" — barely useful as a
//     handover).
//
// The banner is silent for users who own no countries OR whose owned docs
// are all fresh. Clicking jumps to OOO tab → Country docs sub-tab and pre-
// selects the worst-offender country code.

import { useEffect, useMemo, useState } from 'react';
import { listCountryHandoverDocs } from '../../services/countryHandoverDocsApi';

const STALE_DAYS = 90;

function classifyDoc(d) {
  if (!d) return null;
  if (d.status !== 'published') return 'draft';
  if (d.freshness === 'stale') return 'stale';
  if ((d.counts?.sections_filled || 0) < 3) return 'thin';
  return 'fresh';
}

export default function StaleCountryDocsBanner({ user, members, setView }) {
  const [docs, setDocs] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listCountryHandoverDocs()
      .then(res => { if (!cancelled) { setDocs(Array.isArray(res?.items) ? res.items : []); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const ownedCountries = useMemo(() => {
    const me = (members || []).find(m => (m?.email || '').toLowerCase() === (user?.email || '').toLowerCase());
    return new Set((me?.countries || []).map(c => String(c).toUpperCase()));
  }, [user, members]);

  const offenders = useMemo(() => {
    return docs
      .filter(d => ownedCountries.has((d.country_code || '').toUpperCase()))
      .map(d => ({ cc: d.country_code, state: classifyDoc(d), updatedAt: d.updated_at }))
      .filter(d => d.state && d.state !== 'fresh')
      .sort((a, b) => {
        // draft < thin < stale (worst first)
        const order = { draft: 0, thin: 1, stale: 2 };
        return (order[a.state] ?? 9) - (order[b.state] ?? 9);
      });
  }, [docs, ownedCountries]);

  if (!loaded || offenders.length === 0) return null;

  const worst = offenders[0];

  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
        background: '#FEF3C7',
        border: '1px solid #FDE68A',
        borderRadius: 12,
        color: '#92400E',
        fontSize: 13,
      }}
    >
      <i className="bi-journal-text" style={{ fontSize: 18, color: '#B45309', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>
          {offenders.length} country handover doc{offenders.length === 1 ? '' : 's'} need{offenders.length === 1 ? 's' : ''} your attention
        </div>
        <div style={{ fontSize: 12, marginTop: 2, color: '#92400E' }}>
          {offenders.slice(0, 6).map(o => (
            <span key={o.cc} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              marginRight: 8,
              padding: '1px 8px', borderRadius: 999,
              background: 'rgba(180, 83, 9, 0.12)', color: '#92400E',
              fontWeight: 600, fontSize: 11,
            }}>
              {o.cc} · {o.state}
            </span>
          ))}
          {offenders.length > 6 && (
            <span style={{ fontSize: 11, fontStyle: 'italic' }}>+{offenders.length - 6} more</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          try { localStorage.setItem('ops_hub_ooo_sub_tab', 'country_docs'); } catch {}
          setView?.('ooo');
        }}
        style={{
          padding: '6px 14px',
          borderRadius: 999,
          border: '1px solid #B45309',
          background: 'transparent',
          color: '#B45309',
          fontSize: 12, fontWeight: 700, cursor: 'pointer',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap', flexShrink: 0,
        }}
      >
        Open {worst.cc} →
      </button>
    </div>
  );
}
