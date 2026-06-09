// ── ReviewEditor ────────────────────────────────────────────────────────────
// The two-pane monthly review editor for ONE member + period (Phase C).
//   LEFT  — Evaluation: template criteria as Yes/No toggles + KPI points +
//           sentiment + promotion, with a LIVE (client-side, pure) score panel.
//   RIGHT — Monthly Check-In (the HRX deck): wellness, top points, achievements,
//           growth (continue / refine / next level), manager feedback & agreed
//           actions, priorities for next 30 days, workload/boundary risk.
//
// The server recomputes scores authoritatively on save — the LIVE panel here is
// pure-UX preview using only performance-constants (never performance-helpers).
//
// Permissions (props, server-enforced too):
//   • canScore (manager/admin): may score the evaluation, finalize, write the
//     manager-side check-in fields.
//   • isSelf && !canScore (member): may ONLY edit member-side check-in fields,
//     submit their reflection, and acknowledge. Everything else read-only.
//   • review.isLocked: all inputs read-only except member Acknowledge.
import { useState, useMemo, useCallback } from 'react';
import {
  tierFromYesCount, kpiTierFromPoints, bandForScore,
  METRIC_WEIGHTS, MONTH_LABELS, quarterOfMonth,
  WELLNESS_OPTIONS, PROMOTION_OPTIONS, reviewStatusMeta,
} from '../../../lib/performance-constants';
import { upsertPerfReview, patchPerfReview } from '../../../services/performanceApi';
import WarningsPanel from './WarningsPanel';

const PURPLE = '#7c3aed';

// Empty check-in scaffold (flat object, per the contract).
const EMPTY_CHECKIN = {
  wellness: '', memberTopPoints: '', managerTopPoints: '', achievements: '',
  continueDoing: '', refine: '', nextLevel: '', managerFeedback: '',
  agreedActions: '', next30: '', workloadRisk: false,
};

export default function ReviewEditor({
  review = null,
  member = {},
  month,
  year,
  template = null,
  canScore = false,
  isSelf = false,
  onSaved,
  onClose,
}) {
  const isLocked = !!review?.isLocked;
  const status = review?.status || 'draft';

  // ── Local editable state (seeded from the review, falling back to empty) ──
  const [evalAnswers, setEvalAnswers] = useState(() => ({
    ops: { ...(review?.evalAnswers?.ops || {}) },
    growth: { ...(review?.evalAnswers?.growth || {}) },
  }));
  const [kpiPoints, setKpiPoints] = useState(() =>
    review?.kpiPoints == null ? '' : String(review.kpiPoints));
  const [sentiment, setSentiment] = useState(() => Number(review?.sentiment) || 3);
  const [promotion, setPromotion] = useState(() => review?.promotion || 'no');
  const [checkin, setCheckin] = useState(() => ({ ...EMPTY_CHECKIN, ...(review?.checkin || {}) }));

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);

  const opsCriteria = template?.operationsCriteria || [];
  const growthCriteria = template?.growthCriteria || [];
  const weights = template?.weights || METRIC_WEIGHTS;

  // Member may edit only their own check-in side; manager (canScore) edits
  // scoring + manager-side fields. Locked rows are read-only for everyone.
  const canScoreNow = canScore && !isLocked;
  const canEditMemberCheckin = (isSelf || canScore) && !isLocked;
  const canEditManagerCheckin = canScore && !isLocked;

  // ── LIVE preview (pure) ──────────────────────────────────────────────────
  const preview = useMemo(() => {
    const opsYes = opsCriteria.filter(c => !!evalAnswers.ops?.[c.key]).length;
    const growthYes = growthCriteria.filter(c => !!evalAnswers.growth?.[c.key]).length;
    const opsTier = tierFromYesCount(opsYes, opsCriteria.length || 1, template?.opsThresholds);
    const growthTier = tierFromYesCount(growthYes, growthCriteria.length || 1, template?.growthThresholds);
    const kpiTier = kpiTierFromPoints(Number(kpiPoints) || 0);
    const w = {
      operations: weights.operations ?? METRIC_WEIGHTS.operations,
      kpi: weights.kpi ?? METRIC_WEIGHTS.kpi,
      growth: weights.growth ?? METRIC_WEIGHTS.growth,
    };
    const weighted = Math.round((opsTier * w.operations + kpiTier * w.kpi + growthTier * w.growth) * 10) / 10;
    const overall = Math.round(weighted);
    const band = bandForScore(weighted);
    return { opsYes, growthYes, opsTier, growthTier, kpiTier, weighted, overall, band };
  }, [evalAnswers, kpiPoints, opsCriteria, growthCriteria, weights, template]);

  // ── Mutators ──────────────────────────────────────────────────────────────
  const toggleCriterion = useCallback((side, key) => {
    if (!canScoreNow) return;
    setEvalAnswers(prev => ({
      ...prev,
      [side]: { ...prev[side], [key]: !prev[side]?.[key] },
    }));
  }, [canScoreNow]);

  const setCheckinField = useCallback((field, val) => {
    setCheckin(prev => ({ ...prev, [field]: val }));
  }, []);

  // Build the upsert payload (create) vs patch payload (existing review).
  const buildScorePayload = () => ({
    evalAnswers,
    kpiPoints: Number(kpiPoints) || 0,
    sentiment: Number(sentiment) || 0,
    promotion,
    checkin,
  });

  const persist = useCallback(async (extra = {}) => {
    setSaving(true); setSaveErr(null);
    try {
      let saved;
      if (review?.id) {
        saved = await patchPerfReview(review.id, { ...buildScorePayload(), ...extra });
      } else {
        saved = await upsertPerfReview({
          memberEmail: member.email,
          month, year,
          ...buildScorePayload(),
          ...extra,
        });
      }
      if (onSaved) onSaved(saved?.review || saved);
      return saved;
    } catch (e) {
      setSaveErr(e?.message || 'Save failed');
      return null;
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review, member, month, year, evalAnswers, kpiPoints, sentiment, promotion, checkin, onSaved]);

  const handleSave = () => persist();
  const handleFinalize = () => persist({ status: 'finalized' });
  const handleSubmitReflection = () => persist({ status: status === 'draft' ? 'member_input' : 'manager_review' });
  const handleAcknowledge = async () => {
    // Acknowledge works even when locked — status-only patch.
    setSaving(true); setSaveErr(null);
    try {
      const saved = await patchPerfReview(review.id, { status: 'acknowledged' });
      if (onSaved) onSaved(saved?.review || saved);
    } catch (e) {
      setSaveErr(e?.message || 'Acknowledge failed');
    } finally {
      setSaving(false);
    }
  };

  const periodLabel = `${MONTH_LABELS[Number(month)] || ''} ${year} · Q${quarterOfMonth(month)}`;
  const sMeta = reviewStatusMeta(status);
  const hasScored = preview.overall > 0;

  return (
    <div style={overlay} onClick={onClose}>
      <style>{RESPONSIVE_CSS}</style>
      <div className="perf-editor-card" style={card} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={headerRow}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
              {member.name || member.email || 'Member'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {[member.title || member.role, periodLabel].filter(Boolean).join(' · ')}
              {member.managerName ? ` · Manager: ${member.managerName}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusPill meta={sMeta} />
            {isLocked && <span style={lockChip}><i className="bi bi-lock-fill" style={{ marginRight: 4 }} />Locked</span>}
            <button onClick={onClose} style={iconBtn} title="Close"><i className="bi bi-x-lg" /></button>
          </div>
        </div>

        {!template && (
          <div style={warnBar}>
            <i className="bi bi-exclamation-triangle" style={{ marginRight: 6 }} />
            No evaluation template resolved for this role — scoring is unavailable.
          </div>
        )}

        <div className="perf-editor-grid" style={grid}>
          {/* ── LEFT: Evaluation ── */}
          <div style={pane}>
            <PaneTitle icon="bi-ui-checks-grid">Evaluation</PaneTitle>

            <CriteriaGroup
              label="🌏 Operations"
              criteria={opsCriteria}
              answers={evalAnswers.ops}
              disabled={!canScoreNow}
              onToggle={(key) => toggleCriterion('ops', key)}
            />
            <CriteriaGroup
              label="🥇 Growth Excellence"
              criteria={growthCriteria}
              answers={evalAnswers.growth}
              disabled={!canScoreNow}
              onToggle={(key) => toggleCriterion('growth', key)}
            />

            {/* KPI points */}
            <div style={fieldRow}>
              <label style={fieldLabel}>KPI points (0–100)</label>
              <input
                type="number" min={0} max={100}
                value={kpiPoints}
                disabled={!canScoreNow}
                onChange={e => setKpiPoints(e.target.value)}
                style={{ ...inp, width: 96, ...(canScoreNow ? {} : roStyle) }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>→ tier {preview.kpiTier}</span>
            </div>

            {/* Sentiment 1–5 */}
            <div style={fieldRow}>
              <label style={fieldLabel}>Sentiment</label>
              <div style={{ display: 'inline-flex', gap: 4 }}>
                {[1, 2, 3, 4, 5].map(n => {
                  const on = Number(sentiment) === n;
                  return (
                    <button key={n}
                      disabled={!canScoreNow}
                      onClick={() => canScoreNow && setSentiment(n)}
                      style={{ ...pillSm, ...(on ? pillSmOn : {}), cursor: canScoreNow ? 'pointer' : 'default' }}>
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Promotion */}
            <div style={fieldRow}>
              <label style={fieldLabel}>Promotion</label>
              <select
                value={promotion}
                disabled={!canScoreNow}
                onChange={e => setPromotion(e.target.value)}
                style={{ ...inp, ...(canScoreNow ? {} : roStyle) }}>
                {PROMOTION_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>

            {/* LIVE score panel */}
            <div style={scorePanel}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
                Live score (preview)
              </div>
              <div style={tierRow}>
                <TierStat label="Operations" tier={preview.opsTier} sub={`${preview.opsYes}/${opsCriteria.length} yes`} />
                <TierStat label="KPI" tier={preview.kpiTier} sub={`${Number(kpiPoints) || 0} pts`} />
                <TierStat label="Growth" tier={preview.growthTier} sub={`${preview.growthYes}/${growthCriteria.length} yes`} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-light)' }}>
                <div style={{ display: 'flex', gap: 18 }}>
                  <div>
                    <div style={bigNumLabel}>Weighted</div>
                    <div style={bigNum}>{preview.weighted.toFixed(1)}</div>
                  </div>
                  <div>
                    <div style={bigNumLabel}>Overall</div>
                    <div style={bigNum}>{preview.overall}</div>
                  </div>
                </div>
                <BandPill band={preview.band} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
                Final = Ops·{(weights.operations ?? METRIC_WEIGHTS.operations)} + KPI·{(weights.kpi ?? METRIC_WEIGHTS.kpi)} + Growth·{(weights.growth ?? METRIC_WEIGHTS.growth)}. The server recomputes on save.
              </div>
            </div>
          </div>

          {/* ── RIGHT: Monthly Check-In ── */}
          <div style={pane}>
            <PaneTitle icon="bi-chat-square-heart">Monthly Check-In</PaneTitle>

            {/* Wellness */}
            <div style={{ marginBottom: 14 }}>
              <label style={blockLabel}>How did the month feel?</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {WELLNESS_OPTIONS.map(o => {
                  const on = checkin.wellness === o.key;
                  return (
                    <button key={o.key}
                      disabled={!canEditMemberCheckin}
                      onClick={() => canEditMemberCheckin && setCheckinField('wellness', o.key)}
                      style={{
                        ...pillSm,
                        cursor: canEditMemberCheckin ? 'pointer' : 'default',
                        ...(on ? { background: o.bg, color: o.color, borderColor: o.color, fontWeight: 700 } : {}),
                      }}>
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <TextArea label="Top points (you)" value={checkin.memberTopPoints}
              onChange={v => setCheckinField('memberTopPoints', v)}
              readOnly={!canEditMemberCheckin}
              placeholder="What stood out for you this month?" />

            <TextArea label="Top points (manager)" value={checkin.managerTopPoints}
              onChange={v => setCheckinField('managerTopPoints', v)}
              readOnly={!canEditManagerCheckin}
              placeholder="Manager's highlights" />

            <TextArea label="Achievements" value={checkin.achievements}
              onChange={v => setCheckinField('achievements', v)}
              readOnly={!canEditMemberCheckin}
              placeholder="Key achievements / shipped work" />

            <div style={growthHeader}>Growth</div>
            <TextArea label="What to continue" value={checkin.continueDoing}
              onChange={v => setCheckinField('continueDoing', v)}
              readOnly={!canEditMemberCheckin} />
            <TextArea label="What to refine" value={checkin.refine}
              onChange={v => setCheckinField('refine', v)}
              readOnly={!canEditMemberCheckin} />
            <TextArea label="What's needed for next level" value={checkin.nextLevel}
              onChange={v => setCheckinField('nextLevel', v)}
              readOnly={!canEditManagerCheckin} />

            <TextArea label="Manager feedback & jointly-agreed actions" value={checkin.managerFeedback}
              onChange={v => setCheckinField('managerFeedback', v)}
              readOnly={!canEditManagerCheckin} />
            <TextArea label="Agreed actions" value={checkin.agreedActions}
              onChange={v => setCheckinField('agreedActions', v)}
              readOnly={!canEditManagerCheckin} />
            <TextArea label="Priorities for next 30 days" value={checkin.next30}
              onChange={v => setCheckinField('next30', v)}
              readOnly={!canEditMemberCheckin} />

            {/* Workload / boundary risk */}
            <div style={fieldRow}>
              <label style={fieldLabel}>Workload / boundary risk?</label>
              <div style={{ display: 'inline-flex', gap: 4 }}>
                {[{ v: true, l: 'Yes' }, { v: false, l: 'No' }].map(opt => {
                  const on = !!checkin.workloadRisk === opt.v;
                  return (
                    <button key={opt.l}
                      disabled={!canEditMemberCheckin}
                      onClick={() => canEditMemberCheckin && setCheckinField('workloadRisk', opt.v)}
                      style={{
                        ...pillSm,
                        cursor: canEditMemberCheckin ? 'pointer' : 'default',
                        ...(on ? (opt.v ? { background: '#fef2f2', color: '#dc2626', borderColor: '#dc2626', fontWeight: 700 } : pillSmOn) : {}),
                      }}>
                      {opt.l}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {member.email && (
          <div style={{ padding: '0 20px 8px' }}>
            <WarningsPanel memberEmail={member.email} memberName={member.name} canIssue={canScore} isSelf={isSelf} compact />
          </div>
        )}

        {/* Footer actions */}
        <div style={footer}>
          {saveErr && <span style={{ color: '#dc2626', fontSize: 12, marginRight: 'auto' }}>{saveErr}</span>}
          {!saveErr && <span style={{ marginRight: 'auto' }} />}

          <button onClick={onClose} style={ghostBtn}>Close</button>

          {/* Member: submit reflection + acknowledge */}
          {isSelf && !canScore && !isLocked && (
            <button onClick={handleSubmitReflection} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Submit my reflection'}
            </button>
          )}
          {isSelf && status === 'finalized' && (
            <button onClick={handleAcknowledge} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>
              <i className="bi bi-check2-circle" style={{ marginRight: 5 }} />{saving ? 'Saving…' : 'Acknowledge'}
            </button>
          )}

          {/* Manager: save + finalize */}
          {canScore && !isLocked && (
            <button onClick={handleSave} disabled={saving} style={{ ...ghostBtn, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          {canScore && !isLocked && (
            <button onClick={handleFinalize} disabled={saving || !hasScored} style={{ ...primaryBtn, opacity: (saving || !hasScored) ? 0.5 : 1 }}
              title={hasScored ? 'Finalize & lock' : 'Score the evaluation first'}>
              <i className="bi bi-lock-fill" style={{ marginRight: 5 }} />Finalize
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────
function PaneTitle({ icon, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <i className={`bi ${icon}`} style={{ fontSize: 15, color: PURPLE }} />
      <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{children}</span>
    </div>
  );
}

function CriteriaGroup({ label, criteria, answers, disabled, onToggle }) {
  if (!criteria || criteria.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: 8 }}>
        {label} ({criteria.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {criteria.map(c => {
          const on = !!answers?.[c.key];
          return (
            <div key={c.key} style={critRow}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{c.label || c.key}</div>
                {c.description && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{c.description}</div>}
              </div>
              <div style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
                <button disabled={disabled} onClick={() => onToggle(c.key)}
                  style={{ ...pillSm, cursor: disabled ? 'default' : 'pointer', ...(on ? { background: '#dcfce7', color: '#15803d', borderColor: '#15803d', fontWeight: 700 } : {}) }}>
                  Yes
                </button>
                <button disabled={disabled} onClick={() => { if (on) onToggle(c.key); }}
                  style={{ ...pillSm, cursor: disabled ? 'default' : 'pointer', ...(!on ? { background: '#f3f3f3', color: 'var(--text-secondary)', borderColor: 'var(--border)', fontWeight: 700 } : {}) }}>
                  No
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TierStat({ label, tier, sub }) {
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1.1 }}>{tier}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{sub}</div>
    </div>
  );
}

function TextArea({ label, value, onChange, readOnly, placeholder }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={blockLabel}>{label}</label>
      <textarea
        value={value || ''}
        readOnly={readOnly}
        placeholder={placeholder || ''}
        onChange={e => onChange(e.target.value)}
        rows={2}
        style={{ ...textarea, ...(readOnly ? roStyle : {}) }}
      />
    </div>
  );
}

function StatusPill({ meta }) {
  return (
    <span style={{ padding: '3px 10px', borderRadius: 128, fontSize: 11, fontWeight: 700, color: meta.color, background: meta.bg, border: `1px solid ${meta.color}33` }}>
      {meta.label}
    </span>
  );
}

function BandPill({ band }) {
  return (
    <span style={{ padding: '5px 12px', borderRadius: 128, fontSize: 13, fontWeight: 800, color: band.color, background: band.bg, border: `1px solid ${band.color}33`, whiteSpace: 'nowrap' }}>
      <span style={{ marginRight: 5 }}>{band.emoji}</span>{band.label}
    </span>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  padding: '32px 16px', overflowY: 'auto',
};
const card = {
  width: '100%', maxWidth: 1080, background: 'var(--surface)',
  border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow-lg, 0 12px 48px rgba(0,0,0,0.25))',
  padding: 20, boxSizing: 'border-box',
};
const headerRow = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 };
const grid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 };
const pane = { minWidth: 0 };
const fieldRow = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' };
const fieldLabel = { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', minWidth: 150 };
const blockLabel = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 };
const critRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 10px', border: '1px solid var(--border-light)', borderRadius: 10, background: 'var(--surface-2)' };
const scorePanel = { marginTop: 16, padding: 14, border: `1px solid ${PURPLE}33`, borderRadius: 12, background: 'var(--surface-2)' };
const tierRow = { display: 'flex', gap: 8 };
const bigNum = { fontSize: 26, fontWeight: 800, color: 'var(--text)', lineHeight: 1.1 };
const bigNumLabel = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' };
const growthHeader = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: PURPLE, margin: '4px 0 8px' };
const footer = { display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-light)', flexWrap: 'wrap' };
const warnBar = { padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#d97706', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8 };

const inp = { fontSize: 13, padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box' };
const textarea = { width: '100%', fontSize: 13, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.4 };
const roStyle = { background: 'var(--surface-2)', color: 'var(--text-secondary)', cursor: 'default' };
const pillSm = { fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 128, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary)' };
const pillSmOn = { background: PURPLE, color: '#fff', borderColor: PURPLE, fontWeight: 700 };
const lockChip = { display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 128, padding: '3px 10px' };
const primaryBtn = { fontSize: 13, fontWeight: 700, color: '#fff', background: PURPLE, border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' };
const ghostBtn = { fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' };
const iconBtn = { border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15, padding: 4 };

const RESPONSIVE_CSS = `
@media (max-width: 900px) {
  .perf-editor-grid { grid-template-columns: 1fr !important; }
}
`;
