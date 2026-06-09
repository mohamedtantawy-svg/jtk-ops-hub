// ── TeamReviews ─────────────────────────────────────────────────────────────
// The manager review queue (Phase C). A period selector (month + year, default
// the current month/year) drives usePerfReviews({ scope:'team', month, year }).
// The roster renders as a table: Member · Role · Status · Overall (band pill) ·
// an Open/Review button that opens the ReviewEditor (canScore=true) with the
// member's template resolved by role from usePerfTemplates (fallback: first).
import { useMemo, useState } from 'react';
import { usePerfReviews } from '../../../hooks/usePerfReviews';
import { usePerfTemplates } from '../../../hooks/usePerfTemplates';
import {
  bandForScore, MONTH_LABELS, reviewStatusMeta, quarterOfMonth,
} from '../../../lib/performance-constants';
import ReviewEditor from './ReviewEditor';

const PURPLE = '#7c3aed';

export default function TeamReviews({ user, canManage = false }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { reviews, roster, loading, error, refresh } = usePerfReviews({ scope: 'team', month, year });
  const { templates } = usePerfTemplates();
  const [active, setActive] = useState(null); // { member, review, template }

  // Index reviews by member email for quick lookup against the roster.
  const reviewByEmail = useMemo(() => {
    const m = {};
    for (const r of reviews) if (r.memberEmail) m[r.memberEmail.toLowerCase()] = r;
    return m;
  }, [reviews]);

  const resolveTemplate = (roleKey) => {
    if (!templates || templates.length === 0) return null;
    return templates.find(t => t.roleKey === roleKey) || templates[0];
  };

  // Completion: roster entries that have a scored review for this period.
  const reviewedCount = useMemo(
    () => roster.filter(m => {
      const r = reviewByEmail[(m.email || '').toLowerCase()];
      return r && Number(r.overallScore) > 0;
    }).length,
    [roster, reviewByEmail]);

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openReview = (m) => {
    const review = reviewByEmail[(m.email || '').toLowerCase()] || null;
    const roleKey = (review?.roleKey) || m.roleKey || m.role;
    setActive({
      member: { email: m.email, name: m.name, role: m.role, title: m.title, managerName: user?.name },
      review,
      template: resolveTemplate(roleKey),
    });
  };

  const cycleLabel = `${MONTH_LABELS[Number(month)]} ${year} · Q${quarterOfMonth(month)}`;

  return (
    <div style={{ marginTop: 16 }}>
      {/* Period selector + completion */}
      <div style={toolbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={sel}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={m}>{MONTH_LABELS[m]}</option>
            ))}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={sel}>
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>{cycleLabel}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            {reviewedCount} of {roster.length} reviewed
          </span>
          <div style={{ width: 120, height: 6, borderRadius: 128, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{ width: `${roster.length ? (reviewedCount / roster.length) * 100 : 0}%`, height: '100%', background: PURPLE, borderRadius: 128 }} />
          </div>
          <button onClick={refresh} style={iconBtn} title="Refresh"><i className="bi bi-arrow-clockwise" /></button>
        </div>
      </div>

      {error && <Err msg={error} />}
      {loading && roster.length === 0 && <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>}

      {!loading && roster.length === 0 && !error && (
        <div style={emptyCard}>
          <i className="bi bi-people" style={{ fontSize: 28, display: 'block', marginBottom: 10, opacity: 0.4 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>No team members in scope</div>
          <div style={{ fontSize: 12 }}>{canManage ? 'No reports found for this department.' : 'You do not have a managerial scope.'}</div>
        </div>
      )}

      {roster.length > 0 && (
        <div style={tableCard}>
          <div style={{ ...rowBase, ...headRow }}>
            <div style={{ flex: 2, minWidth: 0 }}>Member</div>
            <div style={{ flex: 1 }}>Role</div>
            <div style={{ flex: 1 }}>Status</div>
            <div style={{ width: 70, textAlign: 'right' }}>Overall</div>
            <div style={{ flex: 1, textAlign: 'right' }} />
          </div>
          {roster.map(m => {
            const review = reviewByEmail[(m.email || '').toLowerCase()] || null;
            const scored = Number(review?.overallScore) > 0;
            const band = scored ? bandForScore(review.weightedScore ?? review.overallScore) : null;
            const sMeta = reviewStatusMeta(review?.status || 'draft');
            return (
              <div key={m.email || m.name} style={rowBase}>
                <div style={{ flex: 2, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || m.email}</div>
                  {m.title && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.title}</div>}
                </div>
                <div style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)' }}>{m.role || '—'}</div>
                <div style={{ flex: 1 }}>
                  <span style={{ ...statusPill, color: sMeta.color, background: sMeta.bg, borderColor: `${sMeta.color}33` }}>{sMeta.label}</span>
                </div>
                <div style={{ width: 70, textAlign: 'right' }}>
                  {scored ? (
                    <span style={{ ...overallRing, color: band.color, background: band.bg, border: `1px solid ${band.color}55` }}>{review.overallScore}</span>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                  )}
                </div>
                <div style={{ flex: 1, textAlign: 'right' }}>
                  <button onClick={() => openReview(m)} style={review ? reviewBtn : openBtn}>
                    {review ? 'Review' : 'Open'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {active && (
        <ReviewEditor
          review={active.review}
          member={active.member}
          month={month}
          year={year}
          template={active.template}
          canScore
          isSelf={false}
          onSaved={() => { refresh(); setActive(null); }}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

const Err = ({ msg }) => <div style={{ padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8 }}>{msg}</div>;

const toolbar = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' };
const sel = { fontSize: 13, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' };
const tableCard = { border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)', overflow: 'hidden' };
const rowBase = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border-light)' };
const headRow = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', background: 'var(--surface-2)' };
const statusPill = { display: 'inline-block', padding: '2px 9px', borderRadius: 128, fontSize: 10, fontWeight: 700, border: '1px solid' };
const overallRing = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 30, height: 30, borderRadius: '50%', fontSize: 14, fontWeight: 800, padding: '0 4px' };
const openBtn = { fontSize: 12, fontWeight: 700, color: '#fff', background: PURPLE, border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer' };
const reviewBtn = { fontSize: 12, fontWeight: 600, color: PURPLE, background: 'transparent', border: `1px solid ${PURPLE}`, borderRadius: 8, padding: '5px 13px', cursor: 'pointer' };
const iconBtn = { border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: 4 };
const emptyCard = { padding: '40px 24px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 14, color: 'var(--text-muted)', background: 'var(--surface)' };
