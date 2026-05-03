// ── Leaders Alerts: Settings drawer ───────────────────────────────────────
// Alerts Admin only. Edits the three settings keys (`categories`,
// `statuses`, `notifications`) without a code deploy. PUT writes
// `leader_alert_settings_history` with the actor + JSON diff.

import { useEffect, useMemo, useState } from 'react';
import { getLeaderAlertsSettings, putLeaderAlertsSettings } from '../../services/leaderAlertsApi';

// ── Defaults / safety nets ────────────────────────────────────────────────

const FALLBACK_CATEGORIES = [
  { id: 'others', label: 'Others', color: '#6b7280', icon: 'bi-three-dots' },
];
const FALLBACK_STATUSES = [
  { id: 'new',         label: 'New',         color: '#1d4ed8' },
  { id: 'in_progress', label: 'In Progress', color: '#ed8d00' },
  { id: 'on_hold',     label: 'On Hold',     color: '#9e9e9e' },
  { id: 'resolved',    label: 'Resolved',    color: '#29811e' },
];
const FALLBACK_NOTIF = {
  newAlertCriticalToAllManagers: true,
  newAlertHighBell:              false,
  newAlertMediumLowBell:         false,
  mentionBell:                   true,
  mentionToast:                  true,
  statusChangeBell:              true,
  newCommentBell:                true,
  reactionBell:                  false,
  ackBell:                       false,
  sidebarBadgeMinSeverity:       'medium',
  mentionOverridesMute:          true,
};

const NOTIF_LABELS = {
  newAlertCriticalToAllManagers: 'Notify every manager when a Critical alert is posted',
  newAlertHighBell:              'Notify followers when a High alert is posted',
  newAlertMediumLowBell:         'Notify followers when a Medium / Low alert is posted',
  mentionBell:                   'Bell entry when a user is @-mentioned',
  mentionToast:                  'In-app toast when a user is @-mentioned',
  statusChangeBell:              'Bell entry on status change (creator + followers)',
  newCommentBell:                'Bell entry on new comment (followers excl. author)',
  reactionBell:                  'Bell entry when someone reacts to a comment',
  ackBell:                       'Bell entry when someone acks an alert',
  mentionOverridesMute:          'A mention always notifies, even on a muted thread',
};

const SEVERITY_OPTIONS = [
  { id: 'critical', label: 'Critical only' },
  { id: 'high',     label: 'High and above' },
  { id: 'medium',   label: 'Medium and above' },
  { id: 'low',      label: 'Every severity (Low and above)' },
];

const TABS = [
  { id: 'categories',    label: 'Categories',    icon: 'bi-tags-fill' },
  { id: 'statuses',      label: 'Statuses',      icon: 'bi-flag-fill' },
  { id: 'notifications', label: 'Notifications', icon: 'bi-bell-fill' },
];

// ── Component ─────────────────────────────────────────────────────────────

const LeaderAlertSettingsPanel = ({ onClose, onSaved }) => {
  const [tab, setTab] = useState('categories');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [categories, setCategories] = useState(FALLBACK_CATEGORIES);
  const [statuses, setStatuses]     = useState(FALLBACK_STATUSES);
  const [notif, setNotif]           = useState(FALLBACK_NOTIF);

  const [savingKey, setSavingKey] = useState(null);
  const [saveOk, setSaveOk]       = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLeaderAlertsSettings()
      .then(d => {
        if (cancelled) return;
        const s = d?.settings || {};
        if (Array.isArray(s.categories) && s.categories.length) setCategories(s.categories);
        if (Array.isArray(s.statuses) && s.statuses.length)     setStatuses(s.statuses);
        if (s.notifications && typeof s.notifications === 'object') setNotif({ ...FALLBACK_NOTIF, ...s.notifications });
      })
      .catch(e => { if (!cancelled) setError(e?.message || 'Could not load settings'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !savingKey) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, savingKey]);

  const save = async (key, value) => {
    setSavingKey(key);
    setSaveOk(null);
    setError(null);
    try {
      await putLeaderAlertsSettings(key, value);
      setSaveOk(key);
      onSaved?.();
      setTimeout(() => setSaveOk(null), 2200);
    } catch (e) {
      setError(e?.message || 'Save failed');
    } finally {
      setSavingKey(null);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !savingKey) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 950,
        background: 'rgba(15, 23, 42, 0.4)',
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div style={{
        width: 'min(620px, 100%)', height: '100%',
        background: 'var(--surface)', boxShadow: 'var(--shadow-lg)',
        display: 'flex', flexDirection: 'column',
        animation: 'la-settings-slide .18s ease-out',
      }}>
        <style>{`@keyframes la-settings-slide { from { transform: translateX(40px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: '#f3eff8', color: '#7c3aed',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <i className="bi-gear-fill" style={{ fontSize: 14 }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Leaders Alerts settings</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Categories, statuses, and notification policy. Changes apply on next page load.</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!!savingKey}
            aria-label="Close"
            style={{
              width: 30, height: 30, borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-secondary)', cursor: savingKey ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <i className="bi-x-lg" style={{ fontSize: 12 }} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
          {TABS.map(t => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 128, border: 'none',
                  background: active ? '#f3eff8' : 'transparent',
                  color: active ? '#5b21b6' : 'var(--text-secondary)',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >
                <i className={t.icon} style={{ fontSize: 11 }} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
          {loading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Loading settings…
            </div>
          )}
          {error && !loading && (
            <div style={{
              padding: '10px 14px', borderRadius: 10,
              background: '#fef2f2', color: '#b91c1c', fontSize: 12, marginBottom: 12,
            }}>
              {error}
            </div>
          )}

          {!loading && tab === 'categories' && (
            <CategoriesEditor
              value={categories}
              onChange={setCategories}
              onSave={(v) => save('categories', v)}
              saving={savingKey === 'categories'}
              saved={saveOk === 'categories'}
            />
          )}

          {!loading && tab === 'statuses' && (
            <StatusesEditor
              value={statuses}
              onChange={setStatuses}
              onSave={(v) => save('statuses', v)}
              saving={savingKey === 'statuses'}
              saved={saveOk === 'statuses'}
            />
          )}

          {!loading && tab === 'notifications' && (
            <NotificationsEditor
              value={notif}
              onChange={setNotif}
              onSave={(v) => save('notifications', v)}
              saving={savingKey === 'notifications'}
              saved={saveOk === 'notifications'}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// ── Categories editor ─────────────────────────────────────────────────────

const CategoriesEditor = ({ value, onChange, onSave, saving, saved }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const update = (idx, patch) => setDraft(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
  const remove = (idx) => setDraft(prev => prev.filter((_, i) => i !== idx));
  const add = () => setDraft(prev => [...prev, { id: `new_${Date.now()}`, label: 'New category', color: '#6b7280', icon: 'bi-tag-fill' }]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  return (
    <div>
      <SectionIntro>
        These appear in the composer's category dropdown and as filter chips on the list.
        The label is what users see; the colour drives the row icon tile.
      </SectionIntro>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {draft.map((c, idx) => (
          <div key={idx} style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr 90px 32px',
            gap: 8, alignItems: 'center',
            padding: '8px 10px', borderRadius: 10,
            background: 'var(--surface-2)', border: '1px solid var(--border-light)',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: `${c.color || '#6b7280'}20`, color: c.color || '#6b7280',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <i className={c.icon || 'bi-tag-fill'} style={{ fontSize: 13 }} />
            </div>
            <input
              type="text"
              value={c.label || ''}
              onChange={(e) => update(idx, { label: e.target.value })}
              placeholder="Label"
              style={inputStyle}
            />
            <input
              type="color"
              value={c.color || '#6b7280'}
              onChange={(e) => update(idx, { color: e.target.value })}
              style={{ height: 30, width: '100%', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer' }}
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              aria-label={`Remove ${c.label}`}
              style={{
                width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--surface)', color: '#b91c1c', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <i className="bi-trash" style={{ fontSize: 12 }} />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        style={{
          marginTop: 10, padding: '6px 12px', borderRadius: 128,
          border: '1px dashed var(--border)', background: 'transparent',
          color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <i className="bi-plus-lg" style={{ fontSize: 11, marginRight: 4 }} />
        Add category
      </button>

      <SaveBar dirty={dirty} saving={saving} saved={saved} onSave={() => onSave(draft)} onReset={() => setDraft(value)} />
    </div>
  );
};

// ── Statuses editor ───────────────────────────────────────────────────────

const StatusesEditor = ({ value, onChange, onSave, saving, saved }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const update = (idx, patch) => setDraft(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));

  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  return (
    <div>
      <SectionIntro>
        Edit labels and colours for the four statuses. Adding or removing a status requires a
        DB migration to update the lifecycle CHECK constraint — talk to engineering before doing that.
      </SectionIntro>

      <div style={{
        marginTop: 8, padding: '8px 12px', borderRadius: 10,
        background: '#fff8e6', color: '#9a3412', fontSize: 11,
      }}>
        <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />
        The four status IDs (`new`, `in_progress`, `on_hold`, `resolved`) are immutable in v1.
        Only the label and colour are editable.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {draft.map((s, idx) => (
          <div key={s.id || idx} style={{
            display: 'grid',
            gridTemplateColumns: '90px 1fr 90px',
            gap: 8, alignItems: 'center',
            padding: '8px 10px', borderRadius: 10,
            background: 'var(--surface-2)', border: '1px solid var(--border-light)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{s.id}</div>
            <input
              type="text"
              value={s.label || ''}
              onChange={(e) => update(idx, { label: e.target.value })}
              placeholder="Label"
              style={inputStyle}
            />
            <input
              type="color"
              value={s.color || '#6b7280'}
              onChange={(e) => update(idx, { color: e.target.value })}
              style={{ height: 30, width: '100%', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer' }}
            />
          </div>
        ))}
      </div>

      <SaveBar dirty={dirty} saving={saving} saved={saved} onSave={() => onSave(draft)} onReset={() => setDraft(value)} />
    </div>
  );
};

// ── Notifications editor ──────────────────────────────────────────────────

const NotificationsEditor = ({ value, onChange, onSave, saving, saved }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const setKey = (k, v) => setDraft(prev => ({ ...prev, [k]: v }));

  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  return (
    <div>
      <SectionIntro>
        Defaults are tuned to keep the bell quiet for everyone except people who really need to know.
        Toggle individual events to widen or narrow what fan-outs.
      </SectionIntro>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
        {Object.entries(NOTIF_LABELS).map(([k, label]) => (
          <ToggleRow
            key={k}
            label={label}
            value={!!draft[k]}
            onChange={(v) => setKey(k, v)}
          />
        ))}
      </div>

      <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 10, background: 'var(--surface-2)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
          Sidebar badge severity threshold
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          The "N unacked" badge on the sidebar Leaders Alerts entry only counts alerts at or above this severity.
        </div>
        <select
          value={draft.sidebarBadgeMinSeverity || 'medium'}
          onChange={(e) => setKey('sidebarBadgeMinSeverity', e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer', maxWidth: 280 }}
        >
          {SEVERITY_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>

      <SaveBar dirty={dirty} saving={saving} saved={saved} onSave={() => onSave(draft)} onReset={() => setDraft(value)} />
    </div>
  );
};

// ── Atoms ─────────────────────────────────────────────────────────────────

const inputStyle = {
  width: '100%', padding: '6px 10px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--surface)',
  color: 'var(--text)', fontSize: 13, outline: 'none',
  height: 30, boxSizing: 'border-box',
};

const SectionIntro = ({ children }) => (
  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{children}</div>
);

const ToggleRow = ({ label, value, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!value)}
    style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      padding: '10px 12px', borderRadius: 10,
      background: value ? '#f3eff8' : 'var(--surface-2)',
      border: `1px solid ${value ? '#7c3aed' : 'var(--border-light)'}`,
      color: 'var(--text)', textAlign: 'left',
      cursor: 'pointer', fontSize: 12, fontWeight: 500,
    }}
  >
    <span>{label}</span>
    <span style={{
      width: 36, height: 20, borderRadius: 10,
      background: value ? '#7c3aed' : 'var(--surface-3)',
      position: 'relative', flexShrink: 0,
      transition: 'background .12s',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: value ? 18 : 2,
        width: 16, height: 16, borderRadius: 8,
        background: 'var(--surface)', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        transition: 'left .12s',
      }} />
    </span>
  </button>
);

const SaveBar = ({ dirty, saving, saved, onSave, onReset }) => (
  <div style={{
    display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8,
    marginTop: 18, paddingTop: 12, borderTop: '1px solid var(--border-light)',
  }}>
    {saved && (
      <span style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>
        <i className="bi-check2 me-1" style={{ marginRight: 4 }} />Saved
      </span>
    )}
    <button
      type="button"
      onClick={onReset}
      disabled={!dirty || saving}
      style={{
        padding: '6px 14px', borderRadius: 128,
        border: '1px solid var(--border)', background: 'var(--surface)',
        color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
        cursor: !dirty || saving ? 'not-allowed' : 'pointer',
        opacity: !dirty || saving ? 0.6 : 1,
      }}
    >
      Reset
    </button>
    <button
      type="button"
      onClick={onSave}
      disabled={!dirty || saving}
      style={{
        padding: '6px 18px', borderRadius: 128, border: 'none',
        background: !dirty || saving ? '#cbd5e1' : '#7c3aed',
        color: 'white', fontSize: 12, fontWeight: 700,
        cursor: !dirty || saving ? 'not-allowed' : 'pointer',
        boxShadow: !dirty || saving ? 'none' : '0 4px 12px rgba(124, 58, 237, 0.3)',
      }}
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
  </div>
);

export default LeaderAlertSettingsPanel;
