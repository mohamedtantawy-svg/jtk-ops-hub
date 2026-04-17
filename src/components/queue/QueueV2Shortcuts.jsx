// ── QueueV2Shortcuts ─────────────────────────────────────────────────────────
// Two overlays: ShortcutHelp (triggered by `?`) and CommandPalette (`/`).
import { useEffect, useRef, useState, useMemo } from 'react';

const SHORTCUTS = [
  { group: 'Navigation', rows: [
    { keys: ['j'], label: 'Next row' },
    { keys: ['k'], label: 'Previous row' },
    { keys: ['Enter'], label: 'Open selected row' },
    { keys: ['Esc'], label: 'Close drawer / overlay' },
    { keys: ['?'], label: 'Show this help' },
    { keys: ['/'], label: 'Command palette' },
  ]},
  { group: 'Actions on selected row', rows: [
    { keys: ['e'], label: 'Escalate' },
    { keys: ['r'], label: 'Reassign' },
    { keys: ['s'], label: 'Snooze' },
    { keys: ['x'], label: 'Resolve' },
    { keys: ['a'], label: 'Assign me (if unassigned)' },
    { keys: ['o'], label: 'Open external source' },
  ]},
  { group: 'View', rows: [
    { keys: ['f'], label: 'Toggle focus mode' },
    { keys: ['b'], label: 'Toggle bundle-by-employee' },
    { keys: ['⌘', 'z'], label: 'Undo last action' },
    { keys: ['g', 'a'], label: 'Go to All' },
    { keys: ['g', 't'], label: 'Go to Tasks' },
    { keys: ['g', 'k'], label: 'Go to Tickets' },
  ]},
];

export function ShortcutHelp({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const kd = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', kd);
    return () => document.removeEventListener('keydown', kd);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 500 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 540, maxWidth: '92vw', maxHeight: '84vh', overflowY: 'auto',
        background: 'white', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        zIndex: 501, padding: 22,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1b1b1b' }}>
            <i className="bi-keyboard" style={{ marginRight: 8 }} />Keyboard shortcuts
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: '#9e9e9e', cursor: 'pointer' }}>
            <i className="bi-x-lg" />
          </button>
        </div>
        {SHORTCUTS.map(g => (
          <div key={g.group} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              {g.group}
            </div>
            {g.rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: i < g.rows.length - 1 ? '1px solid #f5f4f2' : 'none' }}>
                <div style={{ flex: 1, fontSize: 13, color: '#1b1b1b' }}>{r.label}</div>
                <div style={{ display: 'flex', gap: 3 }}>
                  {r.keys.map((k, j) => (
                    <kbd key={j} style={kbdStyle}>{k}</kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

// ── Command palette ──────────────────────────────────────────────────────────
// Commands:
//   /snooze [hours]         — snooze selected row for N hours (default 2)
//   /reassign [name]        — reassign selected row
//   /resolve                — mark selected row resolved
//   /escalate               — escalate selected row
//   /assign me              — self-assign unassigned selected row
//   /open                   — open selected row's source
//   /view save <name>       — save current filter combo as a view
//   /view <name>            — switch to a saved view
//   /focus                  — toggle focus mode
//   /bundle                 — toggle bundle-by-employee
//   /export                 — download CSV of visible rows
//   /clear                  — clear filters
export function CommandPalette({ open, onClose, onCommand, savedViews = [], selected }) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) { setQ(''); return; }
    setTimeout(() => inputRef.current?.focus(), 20);
    const kd = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', kd);
    return () => document.removeEventListener('keydown', kd);
  }, [open, onClose]);

  const base = useMemo(() => ([
    { cmd: '/resolve',        hint: 'Mark selected row resolved',  needs: selected },
    { cmd: '/escalate',       hint: 'Escalate selected row',        needs: selected },
    { cmd: '/reassign',       hint: 'Reassign selected row',        needs: selected },
    { cmd: '/snooze 2h',      hint: 'Snooze selected for 2 hours',  needs: selected },
    { cmd: '/assign me',      hint: 'Self-assign selected row',     needs: selected },
    { cmd: '/open',           hint: 'Open selected row in source',  needs: selected },
    { cmd: '/focus',          hint: 'Toggle focus mode' },
    { cmd: '/bundle',         hint: 'Toggle bundle-by-employee' },
    { cmd: '/export',         hint: 'Download CSV of visible rows' },
    { cmd: '/clear',          hint: 'Clear all filters' },
    { cmd: '/view save',      hint: 'Save current filters as a view' },
    ...savedViews.map(v => ({ cmd: `/view ${v.name}`, hint: 'Switch to saved view' })),
  ]), [selected, savedViews]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return base;
    return base.filter(c => c.cmd.toLowerCase().includes(needle) || c.hint.toLowerCase().includes(needle));
  }, [base, q]);

  if (!open) return null;

  const submit = (cmd) => {
    onCommand?.(cmd);
    onClose?.();
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 500 }} />
      <div style={{
        position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)',
        width: 540, maxWidth: '92vw',
        background: 'white', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        zIndex: 501, overflow: 'hidden',
      }}>
        <form onSubmit={(e) => { e.preventDefault(); submit(q.startsWith('/') ? q : filtered[0]?.cmd); }}
          style={{ padding: '14px 16px', borderBottom: '1px solid #f0efed' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="bi-slash-circle" style={{ fontSize: 14, color: '#9e9e9e' }} />
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
              placeholder="Type a command (e.g., /snooze 2h)"
              style={{ flex: 1, fontSize: 14, border: 'none', outline: 'none', background: 'transparent', color: '#1b1b1b' }} />
          </div>
        </form>
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div style={{ padding: 18, fontSize: 12, color: '#9e9e9e', textAlign: 'center' }}>No matches — press Enter to run the raw command.</div>
          )}
          {filtered.map((c, i) => (
            <button key={i} type="button" onClick={() => submit(c.cmd)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
                width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
                cursor: c.needs === undefined || c.needs ? 'pointer' : 'not-allowed',
                opacity: c.needs === undefined || c.needs ? 1 : 0.4,
                fontSize: 13,
              }}
              disabled={c.needs === undefined ? false : !c.needs}>
              <kbd style={{ ...kbdStyle, fontSize: 11 }}>{c.cmd}</kbd>
              <span style={{ color: '#616161' }}>{c.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

const kbdStyle = {
  display: 'inline-block', padding: '2px 7px', fontSize: 11, fontWeight: 600,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  background: '#f5f4f2', border: '1px solid #e8e8e8', borderRadius: 4,
  color: '#1b1b1b',
};
