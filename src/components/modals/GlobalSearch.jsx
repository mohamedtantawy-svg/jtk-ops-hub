// ── GlobalSearch — Cmd+K search across every data surface ───────────────────
// Stormie feedback (2026-05-28): searching by Employees name didn't find the
// case, and when a result appeared it wasn't clickable. Mohamed: "when clicked
// it should open a quick card with the task and its details".
//
// The 2026-05-29 rewrite extends the search beyond the Zendesk + Jira tasks
// the panel previously knew about — now it also walks Onboarding / Paused
// Onboarding / Offboarding / Workbench / Amendments / Redlines / Incentive
// Plans. Source rows on those surfaces carry the employee name as `name` or
// `employeeName`, so the employee-name search now succeeds at any cold-load
// cache the surfaces have hydrated. Clicks open an inline quick-card with
// the row's key fields + deep-links to the Deel admin where applicable; the
// quick-card has Back + Close + (optional) "View in Queue" affordances.
//
// Data hooks are SWR-style — they read from cache on mount for an instant
// list, then revalidate in the background. Mounting them inside the search
// modal is cheap on machines that have already visited Queue / Briefing
// (cache warm) and degrades gracefully on a cold first open.

import { useState, useEffect, useRef, useMemo } from 'react';
import { MEMBERS } from '../../data/members';
import { KB_SEARCH_INDEX } from '../../data/knowledge';
import { getFlag, getCountryName } from '../../data/constants';
import { ToolBadge, StatusBadge } from '../ui/Badges';
import { useOnboardingData } from '../../hooks/useOnboardingData';
import { usePausedOnboardingData } from '../../hooks/usePausedOnboardingData';
import { useOffboardingData } from '../../hooks/useOffboardingData';
import { useWorkbenchData } from '../../hooks/useWorkbenchData';
import { useChangeRequestData } from '../../hooks/useChangeRequestData';
import { useIncentivePlansData } from '../../hooks/useIncentivePlansData';

const DEEL_ADMIN_BASE = 'https://admin.deel.network';
const HRX_OPERATIONS_TEAM_ID = 'f235fd21-c5a0-4804-badf-2cc3dc76191e';

const SOURCE_META = {
  onboarding:     { label: 'Onboarding',        icon: 'bi-person-plus-fill',   color: '#0a5a99', viewTarget: 'my-queue' },
  paused:         { label: 'Paused Onboarding', icon: 'bi-pause-circle-fill',  color: '#ed8d00', viewTarget: 'my-queue' },
  offboarding:    { label: 'Offboarding',       icon: 'bi-person-x-fill',      color: '#d42d35', viewTarget: 'my-queue' },
  workbench:      { label: 'Workbench',         icon: 'bi-tools',              color: '#7c3aed', viewTarget: 'my-queue' },
  amendment:      { label: 'Amendment',         icon: 'bi-file-earmark-diff',  color: '#1f74b3', viewTarget: 'my-queue' },
  redline:        { label: 'Redline',           icon: 'bi-file-earmark-text',  color: '#d97706', viewTarget: 'my-queue' },
  incentive_plan: { label: 'Incentive Plan',    icon: 'bi-cash-coin',          color: '#15803d', viewTarget: 'my-queue' },
};

function sourceMetaFor(src) {
  return SOURCE_META[src] || { label: src || 'Item', icon: 'bi-inbox', color: '#616161', viewTarget: 'my-queue' };
}

// Cheap substring match across the most likely identity fields on raw items
// from every source. Each source uses slightly different keys (name vs
// employeeName, country vs exCountry, assignee vs exAssignee, etc) so the
// helper checks every plausible field. Strings only; nulls are skipped.
function matchRow(item, ql) {
  const fields = [
    item.name, item.employeeName, item.subject, item.title,
    item.clientName, item.orgName,
    item.assignee, item.assigneeEmail, item.exAssignee, item.exAssigneeEmail,
    item.country, item.exCountry,
    item.id, item.oid, item.contractId,
  ];
  for (const f of fields) {
    if (f && String(f).toLowerCase().includes(ql)) return true;
  }
  return false;
}

// Convert a raw row from any Deel source into a uniform display shape. The
// search panel + quick card both render against this shape — sources that
// expose unusual fields (e.g. offboarding's exAssignee) collapse here.
function toSourceResult(item, source) {
  return {
    type: 'source',
    source,
    id: item.id || item.oid || item.contractId || `${source}-${(item.name || '').slice(0, 16)}`,
    subject: item.name || item.employeeName || item.subject || 'Unknown',
    clientName: item.clientName || item.orgName || '',
    country: item.country || item.exCountry || '',
    assignee: item.assignee || item.exAssignee || '',
    assigneeEmail: (item.assigneeEmail || item.exAssigneeEmail || '').toLowerCase(),
    status: item.action?.label || item.status || item.flowStep || '',
    raw: item,
  };
}

// Best-effort deep link to the matching Deel admin page for a quick-card.
// Returns null when the source doesn't have an obvious admin URL.
function adminUrlFor(result) {
  if (!result || result.type !== 'source') return null;
  const r = result.raw || {};
  const oid = r.oid || r.contractId;
  switch (result.source) {
    case 'onboarding':
    case 'paused':
      if (oid && r.country && r.flowStep) {
        const lastSeg = String(r.flowStep).split('.').pop();
        return `${DEEL_ADMIN_BASE}/dashboards/employees/${r.country}/status/${encodeURIComponent(r.flowStep)}/contract/${oid}/step/${encodeURIComponent(lastSeg)}`;
      }
      return oid ? `${DEEL_ADMIN_BASE}/contracts/${oid}/details` : null;
    case 'offboarding':
      return oid ? `${DEEL_ADMIN_BASE}/contracts/${oid}/details` : null;
    case 'workbench':
      if (r.id) {
        return `${DEEL_ADMIN_BASE}/ops-workbench/${encodeURIComponent(r.id)}?teamIds%5B%5D=${HRX_OPERATIONS_TEAM_ID}`;
      }
      return null;
    case 'amendment':
    case 'redline':
      return r.id ? `${DEEL_ADMIN_BASE}/eor/change-requests?requestId=${encodeURIComponent(r.id)}` : null;
    default:
      return null;
  }
}

const sectionHeaderStyle = {
  padding: '8px 16px 4px',
  fontSize: 11,
  letterSpacing: '0.06em',
  fontWeight: 700,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
};

const GlobalSearch = ({ tasks, setView, setSelTask, onClose }) => {
  const [q, setQ] = useState('');
  const [hlIdx, setHlIdx] = useState(-1);
  const [selectedResult, setSelectedResult] = useState(null); // null = list view; object = quick-card view
  const iRef = useRef(null);

  useEffect(() => { iRef.current?.focus(); }, []);
  useEffect(() => { setHlIdx(-1); }, [q]);

  // Pull source rows via the same SWR hooks the Queue + Briefing use. Cold
  // first-open with no warm cache returns empty .items until the fetch lands
  // — `loading` indicates that state so the panel can show a hint instead of
  // a misleading "No results".
  const onboarding = useOnboardingData();
  const paused = usePausedOnboardingData();
  const offboarding = useOffboardingData();
  const workbench = useWorkbenchData();
  const changeReq = useChangeRequestData();
  const incentive = useIncentivePlansData();

  const ql = q.trim().toLowerCase();
  const show = ql.length > 1;

  // Build the section list once per query. Each section is rendered only
  // when it has results so an HRX user searching for an employee that only
  // exists in Workbench doesn't see empty Onboarding / Offboarding rails.
  const sections = useMemo(() => {
    if (!show) return [];
    const out = [];

    // Tickets (Zendesk + Jira, merged in props). Body + assigneeEmail were
    // added 2026-05-29 — previously only subject/id/type matched which is
    // why an employee-name search on a Jira ticket whose subject didn't
    // include the name silently returned nothing.
    const ticketHits = (tasks || []).filter(t =>
      t.source !== 'slack' && (
        (t.subject || '').toLowerCase().includes(ql) ||
        (t.id || '').toLowerCase().includes(ql) ||
        (t.type || '').toLowerCase().includes(ql) ||
        (t.body || '').toLowerCase().includes(ql) ||
        (t.assigneeEmail || '').toLowerCase().includes(ql) ||
        (t.assigneeName || '').toLowerCase().includes(ql) ||
        (t.requesterName || '').toLowerCase().includes(ql)
      )
    ).slice(0, 5);
    if (ticketHits.length) out.push({ id: 'tickets', label: 'Queue tickets', results: ticketHits.map(t => ({ type: 'task', item: t })) });

    const slackHits = (tasks || []).filter(t =>
      t.source === 'slack' && (
        (t.subject || '').toLowerCase().includes(ql) ||
        (t.body || '').toLowerCase().includes(ql) ||
        (t.sender || '').toLowerCase().includes(ql)
      )
    ).slice(0, 3);
    if (slackHits.length) out.push({ id: 'slack', label: 'Slack', results: slackHits.map(t => ({ type: 'slack', item: t })) });

    const pushSourceSection = (items, source, sectionLabel) => {
      const hits = (items || []).filter(r => matchRow(r, ql)).slice(0, 5).map(r => toSourceResult(r, source));
      if (hits.length) out.push({ id: source, label: sectionLabel, results: hits });
    };
    pushSourceSection(onboarding.items, 'onboarding', 'Onboarding');
    pushSourceSection(paused.items, 'paused', 'Paused Onboarding');
    pushSourceSection(offboarding.items, 'offboarding', 'Offboarding');
    pushSourceSection(workbench.items, 'workbench', 'Workbench');
    pushSourceSection(changeReq.amendments, 'amendment', 'Amendments');
    pushSourceSection(changeReq.redlines, 'redline', 'Redlines');
    pushSourceSection(incentive.items, 'incentive_plan', 'Incentive Plans');

    const kbHits = KB_SEARCH_INDEX.filter(k => (k.name || '').toLowerCase().includes(ql)).slice(0, 4);
    if (kbHits.length) out.push({ id: 'kb', label: 'Knowledge Hub', results: kbHits.map(k => ({ type: 'kb', item: k })) });

    return out;
  }, [show, ql, tasks, onboarding.items, paused.items, offboarding.items, workbench.items, changeReq.amendments, changeReq.redlines, incentive.items]);

  // Flat index list so keyboard nav (↑↓) walks every result regardless of
  // section. Mirrors the indices the Row's onClick uses below.
  const flatResults = useMemo(() => sections.flatMap(s => s.results), [sections]);
  const hasRes = flatResults.length > 0;

  // True only while every source is still doing its first cold-load. Once
  // any one is hot we can show partial results — "everything still loading"
  // is the only honest empty state during a cold first open of search.
  const anyLoading = (onboarding.loading || paused.loading || offboarding.loading
    || workbench.loading || changeReq.loading || incentive.loading) && !hasRes;

  const handleSelect = (r) => {
    if (!r) return;
    // Per Mohamed 2026-05-29: clicking opens a quick-card preview, not an
    // immediate navigation. The card has explicit "View in Queue" / "Open
    // in Deel admin" CTAs for navigation.
    setSelectedResult(r);
  };

  const handleResultClick = (idx) => {
    handleSelect(flatResults[idx]);
  };

  const handleSearchKey = (e) => {
    if (selectedResult) {
      if (e.key === 'Escape') { setSelectedResult(null); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHlIdx(prev => Math.min(prev + 1, flatResults.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHlIdx(prev => Math.max(prev - 1, -1)); }
    if (e.key === 'Enter' && hlIdx >= 0 && flatResults[hlIdx]) { e.preventDefault(); handleSelect(flatResults[hlIdx]); }
    if (e.key === 'Escape')    { onClose(); }
  };

  const Row = ({ children, onClick, isHighlighted, onMouseEnter }) => (
    <div onClick={onClick} onMouseEnter={onMouseEnter} style={{
      padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
      transition: 'background .1s',
      background: isHighlighted ? 'var(--purple-light)' : 'transparent',
      borderLeft: isHighlighted ? '2px solid var(--purple)' : '2px solid transparent',
    }}
      onMouseLeave={e => { if (!isHighlighted) e.currentTarget.style.background = 'transparent'; }}>
      {children}
    </div>
  );

  // Counter walked alongside the render so each Row's keyboard-highlight
  // index matches the flatResults position.
  let globalIdx = -1;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 800,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '15vh', backdropFilter: 'blur(4px)',
      }}
      role="dialog" aria-modal="true" aria-label="Global search"
      onClick={onClose}
    >
      <style>{`@keyframes modalIn { from { opacity:0; transform:scale(0.96) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
      <div style={{
        background: 'var(--surface)', borderRadius: 'var(--radius-2xl)', width: '100%',
        maxWidth: 560, boxShadow: '0 4px 24px rgba(0,0,0,0.15)', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', maxHeight: '70vh',
        animation: 'modalIn 0.2s cubic-bezier(0.16,1,0.3,1) both',
      }} onClick={e => e.stopPropagation()}>

        {/* Search input (or back row in quick-card mode) */}
        {!selectedResult ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
            <i className="bi-search" style={{ color: 'var(--text-muted)', fontSize: 16, flexShrink: 0 }}></i>
            <input
              ref={iRef}
              autoFocus
              type="text"
              role="combobox"
              aria-expanded={hasRes}
              aria-autocomplete="list"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={handleSearchKey}
              placeholder="Search by employee, client, ticket id, country…"
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 16, color: 'var(--text)', background: 'transparent', fontFamily: 'inherit' }}
            />
            {q && <button aria-label="Clear search" onClick={() => setQ('')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 17, display: 'flex' }}><i className="bi-x"></i></button>}
            <span style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', borderRadius: 5, padding: '2px 7px', fontSize: 11, fontFamily: 'monospace', flexShrink: 0 }}>ESC</span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
            <button onClick={() => setSelectedResult(null)} style={{
              background: 'transparent', border: 'none', color: 'var(--text)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px',
              borderRadius: 6,
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
              <i className="bi-arrow-left" style={{ fontSize: 13 }}></i> Back to results
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} aria-label="Close" style={{
              background: 'transparent', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', fontSize: 17, display: 'flex',
            }}><i className="bi-x"></i></button>
          </div>
        )}

        {/* Body: list, quick-card, or empty/loading state */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!selectedResult && !q && (
            <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <i className="bi-search" style={{ fontSize: 32, display: 'block', marginBottom: 16, opacity: .35 }}></i>
              <div style={{ fontSize: 14 }}>Search by employee name, client, ticket id, country, or assignee.</div>
              <div style={{ fontSize: 12, marginTop: 6 }}>Walks tickets, Onboarding, Offboarding, Workbench, Amendments, Redlines, Slack and Knowledge Hub.</div>
            </div>
          )}

          {!selectedResult && show && !hasRes && (
            <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              {anyLoading ? (
                <div style={{ fontSize: 14 }}>Loading sources… try again in a moment.</div>
              ) : (
                <div style={{ fontSize: 14 }}>No results for "<strong style={{ color: 'var(--text)' }}>{q}</strong>"</div>
              )}
            </div>
          )}

          {!selectedResult && sections.map(section => (
            <div key={section.id}>
              <div style={sectionHeaderStyle}>{section.label}</div>
              {section.results.map((r) => {
                globalIdx += 1;
                const gi = globalIdx;
                if (r.type === 'task') {
                  const t = r.item;
                  return (
                    <Row key={`task-${t.id}`} isHighlighted={hlIdx === gi}
                      onClick={() => handleResultClick(gi)}
                      onMouseEnter={() => setHlIdx(gi)}>
                      <ToolBadge source={t.source} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.subject}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.id} · {getFlag(t.country)} {getCountryName(t.country) || t.country}</div>
                      </div>
                      <StatusBadge status={t.status} />
                    </Row>
                  );
                }
                if (r.type === 'slack') {
                  const t = r.item;
                  return (
                    <Row key={`slack-${t.id}`} isHighlighted={hlIdx === gi}
                      onClick={() => handleResultClick(gi)}
                      onMouseEnter={() => setHlIdx(gi)}>
                      <div style={{ width: 28, height: 28, background: '#f3eff8', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <i className="bi-slack" style={{ color: '#7c3aed', fontSize: 13 }}></i>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.subject}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.sender} · {t.channel}</div>
                      </div>
                    </Row>
                  );
                }
                if (r.type === 'source') {
                  const meta = sourceMetaFor(r.source);
                  return (
                    <Row key={`${r.source}-${r.id}`} isHighlighted={hlIdx === gi}
                      onClick={() => handleResultClick(gi)}
                      onMouseEnter={() => setHlIdx(gi)}>
                      <div style={{ width: 28, height: 28, background: `${meta.color}1a`, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <i className={meta.icon} style={{ color: meta.color, fontSize: 13 }}></i>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.subject}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {meta.label}
                          {r.clientName ? ` · ${r.clientName}` : ''}
                          {r.country ? ` · ${getFlag(r.country)} ${getCountryName(r.country) || r.country}` : ''}
                        </div>
                      </div>
                      {r.status ? (
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: meta.color, background: `${meta.color}15`, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {String(r.status).slice(0, 28)}
                        </span>
                      ) : null}
                    </Row>
                  );
                }
                if (r.type === 'kb') {
                  const k = r.item;
                  return (
                    <Row key={`kb-${k.name}`} isHighlighted={hlIdx === gi}
                      onClick={() => handleResultClick(gi)}
                      onMouseEnter={() => setHlIdx(gi)}>
                      <div style={{ width: 28, height: 28, background: '#e0f2fe', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <i className={k.type === 'report' ? 'bi-graph-up' : k.type === 'policy' ? 'bi-shield-check' : k.type === 'channel' ? 'bi-hash' : 'bi-tools'} style={{ color: '#1565c0', fontSize: 12 }}></i>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{k.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{k.type} · Knowledge Hub</div>
                      </div>
                      <i className="bi-arrow-right" style={{ color: 'var(--text-disabled, #d5d5d5)', fontSize: 11 }}></i>
                    </Row>
                  );
                }
                return null;
              })}
            </div>
          ))}

          {selectedResult && (
            <QuickCard
              result={selectedResult}
              onClose={onClose}
              onViewInQueue={() => {
                if (selectedResult.type === 'task' || selectedResult.type === 'slack') {
                  setSelTask?.(selectedResult.item);
                }
                const meta = selectedResult.type === 'source' ? sourceMetaFor(selectedResult.source) : null;
                setView(meta?.viewTarget || (selectedResult.type === 'kb' ? 'knowledge-hub' : 'my-queue'));
                onClose();
              }}
            />
          )}
        </div>

        {!selectedResult && hasRes && (
          <div style={{ padding: '8px 20px', borderTop: '1px solid var(--border-light)', display: 'flex', gap: 12, flexShrink: 0 }}>
            {[['↑↓', 'Navigate'], ['↵', 'Open'], ['ESC', 'Close']].map(([k, l]) => (
              <span key={k} style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="kbd">{k}</span>{l}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Quick-card detail view ────────────────────────────────────────────────
// Compact, scan-friendly card with the row's identifying fields and deep-link
// CTAs. The user opened search to confirm "is this the case I'm working on?"
// — the card is sized for that yes/no decision without a full navigation.
function QuickCard({ result, onClose, onViewInQueue }) {
  if (!result) return null;

  const isTask = result.type === 'task';
  const isSlack = result.type === 'slack';
  const isKb = result.type === 'kb';
  const isSource = result.type === 'source';

  // Resolve display-ready fields from each shape.
  let badge = { label: 'Item', color: '#616161', icon: 'bi-inbox' };
  let subject = '';
  let lines = []; // [{ icon, label, value }]
  let adminUrl = null;
  let item = result.item || result;

  if (isTask) {
    const t = result.item;
    badge = {
      label: t.source === 'jira' ? 'Jira' : t.source === 'zendesk' ? 'Zendesk' : (t.source || 'Ticket'),
      color: t.source === 'jira' ? '#1d4ed8' : '#03a87d',
      icon: t.source === 'jira' ? 'bi-kanban-fill' : 'bi-life-preserver',
    };
    subject = t.subject || t.id;
    lines = [
      { icon: 'bi-tag-fill',       label: 'ID',         value: t.id },
      { icon: 'bi-flag-fill',      label: 'Country',    value: t.country ? `${getFlag(t.country)} ${getCountryName(t.country) || t.country}` : '—' },
      { icon: 'bi-person-fill',    label: 'Assignee',   value: t.assigneeName || t.assigneeEmail || 'Unassigned' },
      { icon: 'bi-circle-fill',    label: 'Status',     value: t.status || '—' },
      t.requesterName ? { icon: 'bi-person-circle', label: 'Requester', value: t.requesterName } : null,
    ].filter(Boolean);
  } else if (isSlack) {
    const t = result.item;
    badge = { label: 'Slack', color: '#7c3aed', icon: 'bi-slack' };
    subject = t.subject;
    lines = [
      { icon: 'bi-person-fill',    label: 'Sender',     value: t.sender || '—' },
      { icon: 'bi-hash',           label: 'Channel',    value: t.channel || '—' },
    ];
  } else if (isKb) {
    const k = result.item;
    badge = { label: 'Knowledge Hub', color: '#1565c0', icon: 'bi-book-fill' };
    subject = k.name;
    lines = [
      { icon: 'bi-tag-fill',       label: 'Type',       value: k.type || '—' },
    ];
  } else if (isSource) {
    const meta = sourceMetaFor(result.source);
    badge = { label: meta.label, color: meta.color, icon: meta.icon };
    subject = result.subject;
    item = result.raw;
    lines = [
      result.clientName  ? { icon: 'bi-building',     label: 'Client',    value: result.clientName } : null,
      result.country     ? { icon: 'bi-flag-fill',    label: 'Country',   value: `${getFlag(result.country)} ${getCountryName(result.country) || result.country}` } : null,
      result.assignee    ? { icon: 'bi-person-fill', label: 'Assignee',  value: result.assignee + (result.assigneeEmail ? ` (${result.assigneeEmail})` : '') } : null,
      result.status      ? { icon: 'bi-circle-fill', label: 'Status',    value: result.status } : null,
      (result.raw?.startDate || result.raw?.taskCreatedAt) ? {
        icon: 'bi-calendar-event',
        label: result.raw.startDate ? 'Start date' : 'Created',
        value: String(result.raw.startDate || result.raw.taskCreatedAt).slice(0, 10),
      } : null,
      result.raw?.id ? { icon: 'bi-tag-fill', label: 'ID', value: result.raw.id } : null,
    ].filter(Boolean);
    adminUrl = adminUrlFor(result);
  }

  return (
    <div style={{ padding: '14px 20px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '4px 10px', borderRadius: 999,
          background: `${badge.color}15`, color: badge.color,
          fontSize: 11, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase',
        }}>
          <i className={badge.icon} style={{ fontSize: 11 }} /> {badge.label}
        </span>
      </div>

      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 12, lineHeight: 1.3 }}>
        {subject || 'Untitled'}
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px',
        background: 'var(--surface-2)',
        border: '1px solid var(--border-light)',
        borderRadius: 10, padding: '12px 14px',
      }}>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              <i className={l.icon} style={{ fontSize: 11 }} /> {l.label}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text)', wordBreak: 'break-word' }}>
              {l.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        {adminUrl && (
          <a href={adminUrl} target="_blank" rel="noopener noreferrer" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8,
            background: '#1b1b1b', color: 'white',
            fontSize: 12.5, fontWeight: 600, textDecoration: 'none',
          }}>
            <i className="bi-box-arrow-up-right" style={{ fontSize: 12 }} /> Open in Deel admin
          </a>
        )}
        <button onClick={onViewInQueue} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 14px', borderRadius: 8,
          background: 'var(--surface)', color: 'var(--text)',
          border: '1px solid var(--border)',
          fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <i className="bi-arrow-right" style={{ fontSize: 12 }} /> View in Queue
        </button>
        <button onClick={onClose} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 14px', borderRadius: 8,
          background: 'transparent', color: 'var(--text-muted)',
          border: 'none', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
          marginLeft: 'auto',
        }}>
          Close
        </button>
      </div>
    </div>
  );
}

export default GlobalSearch;
