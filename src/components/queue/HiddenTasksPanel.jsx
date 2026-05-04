// ── HiddenTasksPanel ───────────────────────────────────────────────────────
// Admin-only audit list for the global hide queue. Renders every row in
// hidden_task with `unhidden_at IS NULL`, grouped by source, with an
// Unhide affordance per row.
//
// Wired into Queue.jsx via the synthetic 'hidden' source — only admin
// users see the tab and reach this component.
//
// Intentionally lightweight: no virtualization (the hide list is bounded
// by manual approvals, the listActiveHidden helper caps at 5000 rows),
// no per-source pagination, no filter/search yet. The user explicitly
// asked for "could be sloppy as long as it shows the right data and lets
// me unhide", so this is the v1 — we can layer search/filter on later if
// the list grows.

import { useCallback, useMemo, useState } from 'react';
import { TOOLS } from '../../data/constants';
import { unhideTask } from '../../services/hideTaskApi';

const REASON_LABELS = {
  internal_deel_employee: 'Internal Deel employee',
  test_task: 'Test task',
  other: 'Other',
};

function formatTime(iso) {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const ms = now - d.getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export default function HiddenTasksPanel({ hiddenTasks }) {
  const items = hiddenTasks?.items || [];
  const refresh = hiddenTasks?.refresh;

  const [pendingId, setPendingId] = useState(null);   // row currently being unhidden
  const [error, setError] = useState(null);
  const [filterSource, setFilterSource] = useState(null);

  // Group + sort: newest hides first within each source group.
  const grouped = useMemo(() => {
    const bySource = new Map();
    for (const it of items) {
      const src = String(it.taskSource || 'unknown').toLowerCase();
      if (!bySource.has(src)) bySource.set(src, []);
      bySource.get(src).push(it);
    }
    for (const arr of bySource.values()) {
      arr.sort((a, b) => new Date(b.hiddenAt || 0) - new Date(a.hiddenAt || 0));
    }
    return bySource;
  }, [items]);

  const visibleItems = useMemo(() => {
    if (!filterSource) return items;
    return items.filter(i => String(i.taskSource || '').toLowerCase() === filterSource);
  }, [items, filterSource]);

  const visibleSorted = useMemo(
    () => [...visibleItems].sort((a, b) => new Date(b.hiddenAt || 0) - new Date(a.hiddenAt || 0)),
    [visibleItems],
  );

  const handleUnhide = useCallback(async (row) => {
    if (!row?.id) return;
    // Cheap confirm — admin tool, OK to keep low-friction. The action is
    // soft-undoable (re-hide goes through the same flow), so a misclick
    // costs only a follow-up hide approval.
    const ok = typeof window !== 'undefined'
      ? window.confirm(`Unhide "${row.taskSubject || row.taskId}"?\n\nIt will reappear in the ${TOOLS[row.taskSource]?.label || row.taskSource} queue immediately.`)
      : true;
    if (!ok) return;
    setPendingId(row.id);
    setError(null);
    try {
      await unhideTask(row.id);
      // Force a refresh so the row drops off this panel and the queue
      // counts in the popover/tab strip update on the next tick.
      try { await refresh?.(); } catch {}
    } catch (err) {
      setError(err?.message || 'Unhide failed');
    } finally {
      setPendingId(null);
    }
  }, [refresh]);

  const totalCount = items.length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '12px 32px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <i className="bi-eye-slash-fill" style={{ fontSize: 16, color: '#d42d35' }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: '#1b1b1b' }}>Hidden tasks</span>
        <span style={{ fontSize: 12, color: '#9e9e9e' }}>{totalCount} active hide{totalCount === 1 ? '' : 's'}</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => refresh?.()}
          title="Refresh hidden list"
          style={{
            height: 28, padding: '0 10px', borderRadius: 8,
            border: '1px solid #e8e8e8', background: 'white',
            color: '#616161', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}
        >
          <i className="bi-arrow-clockwise" style={{ fontSize: 11 }} />Refresh
        </button>
      </div>

      {/* Per-source filter pills — quick filter by source */}
      {grouped.size > 1 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <button
            onClick={() => setFilterSource(null)}
            style={{
              height: 28, padding: '0 10px', borderRadius: 8,
              border: filterSource === null ? '1.5px solid #1b1b1b' : '1px solid #e8e8e8',
              background: filterSource === null ? '#f7f5f2' : 'white',
              color: '#1b1b1b', fontSize: 11, fontWeight: filterSource === null ? 700 : 500, cursor: 'pointer',
            }}
          >
            All <span style={{ marginLeft: 4, color: '#9e9e9e', fontWeight: 600 }}>{totalCount}</span>
          </button>
          {[...grouped.entries()]
            .sort((a, b) => b[1].length - a[1].length)
            .map(([src, arr]) => {
              const meta = TOOLS[src] || { label: src, color: '#616161', bg: '#f3f3f3', icon: 'bi-circle' };
              const active = filterSource === src;
              return (
                <button
                  key={src}
                  onClick={() => setFilterSource(active ? null : src)}
                  style={{
                    height: 28, padding: '0 10px', borderRadius: 8,
                    border: active ? `1.5px solid ${meta.color}` : '1px solid #e8e8e8',
                    background: active ? meta.bg : 'white',
                    color: active ? meta.color : '#616161',
                    fontSize: 11, fontWeight: active ? 700 : 500, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                  }}
                >
                  <i className={meta.icon} style={{ fontSize: 11 }} />
                  {meta.label}
                  <span style={{ marginLeft: 2, color: active ? meta.color : '#9e9e9e', fontWeight: 700 }}>{arr.length}</span>
                </button>
              );
            })}
        </div>
      )}

      {error && (
        <div style={{
          padding: '8px 12px', marginBottom: 10, borderRadius: 8,
          background: '#fef2f2', border: '1px solid #fca5a5',
          color: '#991b1b', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <i className="bi-exclamation-circle-fill" />
          <span>{error}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => setError(null)} style={{
            background: 'transparent', border: 'none', color: '#991b1b',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>Dismiss</button>
        </div>
      )}

      {visibleSorted.length === 0 ? (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#9e9e9e', fontSize: 13, padding: 32,
        }}>
          {totalCount === 0
            ? 'No tasks are currently hidden.'
            : `No hidden tasks match the ${TOOLS[filterSource]?.label || filterSource} filter.`}
        </div>
      ) : (
        <div style={{
          flex: 1, overflow: 'auto', border: '1px solid #e8e8e8', borderRadius: 10, background: 'white',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#faf9f7', zIndex: 1 }}>
              <tr style={{ textAlign: 'left', color: '#616161', fontSize: 11 }}>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Subject</th>
                <th style={thStyle}>Reason</th>
                <th style={thStyle}>Hidden by</th>
                <th style={thStyle}>Approved by</th>
                <th style={thStyle}>When</th>
                <th style={{ ...thStyle, textAlign: 'right', width: 160 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleSorted.map(row => {
                const meta = TOOLS[row.taskSource] || { label: row.taskSource, color: '#616161', bg: '#f3f3f3', icon: 'bi-circle' };
                const isPending = pendingId === row.id;
                return (
                  <tr key={row.id} style={{ borderTop: '1px solid #f0efed' }}>
                    <td style={tdStyle}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 8px', borderRadius: 128,
                        background: meta.bg, color: meta.color,
                        fontSize: 11, fontWeight: 600,
                      }}>
                        <i className={meta.icon} style={{ fontSize: 10 }} />
                        {meta.label}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 500, color: '#1b1b1b', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={row.taskSubject || row.taskId}>
                        {row.taskSubject || row.taskId || '(no subject)'}
                      </div>
                      <div style={{ fontSize: 10, color: '#9e9e9e' }}>{row.taskId}</div>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ color: '#1b1b1b' }}>{REASON_LABELS[row.reasonCode] || row.reasonCode || '—'}</div>
                      {row.reasonText && (
                        <div style={{
                          fontSize: 10, color: '#616161',
                          maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }} title={row.reasonText}>
                          {row.reasonText}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <div>{row.hiddenByName || row.hiddenByEmail || '—'}</div>
                      {row.hiddenByName && row.hiddenByEmail && (
                        <div style={{ fontSize: 10, color: '#9e9e9e' }}>{row.hiddenByEmail}</div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <div>{row.approvedByName || row.approvedByEmail || '—'}</div>
                      {row.approvedByName && row.approvedByEmail && (
                        <div style={{ fontSize: 10, color: '#9e9e9e' }}>{row.approvedByEmail}</div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: '#616161' }} title={row.hiddenAt || ''}>
                      {formatTime(row.hiddenAt)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {row.taskUrl && (
                        <a
                          href={row.taskUrl} target="_blank" rel="noopener noreferrer"
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '4px 8px', marginRight: 6, borderRadius: 6,
                            border: '1px solid #e8e8e8', background: 'white', color: '#1b1b1b',
                            fontSize: 11, fontWeight: 600, textDecoration: 'none',
                          }}
                        >
                          <i className="bi-box-arrow-up-right" style={{ fontSize: 10 }} />Open
                        </a>
                      )}
                      <button
                        onClick={() => handleUnhide(row)}
                        disabled={isPending}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '4px 10px', borderRadius: 6,
                          border: '1px solid #d42d35', background: isPending ? '#fef2f2' : 'white',
                          color: '#d42d35',
                          fontSize: 11, fontWeight: 700,
                          cursor: isPending ? 'wait' : 'pointer', opacity: isPending ? 0.6 : 1,
                        }}
                        title="Remove from the hide list — task reappears in its queue"
                      >
                        <i className={isPending ? 'bi-hourglass-split' : 'bi-eye-fill'} style={{ fontSize: 10 }} />
                        {isPending ? 'Unhiding…' : 'Unhide'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle = {
  padding: '8px 12px', fontWeight: 700, fontSize: 11,
  textTransform: 'uppercase', letterSpacing: '0.04em',
  borderBottom: '1px solid #e8e8e8',
};
const tdStyle = {
  padding: '8px 12px', verticalAlign: 'top',
};
