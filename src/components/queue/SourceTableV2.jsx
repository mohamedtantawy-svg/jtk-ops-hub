// ── SourceTableV2 ────────────────────────────────────────────────────────────
// Unified table for QueueV2. Supports:
//   • per-row quick action on hover
//   • "why this priority?" tooltip on SLA
//   • bundle-by-employee (collapse multiple rows under one card)
//   • density modes: comfortable | compact | cozy
//   • keyboard-selected row highlight (arrow / j / k)
//   • working-hours dim
import { memo, useState } from 'react';
import { TOOLS, getFlag, getCountryName } from '../../data/constants';
import Avatar from '../ui/Avatar';
import { quickAction, rowSummary } from './queueV2Utils';

function fmtDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  if (isNaN(d)) return '--';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const SEV_COLOR = {
  ok:       { color: '#15803d', bg: '#e8f5e9', border: '#bbf7d0' },
  at_risk:  { color: '#92400e', bg: '#fff8e6', border: '#ffe27c' },
  breached: { color: '#991b1b', bg: '#fef2f2', border: '#fca5a5' },
  none:     { color: '#9e9e9e', bg: '#f7f5f2', border: '#e8e8e8' },
};

const DENSITY_PAD = {
  comfortable: { td: '10px 12px', th: '10px 12px' },
  compact:     { td: '6px 10px',  th: '8px 10px' },
  cozy:        { td: '4px 8px',   th: '6px 8px'  },
};

function SlaBadge({ sla }) {
  if (!sla || sla.severity === 'none') return <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>;
  const cfg = SEV_COLOR[sla.severity] || SEV_COLOR.none;
  return (
    <span title={sla.reason || ''} style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 8px', borderRadius: 128,
      background: cfg.bg, color: cfg.color,
      fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
      cursor: sla.reason ? 'help' : 'default',
    }}>
      <i className="bi-clock" style={{ fontSize: 8 }} /> {sla.label}
    </span>
  );
}

export default function SourceTableV2({
  items = [],            // mixed: { type:'row', row } | { type:'bundle', key, rows }
  loading = false,
  error = null,
  onRefresh,
  onRowClick,
  onQuickAction,
  selectedId = null,
  emptyLabel = 'Queue is clear',
  emptySubLabel = 'All caught up',
  emptyCelebrate = false,
  showSourceColumn = true,
  dateHeader = 'Date',
  currentUser = null,
  density = 'comfortable',
  dimOutsideHours = false,
  newIds = null,          // Set<string> — flash NEW badge on these rows
  presence = null,        // Map<rowId, { userId, name, ts }>
}) {
  if (loading && items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <i className="bi-arrow-clockwise spin" style={{ fontSize: 28, color: '#9e9e9e', display: 'block', marginBottom: 12 }} />
        <div style={{ fontSize: 14, color: '#9e9e9e' }}>Loading...</div>
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <i className="bi-exclamation-triangle" style={{ fontSize: 40, color: '#ed8d00', display: 'block', marginBottom: 12 }} />
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1b1b1b', marginBottom: 6 }}>Failed to load</div>
        <div style={{ fontSize: 13, color: '#9e9e9e', marginBottom: 16 }}>{error}</div>
        {onRefresh && (
          <button onClick={onRefresh} style={{ padding: '8px 20px', borderRadius: 128, border: '1px solid #e8e8e8', background: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <i className="bi-arrow-clockwise" style={{ marginRight: 6 }} />Retry
          </button>
        )}
      </div>
    );
  }

  if (items.length === 0) {
    return <EmptyState label={emptyLabel} subLabel={emptySubLabel} celebrate={emptyCelebrate} />;
  }

  const pad = DENSITY_PAD[density] || DENSITY_PAD.comfortable;
  const thStyle = { padding: pad.th, fontSize: 10, fontWeight: 600, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #e8e8e8' };

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: '#fafaf9' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f5f4f2', position: 'sticky', top: 0, zIndex: 2 }}>
            {showSourceColumn && <th style={{ ...thStyle, width: 80 }}>Source</th>}
            <th style={{ ...thStyle, textAlign: 'left', minWidth: 200 }}>Subject</th>
            <th style={{ ...thStyle, width: 90 }}>Country</th>
            <th style={{ ...thStyle, width: 100 }}>Assignee</th>
            <th style={{ ...thStyle, width: 80 }}>{dateHeader}</th>
            <th style={{ ...thStyle, width: 70 }}>SLA</th>
            <th style={{ ...thStyle, width: 110 }}>Status</th>
            <th style={{ ...thStyle, width: 110 }}></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => {
            if (it.type === 'bundle') {
              return (
                <BundleGroup
                  key={`b-${it.key}-${idx}`}
                  bundleKey={it.key}
                  rows={it.rows}
                  showSource={showSourceColumn}
                  onRowClick={onRowClick}
                  onQuickAction={onQuickAction}
                  selectedId={selectedId}
                  currentUser={currentUser}
                  density={density}
                  dimOutsideHours={dimOutsideHours}
                  newIds={newIds}
                  presence={presence}
                />
              );
            }
            const r = it.row;
            return (
              <RowV2
                key={`${r.source}-${r.id}`}
                row={r}
                showSource={showSourceColumn}
                onRowClick={onRowClick}
                onQuickAction={onQuickAction}
                selected={selectedId === r.id}
                currentUser={currentUser}
                density={density}
                dimOutsideHours={dimOutsideHours}
                isNew={newIds?.has(r.id)}
                viewer={presence?.get(r.id)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Bundle (multiple rows for same employee) ─────────────────────────────────
const BundleGroup = memo(function BundleGroup({ bundleKey, rows, showSource, onRowClick, onQuickAction, selectedId, currentUser, density, dimOutsideHours, newIds, presence }) {
  const [expanded, setExpanded] = useState(false);
  const pad = DENSITY_PAD[density] || DENSITY_PAD.comfortable;
  const tdStyle = { padding: pad.td, textAlign: 'center', verticalAlign: 'middle' };
  const totalCountries = new Set(rows.map(r => r.country)).size;
  const worstSev = rows.some(r => r.sla?.severity === 'breached') ? 'breached'
                : rows.some(r => r.sla?.severity === 'at_risk') ? 'at_risk' : 'ok';
  const sevCfg = SEV_COLOR[worstSev];

  return (
    <>
      <tr onClick={() => setExpanded(e => !e)}
        style={{
          borderBottom: '1px solid #e8e8e8',
          background: expanded ? '#f3eff8' : '#fbfaf8',
          cursor: 'pointer',
          borderLeft: `3px solid ${sevCfg.border}`,
        }}>
        <td colSpan={showSource ? 8 : 7} style={{ padding: pad.td, paddingLeft: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className={expanded ? 'bi-caret-down-fill' : 'bi-caret-right-fill'} style={{ fontSize: 11, color: '#616161' }} />
            <i className="bi-people-fill" style={{ fontSize: 12, color: '#7c3aed' }} />
            <span style={{ fontWeight: 700, color: '#1b1b1b', fontSize: 13 }}>{bundleKey}</span>
            <span style={{ padding: '1px 7px', borderRadius: 128, background: '#7c3aed20', color: '#7c3aed', fontSize: 10, fontWeight: 700 }}>
              {rows.length} items
            </span>
            {totalCountries > 1 && (
              <span style={{ fontSize: 11, color: '#9e9e9e' }}>· {totalCountries} countries</span>
            )}
            <span style={{ flex: 1 }} />
            <span style={{
              padding: '2px 8px', borderRadius: 128,
              background: sevCfg.bg, color: sevCfg.color,
              fontSize: 10, fontWeight: 600,
            }}>
              {worstSev === 'breached' ? 'Has breaches' : worstSev === 'at_risk' ? 'At risk' : 'On track'}
            </span>
          </div>
        </td>
      </tr>
      {expanded && rows.map(r => (
        <RowV2
          key={`${r.source}-${r.id}`}
          row={r}
          showSource={showSource}
          onRowClick={onRowClick}
          onQuickAction={onQuickAction}
          selected={selectedId === r.id}
          currentUser={currentUser}
          density={density}
          dimOutsideHours={dimOutsideHours}
          isNew={newIds?.has(r.id)}
          viewer={presence?.get(r.id)}
          insideBundle
        />
      ))}
    </>
  );
});

// ── Row ──────────────────────────────────────────────────────────────────────
const RowV2 = memo(function RowV2({ row, showSource, onRowClick, onQuickAction, selected, currentUser, density, dimOutsideHours, insideBundle, isNew, viewer }) {
  const [hov, setHov] = useState(false);
  const sev = row.sla?.severity || 'none';
  const borderColor = sev === 'breached' ? '#d42d35' : sev === 'at_risk' ? '#ed8d00' : 'transparent';
  const statusColor = row.status?.color || '#616161';
  const statusBg = row.status?.color ? row.status.color + '12' : '#f7f5f2';
  const statusBorder = row.status?.color ? row.status.color + '40' : '#e8e8e8';
  const tool = TOOLS[row.source];
  const flag = getFlag(row.country);
  const countryName = getCountryName(row.country) || row.country || '';
  const action = quickAction(row, currentUser);
  const pad = DENSITY_PAD[density] || DENSITY_PAD.comfortable;
  const tdStyle = { padding: pad.td, textAlign: 'center', verticalAlign: 'middle' };

  const clickable = !!onRowClick;
  const handleClick = () => { if (clickable) onRowClick(row); };

  const bgSelected = selected ? '#e8f0fe' : hov ? '#fafaf9' : 'white';
  const opacity = dimOutsideHours ? 0.62 : 1;

  return (
    <tr
      onClick={handleClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderBottom: '1px solid #f0efed',
        background: bgSelected,
        cursor: clickable ? 'pointer' : 'default',
        borderLeft: `3px solid ${borderColor}`,
        paddingLeft: insideBundle ? 24 : 0,
        transition: 'background .1s',
        opacity,
      }}
    >
      {showSource && (
        <td style={{ ...tdStyle, paddingLeft: insideBundle ? 30 : pad.td.split(' ')[1] }}>
          {tool ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, background: tool.bg, color: tool.color, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
              <i className={tool.icon} style={{ fontSize: 9 }} />{tool.label}
            </span>
          ) : <span style={{ fontSize: 11, color: '#9e9e9e' }}>{row.source}</span>}
        </td>
      )}

      <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600, color: '#1b1b1b', maxWidth: 380, paddingLeft: insideBundle ? 30 : pad.td.split(' ')[1] }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {isNew && (
            <span title="New since last sync" style={{
              padding: '1px 6px', borderRadius: 128,
              background: '#15803d', color: 'white',
              fontSize: 9, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
              flexShrink: 0,
              animation: 'pulse 1.6s ease infinite',
            }}>NEW</span>
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
            {row.subject || '--'}
            {(() => {
              const summary = rowSummary(row);
              return summary ? (
                <span style={{ display: 'block', fontSize: 11, color: '#9e9e9e', fontWeight: 400, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {summary}
                </span>
              ) : null;
            })()}
          </span>
          {viewer && (
            <span title={`${viewer.name || 'Another agent'} is viewing`}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 20, height: 20, borderRadius: '50%',
                background: '#eff6ff', color: '#1f74b3',
                border: '2px solid white', boxShadow: '0 0 0 1px #1f74b3',
                fontSize: 9, fontWeight: 700,
                flexShrink: 0,
              }}>
              {(viewer.name || '?').slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
      </td>

      <td style={{ ...tdStyle, fontSize: 12, whiteSpace: 'nowrap' }}>
        {flag && <span style={{ marginRight: 3 }}>{flag}</span>}
        <span style={{ color: '#616161', fontWeight: 500 }}>{countryName || '--'}</span>
      </td>

      <td style={tdStyle}>
        <AssigneeCell row={row} />
      </td>

      <td style={{ ...tdStyle, fontSize: 11, color: '#616161', whiteSpace: 'nowrap' }}>
        {row.dateValue ? fmtDate(row.dateValue) : '--'}
      </td>

      <td style={tdStyle}>
        <SlaBadge sla={row.sla} />
      </td>

      <td style={tdStyle}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '3px 10px', borderRadius: 128,
          background: statusBg, color: statusColor,
          border: `1px solid ${statusBorder}`,
          fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
        }}>
          {row.status?.label || '--'}
        </span>
      </td>

      <td style={{ ...tdStyle, textAlign: 'right' }}>
        <QuickActionBtn action={action} visible={hov || selected} onClick={() => onQuickAction?.(row, action)} />
      </td>
    </tr>
  );
});

function QuickActionBtn({ action, visible, onClick }) {
  if (!action) return null;
  const primary = action.id === 'assign' || action.id === 'escalate';
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      style={{
        opacity: visible ? 1 : 0.35,
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '4px 10px', borderRadius: 128,
        border: primary ? '1px solid #1f74b3' : '1px solid #e8e8e8',
        background: primary ? '#1f74b3' : 'white',
        color: primary ? 'white' : '#1b1b1b',
        fontSize: 10, fontWeight: 600, cursor: 'pointer',
        transition: 'opacity .15s, background .1s', whiteSpace: 'nowrap',
      }}>
      <i className={action.icon} style={{ fontSize: 10 }} />{action.label}
    </button>
  );
}

function AssigneeCell({ row }) {
  if (row.assignee) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
        <Avatar name={row.assignee} size="xs" />
        <span style={{ fontSize: 11, color: '#1b1b1b', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }}>
          {row.assignee.split(' ')[0]}
        </span>
      </div>
    );
  }
  return <span style={{ fontSize: 11, color: '#d42d35', fontWeight: 500 }}>Unassigned</span>;
}

// ── Empty state (with optional celebration) ──────────────────────────────────
function EmptyState({ label, subLabel, celebrate }) {
  if (celebrate) {
    return (
      <div style={{ textAlign: 'center', padding: 70 }}>
        <div style={{ fontSize: 56, marginBottom: 8, animation: 'slideUp .4s cubic-bezier(.34,1.56,.64,1)' }}>🎉</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1b1b1b', marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 13, color: '#616161', maxWidth: 380, margin: '0 auto' }}>{subLabel}</div>
      </div>
    );
  }
  return (
    <div style={{ textAlign: 'center', padding: 60 }}>
      <i className="bi-inbox" style={{ fontSize: 40, color: '#c0c0c0', display: 'block', marginBottom: 12 }} />
      <div style={{ fontSize: 15, fontWeight: 600, color: '#1b1b1b', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#9e9e9e' }}>{subLabel}</div>
    </div>
  );
}
