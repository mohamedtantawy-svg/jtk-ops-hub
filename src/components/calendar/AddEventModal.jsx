// ── AddEventModal — form for creating a local calendar item ───────────────
// Writes to calendar_local_events only (no Google push, per spec). We keep
// the form minimal — title, date + time, optional description, colour.
//
// Props:
//   open        — bool
//   defaultDate — Date  (initial date for the picker, usually "today"
//                        or the day the user clicked in the month grid)
//   onClose     — () => void
//   onSubmit    — async ({ title, description, startAt, endAt, color }) => created event

import { memo, useEffect, useState } from 'react';

const COLORS = [
  { key: 'blue',   color: '#1565c0' },
  { key: 'purple', color: '#7c3aed' },
  { key: 'green',  color: '#29811e' },
  { key: 'orange', color: '#ed8d00' },
  { key: 'red',    color: '#d42d35' },
  { key: 'gray',   color: '#6b7280' },
];

// Helpers — build a default form state anchored to defaultDate's DAY.
function pad(n) { return String(n).padStart(2, '0'); }
function isoDay(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function roundTo30Min(d) {
  const copy = new Date(d);
  const m = copy.getMinutes();
  copy.setMinutes(m < 30 ? 30 : 60, 0, 0);
  return copy;
}
function timeOfDay(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

function AddEventModal({ open, defaultDate, onClose, onSubmit }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => isoDay(defaultDate || new Date()));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [color, setColor] = useState('purple');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Reset form whenever the modal opens with a new default date
  // (e.g. user clicks a different day and re-opens).
  useEffect(() => {
    if (!open) return;
    const base = defaultDate || new Date();
    const start = roundTo30Min(base);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setTitle('');
    setDescription('');
    setDate(isoDay(base));
    setStartTime(timeOfDay(start));
    setEndTime(timeOfDay(end));
    setColor('purple');
    setError(null);
    setSubmitting(false);
  }, [open, defaultDate]);

  if (!open) return null;

  const canSubmit = title.trim().length > 0 && !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);

    const startAt = new Date(`${date}T${startTime}`);
    let endAt = new Date(`${date}T${endTime}`);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      setError('Invalid date or time');
      setSubmitting(false);
      return;
    }
    if (endAt <= startAt) {
      // Instead of failing, default end to start+30 — common user shortcut.
      endAt = new Date(startAt.getTime() + 30 * 60 * 1000);
    }

    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        startAt,
        endAt,
        color,
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save');
      setSubmitting(false);
    }
  };

  const handleOverlay = (e) => {
    if (e.target === e.currentTarget && !submitting) onClose();
  };

  return (
    <div
      onClick={handleOverlay}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(17,24,39,0.45)',
        zIndex: 9100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-event-title"
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
          width: '100%', maxWidth: 480,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '16px 22px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <i className="bi-plus-square" style={{ fontSize: 18, color: '#7c3aed' }} />
          <h3 id="add-event-title" style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Add event
          </h3>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={submitting}
            style={{
              background: 'none', border: 'none',
              cursor: submitting ? 'default' : 'pointer',
              color: 'var(--text-3)', fontSize: 18, padding: '4px 8px',
            }}
          >
            <i className="bi-x-lg" />
          </button>
        </div>

        <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
              maxLength={200}
              placeholder="e.g. HR sync"
              style={{
                fontSize: 14,
                padding: '8px 10px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                outline: 'none',
              }}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                style={{ fontSize: 14, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Start</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                style={{ fontSize: 14, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>End</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                style={{ fontSize: 14, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8 }}
              />
            </label>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
              Description <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span>
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              style={{
                fontSize: 13,
                padding: '8px 10px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </label>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>Colour</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {COLORS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setColor(c.key)}
                  aria-label={c.key}
                  title={c.key}
                  style={{
                    width: 26, height: 26,
                    borderRadius: '50%',
                    border: color === c.key ? `2px solid ${c.color}` : '2px solid transparent',
                    background: c.color,
                    cursor: 'pointer',
                    outline: 'none',
                    padding: 0,
                    boxShadow: color === c.key ? '0 0 0 2px #fff inset' : 'none',
                  }}
                />
              ))}
            </div>
          </div>

          {error && (
            <div style={{
              fontSize: 12,
              color: 'var(--red)',
              background: 'var(--red-light, #fef2f2)',
              border: '1px solid var(--red-mid, #fecaca)',
              borderRadius: 8,
              padding: '8px 12px',
            }}>
              {error}
            </div>
          )}
        </div>

        <div style={{
          padding: '14px 22px',
          borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-pill)',
              color: 'var(--text-1)',
              padding: '8px 16px',
              fontSize: 13, fontWeight: 600,
              cursor: submitting ? 'default' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              background: canSubmit ? '#7c3aed' : '#c4b5fd',
              border: 'none',
              borderRadius: 'var(--radius-pill)',
              color: '#fff',
              padding: '8px 18px',
              fontSize: 13, fontWeight: 700,
              cursor: canSubmit ? 'pointer' : 'default',
            }}
          >
            {submitting ? 'Saving…' : 'Add event'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default memo(AddEventModal);
