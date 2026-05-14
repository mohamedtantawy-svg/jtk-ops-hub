// ── UrgentAssistScheduleView ────────────────────────────────────────────
// HRX Urgent Assist MOC Schedule. Read-open / write-restricted to
// managers. Mirrors the team's previous Google Sheet (Duygu Cakalli
// feedback 2026-05-14). Rows are per-calendar-date; each carries
// EMEA / NAM / APAC main + backup. Today's row is highlighted; past
// rows render in a muted style so the focus is on what's ahead.

import { useContext, useMemo, useState } from 'react';
import { PermissionsContext } from '../../App';
import { useUrgentAssistSchedule } from '../../hooks/useUrgentAssistSchedule';
import { deleteUrgentAssistScheduleDay } from '../../services/urgentAssistScheduleApi';
import UrgentAssistScheduleRowModal from '../modals/UrgentAssistScheduleRowModal';
import PageHeader from '../ui/PageHeader';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayName(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { weekday: 'long' });
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const REGION_TONES = {
  emea: { color: '#15803d', bg: '#dcfce7', border: '#bbf7d0', label: 'EMEA' },
  nam:  { color: '#b45309', bg: '#fed7aa', border: '#fdba74', label: 'NAM'  },
  apac: { color: '#991b1b', bg: '#fecaca', border: '#fca5a5', label: 'APAC' },
};

function SlotCell({ name, email, isMain }) {
  if (!email && !name) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic',
      }}>
        — empty —
      </span>
    );
  }
  const display = name || email;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <span style={{
        fontSize: 13, fontWeight: isMain ? 700 : 500, color: 'var(--text)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }} title={email || display}>
        {display}
      </span>
      {email && name && email.toLowerCase() !== name.toLowerCase() && (
        <span style={{
          fontSize: 10, color: 'var(--text-muted)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }} title={email}>
          {email}
        </span>
      )}
    </div>
  );
}

export default function UrgentAssistScheduleView() {
  const perms = useContext(PermissionsContext);
  const isManager = perms?.dataScope && perms.dataScope !== 'own_tasks_only';
  const { items, loading, error, refresh } = useUrgentAssistSchedule(true);

  const [editRow, setEditRow] = useState(null);  // null | { existing } | { existing: null }
  const [deleteBusyId, setDeleteBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const today = todayIso();
  const { past, current, upcoming, totalUpcoming } = useMemo(() => {
    const rows = Array.isArray(items) ? items.slice() : [];
    rows.sort((a, b) => String(a.scheduleDate).localeCompare(String(b.scheduleDate)));
    const past = rows.filter(r => r.scheduleDate < today);
    const current = rows.find(r => r.scheduleDate === today) || null;
    const upcoming = rows.filter(r => r.scheduleDate > today);
    return { past, current, upcoming, totalUpcoming: upcoming.length };
  }, [items, today]);

  const handleDelete = async (row) => {
    if (!row?.id) return;
    if (!confirm(`Delete the ${shortDate(row.scheduleDate)} schedule day?`)) return;
    setDeleteBusyId(row.id);
    setActionError(null);
    try {
      await deleteUrgentAssistScheduleDay(row.id);
      await refresh();
    } catch (err) {
      setActionError(err?.message || 'Failed to delete row');
    } finally {
      setDeleteBusyId(null);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: '0 24px 24px', overflowY: 'auto' }}>
      <PageHeader
        icon="bi-calendar3"
        iconBg="#f5f3ff"
        iconColor="#7c3aed"
        title="HRX Urgent Assist MOC Schedule"
        subtitle="Daily on-call rotation across EMEA, NAM, and APAC. Today's row is highlighted."
        right={isManager ? (
          <button
            type="button"
            onClick={() => setEditRow({ existing: null })}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '9px 16px', borderRadius: 10, border: 'none',
              background: '#7c3aed', color: 'white', fontSize: 13, fontWeight: 700,
              cursor: 'pointer', boxShadow: '0 2px 8px rgba(124,58,237,0.25)',
              fontFamily: 'inherit',
            }}
          >
            <i className="bi-plus-lg" style={{ fontSize: 12 }} />
            Add day
          </button>
        ) : null}
      />

      {actionError && (
        <div role="alert" style={{ padding: '8px 12px', marginBottom: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 12 }}>
          <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />{actionError}
        </div>
      )}
      {error && (
        <div role="alert" style={{ padding: '10px 14px', marginBottom: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 12 }}>
          <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />
          Failed to load schedule. <button onClick={() => refresh()} style={{ marginLeft: 8, textDecoration: 'underline', cursor: 'pointer', background: 'none', border: 'none', color: 'inherit', fontFamily: 'inherit' }}>Retry</button>
        </div>
      )}

      {/* ── Today's slot up top ───────────────────────────────────────── */}
      <TodayCard row={current} onEdit={isManager ? () => setEditRow({ existing: current || { scheduleDate: today } }) : null} />

      {/* ── Upcoming rows ─────────────────────────────────────────────── */}
      <div style={{
        marginTop: 18, padding: '12px 14px 4px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border-light, #f0efed)',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          Upcoming · {totalUpcoming}
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--surface)', color: 'var(--text-secondary, #616161)',
            fontSize: 11, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <i className={loading ? 'bi-arrow-clockwise' : 'bi-arrow-clockwise'} style={{ fontSize: 11 }} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          Loading schedule…
        </div>
      ) : upcoming.length === 0 ? (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, border: '1px dashed var(--border)', borderRadius: 12, marginTop: 10, background: 'var(--surface)' }}>
          No upcoming days scheduled. {isManager ? <span>Click <strong style={{ color: 'var(--text)' }}>Add day</strong> above to start populating the rotation.</span> : <span>Ask a manager to add upcoming days.</span>}
        </div>
      ) : (
        <ScheduleTable rows={upcoming} isManager={isManager} onEdit={(r) => setEditRow({ existing: r })} onDelete={handleDelete} deleteBusyId={deleteBusyId} today={today} />
      )}

      {/* ── Past two weeks ────────────────────────────────────────────── */}
      {past.length > 0 && (
        <>
          <div style={{
            marginTop: 22, padding: '12px 14px 4px',
            borderBottom: '1px solid var(--border-light, #f0efed)',
            fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-muted)', textTransform: 'uppercase',
          }}>
            Past · {past.length}
          </div>
          <ScheduleTable rows={past} isManager={isManager} onEdit={(r) => setEditRow({ existing: r })} onDelete={handleDelete} deleteBusyId={deleteBusyId} today={today} muted />
        </>
      )}

      {editRow && (
        <UrgentAssistScheduleRowModal
          existing={editRow.existing}
          onClose={() => setEditRow(null)}
          onSaved={async () => {
            setEditRow(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function TodayCard({ row, onEdit }) {
  if (!row) {
    return (
      <div style={{
        padding: '18px 20px', borderRadius: 14,
        border: '1px dashed var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: '#7c3aed', textTransform: 'uppercase' }}>Today</div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 4 }}>
            No schedule for today.{onEdit ? ' Click "Add day" to set it.' : ''}
          </div>
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            style={{ padding: '7px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Set today
          </button>
        )}
      </div>
    );
  }
  return (
    <div style={{
      padding: '16px 18px 18px', borderRadius: 14,
      background: 'linear-gradient(135deg, #f5f3ff 0%, #faf5ff 100%)',
      border: '1px solid #d4c4f0',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: '#7c3aed', textTransform: 'uppercase' }}>Today · {dayName(row.scheduleDate)} {shortDate(row.scheduleDate)}</div>
          {row.notes && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary, #616161)', marginTop: 6, lineHeight: 1.5 }}>{row.notes}</div>
          )}
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #d4c4f0', background: 'var(--surface)', color: '#7c3aed', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <i className="bi-pencil" style={{ fontSize: 10 }} />
            Edit
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        {['emea', 'nam', 'apac'].map(region => (
          <div key={region} style={{
            padding: '10px 12px', borderRadius: 10,
            background: 'var(--surface)', border: `1px solid ${REGION_TONES[region].border}`,
            display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
          }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 10, fontWeight: 700, letterSpacing: '.05em',
              color: REGION_TONES[region].color, textTransform: 'uppercase',
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: REGION_TONES[region].color, display: 'inline-block' }} />
              {REGION_TONES[region].label}
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>Main</div>
              <SlotCell isMain name={row[`${region}MainName`]} email={row[`${region}MainEmail`]} />
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>Backup</div>
              <SlotCell name={row[`${region}BackupName`]} email={row[`${region}BackupEmail`]} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScheduleTable({ rows, isManager, onEdit, onDelete, deleteBusyId, today, muted = false }) {
  return (
    <div style={{ marginTop: 6, overflowX: 'auto', border: '1px solid var(--border-light, #f0efed)', borderRadius: 12, background: 'var(--surface)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 880 }}>
        <thead>
          <tr style={{ background: 'var(--surface-2, #fafaf9)', fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>
            <th style={cellStyle}>Day</th>
            <th style={cellStyle}>Date</th>
            <th style={{ ...cellStyle, background: '#dcfce7', color: '#15803d' }}>EMEA Main</th>
            <th style={{ ...cellStyle, background: '#f0fdf4', color: '#15803d' }}>EMEA Backup</th>
            <th style={{ ...cellStyle, background: '#fed7aa', color: '#b45309' }}>NAM Main</th>
            <th style={{ ...cellStyle, background: '#fff7ed', color: '#b45309' }}>NAM Backup</th>
            <th style={{ ...cellStyle, background: '#fecaca', color: '#991b1b' }}>APAC Main</th>
            <th style={{ ...cellStyle, background: '#fee2e2', color: '#991b1b' }}>APAC Backup</th>
            {isManager && <th style={{ ...cellStyle, width: 90 }}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const isToday = r.scheduleDate === today;
            return (
              <tr
                key={r.id || r.scheduleDate}
                style={{
                  background: isToday ? '#f5f3ff' : 'var(--surface)',
                  opacity: muted && !isToday ? 0.7 : 1,
                  borderTop: '1px solid var(--border-light, #f0efed)',
                }}
              >
                <td style={{ ...rowCell, fontWeight: isToday ? 700 : 500 }}>{dayName(r.scheduleDate)}</td>
                <td style={{ ...rowCell, fontWeight: isToday ? 700 : 500, color: 'var(--text-secondary, #616161)' }}>{shortDate(r.scheduleDate)}</td>
                <td style={rowCell}><SlotCell isMain name={r.emeaMainName} email={r.emeaMainEmail} /></td>
                <td style={rowCell}><SlotCell name={r.emeaBackupName} email={r.emeaBackupEmail} /></td>
                <td style={rowCell}><SlotCell isMain name={r.namMainName} email={r.namMainEmail} /></td>
                <td style={rowCell}><SlotCell name={r.namBackupName} email={r.namBackupEmail} /></td>
                <td style={rowCell}><SlotCell isMain name={r.apacMainName} email={r.apacMainEmail} /></td>
                <td style={rowCell}><SlotCell name={r.apacBackupName} email={r.apacBackupEmail} /></td>
                {isManager && (
                  <td style={{ ...rowCell, whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      onClick={() => onEdit(r)}
                      title="Edit"
                      style={iconBtnStyle}
                    >
                      <i className="bi-pencil" style={{ fontSize: 11 }} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(r)}
                      disabled={deleteBusyId === r.id}
                      title="Delete"
                      style={{ ...iconBtnStyle, color: deleteBusyId === r.id ? 'var(--text-muted)' : '#d42d35', marginLeft: 4 }}
                    >
                      <i className="bi-trash" style={{ fontSize: 11 }} />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const cellStyle = {
  padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border-light, #f0efed)',
};
const rowCell = {
  padding: '8px 10px', verticalAlign: 'middle', minWidth: 0,
  fontSize: 13, color: 'var(--text)',
};
const iconBtnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24, borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--surface)',
  color: 'var(--text-secondary, #616161)', cursor: 'pointer',
  fontFamily: 'inherit',
};
