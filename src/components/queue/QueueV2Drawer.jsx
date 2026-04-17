// ── QueueV2Drawer ────────────────────────────────────────────────────────────
// Side-dock detail drawer. Opens on any row click (Deel tasks or ZD/Jira
// tickets). Replaces the modal Detail for V2.
import { useEffect, useState, useMemo } from 'react';
import { TOOLS, getFlag, getCountryName } from '../../data/constants';
import Avatar from '../ui/Avatar';
import { loadTemplates, renderTemplate, rowSummary } from './queueV2Utils';

const SEV_COLOR = {
  ok:       { color: '#15803d', bg: '#e8f5e9', border: '#bbf7d0' },
  at_risk:  { color: '#92400e', bg: '#fff8e6', border: '#ffe27c' },
  breached: { color: '#991b1b', bg: '#fef2f2', border: '#fca5a5' },
  none:     { color: '#9e9e9e', bg: '#f7f5f2', border: '#e8e8e8' },
};

export default function QueueV2Drawer({
  row,
  onClose,
  onAction,                // (id: 'escalate'|'reassign'|'snooze'|'resolve'|'assign'|'open') => void
  currentUser,
  perms,
  docked = false,          // if true, render inline (two-pane) rather than overlay
}) {
  const [tab, setTab] = useState('overview');

  useEffect(() => { setTab('overview'); }, [row?.id]);

  useEffect(() => {
    if (!row) return;
    const kd = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', kd);
    return () => document.removeEventListener('keydown', kd);
  }, [row, onClose]);

  if (!row) {
    if (!docked) return null;
    return (
      <div style={{
        width: 440, flexShrink: 0,
        background: 'white', borderLeft: '1px solid #e8e8e8',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        color: '#9e9e9e', padding: 30, textAlign: 'center',
      }}>
        <i className="bi-layout-sidebar-reverse" style={{ fontSize: 36, color: '#d5d5d5', marginBottom: 10 }} />
        <div style={{ fontSize: 13, fontWeight: 600, color: '#616161', marginBottom: 4 }}>Two-pane mode</div>
        <div style={{ fontSize: 11 }}>Select a row to see its details here.</div>
      </div>
    );
  }

  const isTicket = row._group === 'tickets';
  const tool = TOOLS[row.source];
  const sev = row.sla?.severity || 'none';
  const sevCfg = SEV_COLOR[sev] || SEV_COLOR.none;
  const statusColor = row.status?.color || '#616161';

  const tabs = [
    { id: 'overview', label: 'Overview', icon: 'bi-info-circle' },
    ...(isTicket ? [{ id: 'conversation', label: 'Conversation', icon: 'bi-chat-left-text' }] : []),
    { id: 'activity', label: 'Activity', icon: 'bi-clock-history' },
    { id: 'links', label: 'Links', icon: 'bi-link-45deg' },
  ];

  const canDo = (p) => !perms || perms.canDo?.(p) !== false;

  const drawerStyle = docked
    ? { width: 440, flexShrink: 0, background: 'white', borderLeft: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
    : { position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, maxWidth: '96vw', background: 'white', zIndex: 401, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', animation: 'slideInRight .18s ease-out' };

  return (
    <>
      {/* Backdrop — only in overlay mode */}
      {!docked && (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.18)', zIndex: 400, animation: 'fadeIn .15s' }} />
      )}
      {/* Drawer */}
      <div style={drawerStyle}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e8e8e8', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            {tool && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 9px', borderRadius: 6,
                background: tool.bg, color: tool.color,
                fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                <i className={tool.icon} style={{ fontSize: 10 }} />{tool.label}
              </span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1b1b1b', lineHeight: 1.3, wordBreak: 'break-word' }}>
                {row.subject || '--'}
              </div>
              {(() => {
                const summary = rowSummary(row);
                return summary ? (
                  <div style={{ fontSize: 12, color: '#9e9e9e', marginTop: 2, lineHeight: 1.4 }}>{summary}</div>
                ) : null;
              })()}
            </div>
            <button onClick={onClose}
              title="Close (Esc)"
              style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: '#9e9e9e', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <i className="bi-x-lg" style={{ fontSize: 14 }} />
            </button>
          </div>

          {/* Metric strip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={statChipStyle}>
              {getFlag(row.country)} <span style={{ marginLeft: 3 }}>{getCountryName(row.country) || row.country || 'Unknown'}</span>
            </span>
            <span style={{ ...statChipStyle, background: statusColor + '12', color: statusColor, border: `1px solid ${statusColor}30` }}>
              {row.status?.label || '--'}
            </span>
            <span title={row.sla?.reason} style={{
              ...statChipStyle,
              background: sevCfg.bg, color: sevCfg.color, border: `1px solid ${sevCfg.border}`,
              cursor: 'help',
            }}>
              <i className="bi-clock" style={{ fontSize: 9, marginRight: 3 }} />SLA · {row.sla?.label || '--'}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, padding: '6px 14px', borderBottom: '1px solid #f0efed', flexShrink: 0 }}>
          {tabs.map(t => {
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '7px 12px', borderRadius: 6,
                  border: 'none',
                  background: active ? '#f5f4f2' : 'transparent',
                  color: active ? '#1b1b1b' : '#616161',
                  fontSize: 12, fontWeight: active ? 600 : 500,
                  cursor: 'pointer', transition: 'all .15s',
                }}>
                <i className={t.icon} style={{ fontSize: 11 }} />{t.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
          {tab === 'overview' && <OverviewTab row={row} />}
          {tab === 'conversation' && isTicket && <ConversationTab row={row} currentUser={currentUser} />}
          {tab === 'activity' && <ActivityTab row={row} />}
          {tab === 'links' && <LinksTab row={row} />}
        </div>

        {/* Action footer */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid #e8e8e8', display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0, background: '#fafaf9' }}>
          {!row.assignee && currentUser?.name && (
            <ActionBtn icon="bi-person-plus" label="Assign me" onClick={() => onAction?.('assign')} primary />
          )}
          {canDo('can_escalate') && (
            <ActionBtn icon="bi-arrow-up-circle" label="Escalate" onClick={() => onAction?.('escalate')} />
          )}
          {canDo('can_reassign') && (
            <ActionBtn icon="bi-person-up" label="Reassign" onClick={() => onAction?.('reassign')} />
          )}
          {canDo('can_snooze') && (
            <ActionBtn icon="bi-pause-circle" label="Snooze" onClick={() => onAction?.('snooze')} />
          )}
          {canDo('can_resolve_task') && isTicket && (
            <ActionBtn icon="bi-check-circle" label="Resolve" onClick={() => onAction?.('resolve')} />
          )}
          {row.openUrl && (
            <ActionBtn icon="bi-box-arrow-up-right" label={isTicket ? 'Open source' : 'Open'} onClick={() => onAction?.('open')} />
          )}
        </div>
      </div>
    </>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
function OverviewTab({ row }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Field label="Assignee" value={
        row.assignee ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Avatar name={row.assignee} size="xs" />
            <span style={{ fontSize: 13, color: '#1b1b1b', fontWeight: 500 }}>{row.assignee}</span>
            {row.assigneeEmail && <span style={{ fontSize: 11, color: '#9e9e9e' }}>· {row.assigneeEmail}</span>}
          </span>
        ) : <span style={{ color: '#d42d35', fontSize: 13, fontWeight: 500 }}>Unassigned</span>
      } />

      {row.clientName && <Field label="Organization" value={row.clientName} />}
      {row.typeLabel && <Field label="Type" value={row.typeLabel} />}

      <Field label="Country" value={
        <span>{getFlag(row.country)} {getCountryName(row.country) || row.country || 'Unknown'}</span>
      } />

      {row.startDate && <Field label="Start date" value={formatDate(row.startDate)} />}
      {row.endDate && <Field label="End date" value={
        <span>
          {formatDate(row.endDate)}
          {row.endDateIsConfirmed === false && <span style={{ color: '#9e9e9e', fontSize: 11, marginLeft: 6 }}>(desired, not confirmed)</span>}
        </span>
      } />}
      {row.createdAt && <Field label="Created" value={formatDateTime(row.createdAt)} />}
      {row.updatedAt && <Field label="Last updated" value={formatDateTime(row.updatedAt)} />}

      {row.sla?.reason && (
        <div style={{
          padding: '10px 12px', borderRadius: 8,
          background: '#f5f4f2', border: '1px solid #e8e8e8',
          fontSize: 12, color: '#1b1b1b', lineHeight: 1.5,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Why this priority</div>
          {row.sla.reason}
        </div>
      )}

      {row.appliedRule && (
        <div style={{ padding: '10px 12px', borderRadius: 8, background: '#eef2ff', border: '1px solid #c7d2fe', fontSize: 12, color: '#4338ca' }}>
          <i className="bi-magic" style={{ marginRight: 6 }} />
          Auto-rule: <strong>{row.appliedRule.name}</strong>
        </div>
      )}
    </div>
  );
}

function ConversationTab({ row, currentUser }) {
  const raw = row._raw || {};
  const body = raw.body || raw.description || '';
  const templates = useMemo(() => loadTemplates(), []);
  const [selectedTid, setSelectedTid] = useState('');
  const [draft, setDraft] = useState('');

  const insertTemplate = (tid) => {
    const t = templates.find(x => x.id === tid);
    if (!t) return;
    setSelectedTid(tid);
    setDraft(renderTemplate(t, row, currentUser));
  };

  return (
    <div>
      {raw.requesterName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Avatar name={raw.requesterName} size="sm" />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b' }}>{raw.requesterName}</div>
            {raw.requesterEmail && <div style={{ fontSize: 11, color: '#9e9e9e' }}>{raw.requesterEmail}</div>}
          </div>
        </div>
      )}
      {body ? (
        <div style={{ padding: 12, borderRadius: 8, background: '#f7f5f2', border: '1px solid #e8e8e8', fontSize: 13, color: '#1b1b1b', lineHeight: 1.55, whiteSpace: 'pre-wrap', marginBottom: 14 }}>
          {body}
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: '#9e9e9e', fontSize: 12, padding: 20, marginBottom: 14 }}>
          <i className="bi-chat-square" style={{ fontSize: 20, display: 'block', marginBottom: 6 }} />
          Conversation body not indexed. Full thread in source.
        </div>
      )}

      {/* ── Templates + draft composer ─────────────────────────────── */}
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: 0.4 }}>Reply draft</span>
        <select value={selectedTid} onChange={e => insertTemplate(e.target.value)}
          style={{ height: 26, padding: '0 8px', borderRadius: 6, border: '1px solid #e8e8e8', fontSize: 11, background: 'white', color: '#616161', outline: 'none', cursor: 'pointer' }}>
          <option value="">Insert template…</option>
          {templates.map(t => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
      </div>
      <textarea value={draft} onChange={e => setDraft(e.target.value)}
        placeholder="Type your reply here — or pick a template above…"
        style={{ width: '100%', minHeight: 120, padding: 10, borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 13, lineHeight: 1.5, resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
        <button onClick={() => { setDraft(''); setSelectedTid(''); }}
          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #e8e8e8', background: 'white', color: '#616161', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
          Clear
        </button>
        <button onClick={() => {
          if (!draft) return;
          if (navigator.clipboard?.writeText) navigator.clipboard.writeText(draft);
        }}
          style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#1f74b3', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          <i className="bi-clipboard" style={{ marginRight: 4 }} />Copy to clipboard
        </button>
      </div>
      <div style={{ fontSize: 10, color: '#9e9e9e', marginTop: 6 }}>
        Drafts are local — paste into Zendesk/Jira to send. (Outbound send coming soon.)
      </div>
    </div>
  );
}

function ActivityTab({ row }) {
  const events = [];
  if (row.createdAt) events.push({ when: row.createdAt, label: 'Created' });
  if (row.updatedAt && row.updatedAt !== row.createdAt) events.push({ when: row.updatedAt, label: 'Last updated' });
  if (row.pausedAt) events.push({ when: row.pausedAt, label: `Paused${row.pauseType ? ` · ${row.pauseType}` : ''}` });
  events.sort((a, b) => new Date(a.when) - new Date(b.when));
  if (!events.length) return <div style={{ color: '#9e9e9e', fontSize: 12 }}>No activity recorded.</div>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {events.map((e, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1f74b3', marginTop: 5, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 13, color: '#1b1b1b', fontWeight: 500 }}>{e.label}</div>
            <div style={{ fontSize: 11, color: '#9e9e9e' }}>{formatDateTime(e.when)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LinksTab({ row }) {
  const links = [
    { label: 'Task', url: row.openUrl, icon: 'bi-box-arrow-up-right', color: '#616161' },
    { label: 'Contract', url: row.contractUrl, icon: 'bi-file-earmark-text', color: '#6b3fa0' },
    { label: 'Jira', url: row.jiraUrl, icon: 'bi-kanban', color: '#0052CC' },
    { label: 'Zendesk', url: row.zendeskUrl, icon: 'bi-headset', color: '#03363d' },
    { label: 'External', url: row._raw?.externalUrl, icon: 'bi-arrow-up-right-square', color: '#1b1b1b' },
  ].filter(l => l.url);
  if (!links.length) return <div style={{ color: '#9e9e9e', fontSize: 12 }}>No external links.</div>;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {links.map((l, i) => (
        <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, background: '#f7f5f2', border: '1px solid #e8e8e8', color: l.color, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
          <i className={l.icon} style={{ fontSize: 13 }} />
          <span style={{ flex: 1 }}>{l.label}</span>
          <i className="bi-chevron-right" style={{ fontSize: 11, color: '#9e9e9e' }} />
        </a>
      ))}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: '#1b1b1b' }}>{value}</div>
    </div>
  );
}

function ActionBtn({ icon, label, onClick, primary }) {
  return (
    <button onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '7px 12px', borderRadius: 8,
        border: primary ? '1px solid #1f74b3' : '1px solid #e8e8e8',
        background: primary ? '#1f74b3' : 'white',
        color: primary ? 'white' : '#1b1b1b',
        fontSize: 12, fontWeight: 600, cursor: 'pointer',
        transition: 'all .12s',
      }}>
      <i className={icon} style={{ fontSize: 11 }} />{label}
    </button>
  );
}

function formatDate(d) {
  if (!d) return '--';
  const dt = new Date(d);
  if (isNaN(dt)) return '--';
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatDateTime(d) {
  if (!d) return '--';
  const dt = new Date(d);
  if (isNaN(dt)) return '--';
  return dt.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const statChipStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 3,
  padding: '3px 9px', borderRadius: 128,
  background: '#f5f4f2', color: '#1b1b1b', border: '1px solid #e8e8e8',
  fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
};
