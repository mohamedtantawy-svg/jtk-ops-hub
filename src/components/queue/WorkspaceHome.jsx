// ── WorkspaceHome ─────────────────────────────────────────────────────────
// The default landing on Workspace BEFORE any source / tool filter is
// chosen. Gives the team three things in one screen:
//
//   1. Priority of the day  — admin-editable banner. Whatever Mohamed
//                              types here is what every team member sees
//                              first when they open Workspace.
//   2. Working order guide  — 4 numbered steps that codify the team
//                              triage rule: "Clear breaches first across
//                              every Q, then Zendesk, then Workbench,
//                              then everything else." Each step shows a
//                              live count + click-through.
//   3. Quick stats footer    — total items in the manager's scope so the
//                              team feels the volume at a glance.
//
// Reads pre-scoped row arrays from Queue.jsx so counts agree with what
// the user sees in each tab. No new endpoints beyond the priority one.

import { useState, useMemo, useEffect, useCallback, useContext } from 'react';
import { TOOLS } from '../../data/constants';
import { slaInfo } from '../../utils/helpers';
import { useQueuePriority } from '../../hooks/useQueuePriority';
import { PermissionsContext } from '../../App';

function rowSlaSeverity(row) {
  if (!row) return 'ok';
  if (row.slaBreachStatus === 'SLA_BREACHED' || (typeof row.slaRemaining === 'number' && row.slaRemaining <= 0)) return 'breached';
  if (typeof row.slaRemaining !== 'number') return 'ok';
  const windowSeconds = Number.isFinite(row.slaWindowMs) && row.slaWindowMs > 0
    ? row.slaWindowMs / 1000
    : 24 * 60 * 60;
  return row.slaRemaining > 0 && row.slaRemaining < windowSeconds / 4 ? 'at_risk' : 'ok';
}

function ticketSeverity(t) {
  const s = slaInfo(t);
  if (!s) return 'ok';
  if (s.breach) return 'breached';
  if (!s.ok) return 'at_risk';
  return 'ok';
}

function relTime(iso) {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime?.())) return '';
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function WorkspaceHome({
  user,
  onSelectTool,         // (toolId) => void  — sets fTool
  onSelectSource,       // (sourceId) => void — sets workSource
  onFilterBreached,     // ()       => void  — sets fSla='breached' on the merged view
  // Pre-scoped counts from Queue.jsx — agree with what's in each tab
  zdCount = 0,
  jiraCount = 0,
  ticketRows = [],      // ZD + Jira merged, post-scope, status !== 'resolved'
  onboardingCount = 0,
  offboardingCount = 0,
  amendmentsCount = 0,
  redlinesCount = 0,
  workbenchCount = 0,
  incentivePlansCount = 0,
  sourceRowsAll = [],   // all Deel-source rows (already scoped) for breach detection
  // Authoritative breach count from Queue.jsx — keeps the "Clear all
  // breaches" card aligned with the SLA pill on workspace home. When
  // omitted (no consumer today, but kept as a fallback) we compute the
  // same aggregate locally.
  breachedCount: breachedCountProp,
}) {
  const perms = useContext(PermissionsContext);
  const isAdmin = perms?.dataScope === 'all_tasks';

  const { priority, updatedBy, updatedAt, isDefault, save, saving, error } = useQueuePriority();
  const [editing, setEditing] = useState(false);
  const [headlineDraft, setHeadlineDraft] = useState('');
  const [messageDraft, setMessageDraft] = useState('');

  useEffect(() => {
    if (!editing && priority) {
      setHeadlineDraft(priority.headline || '');
      setMessageDraft(priority.message || '');
    }
  }, [priority, editing]);

  const startEdit = useCallback(() => {
    setHeadlineDraft(priority?.headline || '');
    setMessageDraft(priority?.message || '');
    setEditing(true);
  }, [priority]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setHeadlineDraft(priority?.headline || '');
    setMessageDraft(priority?.message || '');
  }, [priority]);

  const submit = useCallback(async () => {
    const result = await save({ headline: headlineDraft.trim(), message: messageDraft.trim() });
    if (result.ok) setEditing(false);
  }, [save, headlineDraft, messageDraft]);

  // ── Live counts ─────────────────────────────────────────────────────────
  // Per Mohamed 2026-05-01 spec: "exclude Jira from the SLA calculation
  // and the breach count on home page". Step 1's "Clear all breaches"
  // tile counts ZD + every Deel-source breach but NOT Jira — Jira's
  // SLA model differs and double-counting it would distort the rule
  // "clear breaches first across every queue".
  const breachedCountFallback = useMemo(() => {
    let n = 0;
    for (const r of sourceRowsAll) if (rowSlaSeverity(r) === 'breached') n++;
    for (const t of ticketRows) {
      if (t.source === 'jira') continue;
      if (ticketSeverity(t) === 'breached') n++;
    }
    return n;
  }, [sourceRowsAll, ticketRows]);
  const breachedCount = typeof breachedCountProp === 'number' ? breachedCountProp : breachedCountFallback;

  const totalOpen =
    zdCount + jiraCount + onboardingCount + offboardingCount +
    amendmentsCount + redlinesCount + workbenchCount + incentivePlansCount;

  const restOpen =
    onboardingCount + offboardingCount + amendmentsCount +
    redlinesCount + incentivePlansCount;

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const updaterName = updatedBy ? updatedBy.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null;

  return (
    <div style={{
      flex: 1, overflow: 'auto', background: 'var(--surface-2)',
      padding: '24px 32px 80px',
    }}>
      {/* ── Hero — Priority of the Day ─────────────────────────────── */}
      <div style={{
        position: 'relative',
        borderRadius: 24,
        overflow: 'hidden',
        background: 'radial-gradient(circle at 0% 0%, #2d1b69 0%, #1a103f 35%, #0e0628 70%, #050211 100%)',
        boxShadow: '0 20px 60px -20px rgba(45, 27, 105, 0.55), 0 8px 24px -8px rgba(0,0,0,0.25)',
        marginBottom: 28,
      }}>
        {/* Decorative grain + glow rings */}
        <div aria-hidden style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage:
            'radial-gradient(800px 320px at 12% -10%, rgba(124,58,237,0.55), transparent 60%),' +
            'radial-gradient(700px 360px at 92% 110%, rgba(236,72,153,0.32), transparent 65%),' +
            'radial-gradient(500px 240px at 68% 0%, rgba(56,189,248,0.18), transparent 70%)',
        }} />
        <div aria-hidden style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.06,
          backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'140\' height=\'140\'><filter id=\'n\'><feTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'2\'/><feColorMatrix values=\'0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.55 0\'/></filter><rect width=\'100%\' height=\'100%\' filter=\'url(%23n)\'/></svg>")',
        }} />

        <div style={{ position: 'relative', padding: '28px 36px 36px', color: 'white' }}>
          {/* Top row — greeting + edit button */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 18 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 128,
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.85)',
                letterSpacing: '0.12em', textTransform: 'uppercase',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 12px #34d399' }} />
                Priority of the day
              </div>
              <div style={{
                fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 14, fontWeight: 500,
              }}>
                {greeting}, team.
              </div>
            </div>
            {isAdmin && !editing && (
              <button onClick={startEdit}
                style={{
                  padding: '8px 14px', borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)',
                  color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  backdropFilter: 'blur(6px)',
                  transition: 'background .15s, transform .12s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.16)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                <i className="bi-pencil-fill" style={{ fontSize: 11 }} />
                Edit priority
              </button>
            )}
          </div>

          {/* Body — display vs. edit mode */}
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                value={headlineDraft}
                onChange={(e) => setHeadlineDraft(e.target.value)}
                placeholder="Today's focus"
                maxLength={80}
                style={{
                  fontSize: 32, fontWeight: 800, letterSpacing: '-0.01em',
                  color: 'white', background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.18)', borderRadius: 12,
                  padding: '12px 16px', outline: 'none', width: '100%',
                  fontFamily: 'inherit',
                }}
              />
              <textarea
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                placeholder="What should the whole team focus on right now?"
                maxLength={600}
                rows={3}
                style={{
                  fontSize: 16, lineHeight: 1.55, color: 'rgba(255,255,255,0.92)',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.18)', borderRadius: 12,
                  padding: '12px 16px', outline: 'none', width: '100%',
                  resize: 'vertical', fontFamily: 'inherit',
                }}
              />
              {error && (
                <div style={{
                  fontSize: 12, color: '#fda4af', background: 'rgba(220,38,38,0.18)',
                  border: '1px solid rgba(220,38,38,0.4)', borderRadius: 10,
                  padding: '8px 12px',
                }}>{error}</div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginRight: 'auto' }}>
                  {messageDraft.length} / 600
                </span>
                <button onClick={cancelEdit} disabled={saving}
                  style={{
                    padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)',
                    background: 'transparent', color: 'rgba(255,255,255,0.85)',
                    fontSize: 12, fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
                  }}>
                  Cancel
                </button>
                <button onClick={submit} disabled={saving || (!headlineDraft.trim() && !messageDraft.trim())}
                  style={{
                    padding: '8px 16px', borderRadius: 10, border: 'none',
                    background: 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)',
                    color: 'white', fontSize: 12, fontWeight: 700,
                    cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
                    boxShadow: '0 4px 14px -2px rgba(168,85,247,0.55)',
                  }}>
                  {saving ? 'Saving…' : 'Publish'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 style={{
                fontSize: 36, fontWeight: 800, letterSpacing: '-0.015em', color: 'white',
                lineHeight: 1.1, margin: 0,
                background: 'linear-gradient(180deg, #ffffff 0%, rgba(255,255,255,0.78) 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                {priority?.headline || "Today's focus"}
              </h1>
              {/* 2026-05-21 audit F26: an admin who clears the body and
                  saves leaves the field as ".." or empty whitespace, which
                  rendered verbatim under a real headline ("Cut-Off
                  Cleanup!!" / ".."). Treat strings ≤2 chars or
                  whitespace-only as empty and hide the paragraph so the
                  headline carries the message on its own. */}
              {(() => {
                const raw = (priority?.message || '').trim();
                const stripped = raw.replace(/^[.\s·•\-]+$/g, '');
                const text = stripped || (priority?.message ? '' : "Clear breaches first across every queue. Then tackle Zendesk, then Workbench, then everything else. Stay paired up — escalate fast.");
                if (!text) return null;
                return (
                  <p style={{
                    fontSize: 17, lineHeight: 1.55, color: 'rgba(255,255,255,0.8)',
                    margin: '12px 0 0', maxWidth: 920,
                  }}>{text}</p>
                );
              })()}
              <div style={{
                marginTop: 18, display: 'flex', alignItems: 'center', gap: 10,
                fontSize: 12, color: 'rgba(255,255,255,0.55)',
              }}>
                {isDefault ? (
                  <>
                    <i className="bi-stars" style={{ fontSize: 12 }} />
                    Default message — admin can override anytime
                  </>
                ) : (
                  <>
                    <i className="bi-broadcast" style={{ fontSize: 12, color: '#34d399' }} />
                    Set by <strong style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 700 }}>{updaterName || 'admin'}</strong>
                    <span style={{ opacity: 0.6 }}>·</span>
                    {relTime(updatedAt)}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Section title ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14, padding: '0 4px' }}>
        <h2 style={{
          fontSize: 18, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.01em', margin: 0,
        }}>
          How to work your queues today
        </h2>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
          Top to bottom — no skipping. Breaches always come first.
        </span>
        <span style={{ flex: 1 }} />
        <span style={{
          fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)',
          background: 'var(--surface)', border: '1px solid var(--border)',
          padding: '4px 10px', borderRadius: 128,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {totalOpen.toLocaleString()} open · {breachedCount.toLocaleString()} breached
        </span>
      </div>

      {/* ── 4 step cards ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <StepCard
          step={1}
          accent="linear-gradient(135deg, #f43f5e 0%, #ec4899 100%)"
          accentSolid="#f43f5e"
          accentBg="#fff1f2"
          icon="bi-exclamation-octagon-fill"
          eyebrow="ALWAYS FIRST"
          title="Clear all breaches"
          subtitle="Every queue, oldest breach first. Don't move on until your tab is clean."
          count={breachedCount}
          countLabel={breachedCount === 1 ? 'breached item' : 'breached items'}
          countTone={breachedCount > 0 ? 'urgent' : 'ok'}
          ctaLabel="Show breaches"
          onClick={() => onFilterBreached?.()}
          disabled={breachedCount === 0}
          emptyState="No breaches — keep it that way."
        />

        <StepCard
          step={2}
          accent="linear-gradient(135deg, #29811e 0%, #16a34a 100%)"
          accentSolid="#29811e"
          accentBg="#e8f5e9"
          icon="bi-headset"
          eyebrow="MOST URGENT QUEUE"
          title="Zendesk"
          subtitle="Customer-facing tickets. Keep response times tight, escalate stale ones."
          count={zdCount}
          countLabel={zdCount === 1 ? 'ticket open' : 'tickets open'}
          ctaLabel="Open Zendesk"
          onClick={() => onSelectTool?.('zendesk')}
        />

        <StepCard
          step={3}
          accent="linear-gradient(135deg, #0369a1 0%, #0e7490 100%)"
          accentSolid="#0369a1"
          accentBg="#eff6ff"
          icon="bi-grid-3x3-gap-fill"
          eyebrow="OPS-WORKBENCH"
          title="Workbench"
          subtitle="Internal tasks routed by Deel admin. Drives onboarding, payroll, compliance."
          count={workbenchCount}
          countLabel={workbenchCount === 1 ? 'task open' : 'tasks open'}
          ctaLabel="Open Workbench"
          onClick={() => onSelectSource?.('workbench')}
        />

        <StepCard
          step={4}
          accent="linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)"
          accentSolid="#7c3aed"
          accentBg="#f3eff8"
          icon="bi-collection-fill"
          eyebrow="EVERYTHING ELSE"
          title="Onb · Off · Am · Rl · IP · Jira"
          subtitle="The slower-burn queues. Tackle them after the urgent three are clean."
          count={restOpen + jiraCount}
          countLabel="items open"
          ctaLabel="Pick a queue"
          chips={[
            { label: 'Onb', count: onboardingCount, color: '#7c3aed', bg: '#f3eff8', onClick: () => onSelectSource?.('onboarding') },
            { label: 'Off', count: offboardingCount, color: '#d42d35', bg: '#ffe2de', onClick: () => onSelectSource?.('offboarding') },
            { label: 'Am',  count: amendmentsCount,  color: '#ed8d00', bg: '#fff8e6', onClick: () => onSelectSource?.('amendments') },
            { label: 'Rl',  count: redlinesCount,    color: '#7c3aed', bg: '#f3eff8', onClick: () => onSelectSource?.('redlines') },
            { label: 'IP',  count: incentivePlansCount, color: '#0e7490', bg: '#ecfeff', onClick: () => onSelectSource?.('incentive_plans') },
            { label: 'Jira',count: jiraCount,        color: '#1f74b3', bg: '#e8f0fe', onClick: () => onSelectTool?.('jira') },
          ]}
        />
      </div>

      {/* ── Footer hint ─────────────────────────────────────────── */}
      <div style={{
        marginTop: 24, padding: '12px 16px', borderRadius: 12,
        background: 'var(--surface)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 12, color: 'var(--text-secondary)',
      }}>
        <i className="bi-info-circle-fill" style={{ fontSize: 13, color: '#0e7490' }} />
        <span>
          Click any card to jump straight in. Want to leave this view? Pick a tab above
          (<strong style={{ color: 'var(--text)' }}>Onboarding</strong> /
          {' '}<strong style={{ color: 'var(--text)' }}>Zendesk</strong> /
          {' '}<strong style={{ color: 'var(--text)' }}>Jira</strong> …).
        </span>
        <span style={{ flex: 1 }} />
        {user?.email && (
          <span style={{ color: 'var(--text-muted)' }}>Signed in as <strong style={{ color: 'var(--text)' }}>{user.name || user.email}</strong></span>
        )}
      </div>
    </div>
  );
}

// ── Sub: a single step card ─────────────────────────────────────────
function StepCard({
  step, accent, accentSolid, accentBg,
  icon, eyebrow, title, subtitle,
  count, countLabel, countTone,
  ctaLabel, onClick,
  disabled = false,
  emptyState = null,
  chips = null,
}) {
  const showEmpty = disabled && emptyState;
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        position: 'relative',
        textAlign: 'left',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 18,
        padding: '20px 18px 18px',
        cursor: disabled ? 'default' : 'pointer',
        overflow: 'hidden',
        transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease',
        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        minHeight: 220,
        display: 'flex', flexDirection: 'column',
        opacity: disabled ? 0.85 : 1,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.transform = 'translateY(-3px)';
        e.currentTarget.style.boxShadow = `0 12px 30px -10px ${accentSolid}40, 0 4px 12px -4px rgba(0,0,0,0.08)`;
        e.currentTarget.style.borderColor = `${accentSolid}55`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.02)';
        e.currentTarget.style.borderColor = '#e8e8e8';
      }}
    >
      {/* Top accent bar */}
      <div aria-hidden style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 4,
        background: accent,
      }} />

      {/* Step number + icon */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: accent, color: 'white',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em',
          boxShadow: `0 6px 16px -6px ${accentSolid}88`,
        }}>{step}</div>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: accentBg, color: accentSolid,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <i className={icon} style={{ fontSize: 14 }} />
        </div>
      </div>

      {/* Eyebrow */}
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: '0.12em',
        color: accentSolid, textTransform: 'uppercase', marginBottom: 4,
      }}>{eyebrow}</div>

      {/* Title */}
      <div style={{
        fontSize: 18, fontWeight: 800, color: 'var(--text)',
        letterSpacing: '-0.01em', marginBottom: 6, lineHeight: 1.2,
      }}>{title}</div>

      {/* Subtitle */}
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45, marginBottom: 12 }}>
        {subtitle}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Count + label */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
        <span style={{
          fontSize: 32, fontWeight: 800, lineHeight: 1,
          color: showEmpty ? '#15803d' : (countTone === 'urgent' && count > 0 ? accentSolid : '#1b1b1b'),
          fontVariantNumeric: 'tabular-nums',
        }}>
          {showEmpty ? '✓' : count.toLocaleString()}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
          {showEmpty ? '' : countLabel}
        </span>
      </div>

      {/* Chips (Step 4 only) */}
      {chips && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8, marginBottom: 10 }}>
          {chips.map(c => (
            <span
              key={c.label}
              role="button" tabIndex={0}
              onClick={(e) => { e.stopPropagation(); c.onClick?.(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); c.onClick?.(); } }}
              style={{
                fontSize: 10, fontWeight: 700,
                background: c.bg, color: c.color,
                padding: '3px 8px', borderRadius: 128,
                cursor: 'pointer',
                fontVariantNumeric: 'tabular-nums',
                transition: 'transform .12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              {c.label} {(c.count || 0).toLocaleString()}
            </span>
          ))}
        </div>
      )}

      {/* CTA */}
      <div style={{
        marginTop: 4,
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 12, fontWeight: 700,
        color: showEmpty ? '#15803d' : accentSolid,
      }}>
        {showEmpty ? (
          <>
            <i className="bi-check-circle-fill" style={{ fontSize: 12 }} />
            {emptyState}
          </>
        ) : (
          <>
            {ctaLabel}
            <i className="bi-arrow-right" style={{ fontSize: 12 }} />
          </>
        )}
      </div>
    </button>
  );
}
