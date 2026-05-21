// ── CreateEscalationZeroModal (2026-05-21) ─────────────────────────────────
// Composer for the new Escalation Zero workflow on the Feedback board.
// Distinct from CreateFeedbackModal (which stays as the ops_hub_feedback
// composer) so each form can be optimised for its own data shape without
// dozens of `kind === 'escalation_zero' ? … : …` branches.
//
// Fields (from Mohamed's 2026-05-21 scoping doc, derived from the slack
// #hrx-escalations-zero channel):
//   • Summary (title)            — ≤200 chars, required
//   • Ideal Solution (proposed)  — ≤10,000 chars, required
//   • HRX Function               — required; one of 18 categories
//   • Priority                   — Standard | Urgent (default Standard)
//   • Country (multi-select)     — optional; ISO-2 codes, up to 50
//   • Linked Zendesk URL         — optional, http(s) only, ≤2048 chars
//   • Linked Jira URL            — optional, http(s) only, ≤2048 chars
//
// On submit we POST /api/v1/feedback with kind='escalation_zero' + the
// extras payload validated server-side in app/api/v1/feedback/route.js.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ESCALATION_FUNCTIONS,
  ESCALATION_PRIORITIES,
  ESCALATION_FIELD_LIMITS,
} from '../../lib/escalation-zero-constants';

// Common 2-letter ISO-3166 country code set used elsewhere in the app for
// the multi-country picker. Inlined here to avoid importing the
// MultiCountryPicker (which expects a richer member-level junction shape
// — overkill for our 50-cap free-form input). Subset chosen for the
// HRX coverage map; submitters can paste any ISO-2 not in the list.
const COMMON_CC = [
  'US','CA','MX','BR','AR','CL','CO','PE','UY',
  'GB','IE','FR','DE','ES','IT','PT','NL','BE','LU','CH','AT','DK','SE','NO','FI','PL','CZ','GR','TR','HU','RO','BG','HR','SK','SI',
  'ZA','NG','KE','EG','MA',
  'AE','SA','IL',
  'IN','PK','BD','LK',
  'CN','HK','TW','JP','KR','TH','VN','PH','MY','SG','ID','AU','NZ',
];

export default function CreateEscalationZeroModal({ onClose, onSubmit, currentUser }) {
  const [title, setTitle] = useState('');
  const [issue, setIssue] = useState('');                 // = summary body
  const [proposedResolution, setProposed] = useState(''); // = ideal solution
  const [functionKey, setFunctionKey] = useState('');
  const [priorityKey, setPriorityKey] = useState('standard');
  const [countries, setCountries] = useState([]);         // array of ISO-2 strings
  const [countryQuery, setCountryQuery] = useState('');
  const [linkedZdUrl, setLinkedZdUrl] = useState('');
  const [linkedJiraUrl, setLinkedJiraUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const titleInputRef = useRef(null);

  // ESC to close, focus the title input on mount, lock body scroll.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (e) => { if (e.key === 'Escape' && !submitting) onClose?.(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => titleInputRef.current?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
    // submitting / onClose are stable enough for this effect to ignore
    // (we don't want focus to bounce when the submit kicks off).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Country chip add / remove. Uppercases + validates ISO-2 + dedupes +
  // caps at the field limit so the user can't accidentally paste a
  // thousand codes from a spreadsheet.
  const addCountry = useCallback((raw) => {
    const up = String(raw || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(up)) return;
    setCountries((prev) => {
      if (prev.includes(up)) return prev;
      if (prev.length >= ESCALATION_FIELD_LIMITS.countriesMax) return prev;
      return [...prev, up];
    });
    setCountryQuery('');
  }, []);
  const removeCountry = useCallback((cc) => {
    setCountries((prev) => prev.filter((c) => c !== cc));
  }, []);

  // Suggestion list filtered by what the user typed. Limited to 8 to
  // keep the dropdown ~scannable.
  const countrySuggestions = useMemo(() => {
    const q = countryQuery.trim().toUpperCase();
    if (!q) return [];
    return COMMON_CC.filter((cc) => cc.startsWith(q) && !countries.includes(cc)).slice(0, 8);
  }, [countryQuery, countries]);

  // Validation: title + issue + functionKey required. URLs validated on
  // the server (we still surface a soft "must start with http(s)" hint).
  const canSubmit = (
    title.trim().length > 0
    && issue.trim().length > 0
    && !!functionKey
    && !submitting
  );

  const urlLooksValid = (url) => !url || /^https?:\/\//i.test(url.trim());
  const zdValid = urlLooksValid(linkedZdUrl);
  const jiraValid = urlLooksValid(linkedJiraUrl);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    if (!zdValid || !jiraValid) {
      setError('Linked URLs must start with http:// or https://');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit?.({
        kind: 'escalation_zero',
        title: title.trim().slice(0, ESCALATION_FIELD_LIMITS.summaryMax),
        issue: issue.trim().slice(0, ESCALATION_FIELD_LIMITS.issueMax),
        proposedResolution: proposedResolution.trim().slice(0, ESCALATION_FIELD_LIMITS.resolutionMax) || null,
        // Mirror the priority into the existing column (server does the
        // same mapping but sending it client-side keeps the optimistic
        // FE render correct before the response lands).
        priority: priorityKey === 'urgent' ? 'critical' : 'medium',
        type: 'improvement',     // semantic anchor — escalations are improvements
        audience: 'global',       // escalation zero is reviewed by leadership across teams
        category: null,
        screenshot: null,
        attachments: [],
        extras: {
          functionKey,
          priorityKey,
          countries,
          linkedZdUrl: linkedZdUrl.trim(),
          linkedJiraUrl: linkedJiraUrl.trim(),
          escalationStatus: 'new',
        },
      });
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Could not submit escalation');
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="escalation-zero-modal-title"
      style={overlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose?.(); }}
    >
      <form onSubmit={handleSubmit} style={modal}>
        <style>{`
          .ez-input:focus, .ez-textarea:focus, .ez-select:focus {
            border-color: #7c3aed !important;
            box-shadow: 0 0 0 3px rgba(124,58,237,0.15);
            outline: none;
          }
          .ez-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 999px; background: #f3eff8; color: #7c3aed; font-size: 11.5px; font-weight: 600; }
          .ez-chip button { background: none; border: none; cursor: pointer; color: inherit; padding: 0; font-size: 12px; line-height: 1; }
          .ez-suggest:hover { background: var(--surface-2); }
        `}</style>

        <div style={header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'linear-gradient(135deg,#ede9fe 0%,#ddd6fe 100%)',
              color: '#7c3aed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <i className="bi-stars" style={{ fontSize: 19 }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div id="escalation-zero-modal-title" style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
                Raise an Escalation Zero
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                Strategic improvement, process gap, or product feedback. Reviewed by leadership.
              </div>
            </div>
          </div>
          <button type="button" onClick={() => !submitting && onClose?.()} aria-label="Close" style={iconBtn}>
            <i className="bi-x-lg" style={{ fontSize: 14 }} />
          </button>
        </div>

        <div style={body}>
          {/* Summary */}
          <div style={fieldGroup}>
            <label htmlFor="ez-title" style={fieldLabel}>
              Summary <span style={req}>*</span>
            </label>
            <input
              id="ez-title"
              ref={titleInputRef}
              className="ez-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={ESCALATION_FIELD_LIMITS.summaryMax}
              placeholder="One-line summary of what's going wrong"
              style={input}
              disabled={submitting}
            />
            <div style={charCount}>{title.length}/{ESCALATION_FIELD_LIMITS.summaryMax}</div>
          </div>

          {/* Issue / context */}
          <div style={fieldGroup}>
            <label htmlFor="ez-issue" style={fieldLabel}>
              Context / what's happening <span style={req}>*</span>
            </label>
            <textarea
              id="ez-issue"
              className="ez-textarea"
              value={issue}
              onChange={(e) => setIssue(e.target.value)}
              maxLength={ESCALATION_FIELD_LIMITS.issueMax}
              placeholder="What's the situation? Which clients / cases / employees are affected? Any timeline pressure?"
              style={textarea}
              rows={4}
              disabled={submitting}
            />
            <div style={charCount}>{issue.length}/{ESCALATION_FIELD_LIMITS.issueMax}</div>
          </div>

          {/* Ideal solution */}
          <div style={fieldGroup}>
            <label htmlFor="ez-proposed" style={fieldLabel}>
              Ideal solution
            </label>
            <textarea
              id="ez-proposed"
              className="ez-textarea"
              value={proposedResolution}
              onChange={(e) => setProposed(e.target.value)}
              maxLength={ESCALATION_FIELD_LIMITS.resolutionMax}
              placeholder="What would good look like? Concrete changes, new features, process updates — whatever you'd ship."
              style={textarea}
              rows={5}
              disabled={submitting}
            />
            <div style={charCount}>{proposedResolution.length}/{ESCALATION_FIELD_LIMITS.resolutionMax}</div>
          </div>

          {/* Function + Priority (side-by-side at desktop) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 14 }}>
            <div style={fieldGroup}>
              <label htmlFor="ez-function" style={fieldLabel}>
                HRX Function <span style={req}>*</span>
              </label>
              <select
                id="ez-function"
                className="ez-select"
                value={functionKey}
                onChange={(e) => setFunctionKey(e.target.value)}
                style={select}
                disabled={submitting}
              >
                <option value="" disabled>Select a function…</option>
                {ESCALATION_FUNCTIONS.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>
            <div style={fieldGroup}>
              <label style={fieldLabel}>Priority</label>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                {ESCALATION_PRIORITIES.map((p) => {
                  const active = priorityKey === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setPriorityKey(p.key)}
                      disabled={submitting}
                      style={{
                        flex: 1,
                        padding: '8px 12px', borderRadius: 8,
                        border: `1px solid ${active ? p.color : 'var(--border)'}`,
                        background: active ? p.color : 'var(--surface)',
                        color: active ? 'white' : 'var(--text)',
                        fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                        transition: 'all .12s',
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Country multi-select */}
          <div style={fieldGroup}>
            <label htmlFor="ez-country" style={fieldLabel}>
              Country / countries impacted
            </label>
            {countries.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {countries.map((cc) => (
                  <span key={cc} className="ez-chip">
                    {cc}
                    <button type="button" onClick={() => removeCountry(cc)} aria-label={`Remove ${cc}`}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ position: 'relative' }}>
              <input
                id="ez-country"
                className="ez-input"
                type="text"
                value={countryQuery}
                onChange={(e) => setCountryQuery(e.target.value.toUpperCase().slice(0, 2))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (countryQuery.length === 2) addCountry(countryQuery);
                  }
                }}
                placeholder="Type a 2-letter code (e.g. US, FR) and press Enter"
                style={input}
                disabled={submitting || countries.length >= ESCALATION_FIELD_LIMITS.countriesMax}
                maxLength={2}
              />
              {countrySuggestions.length > 0 && (
                <div style={suggestList}>
                  {countrySuggestions.map((cc) => (
                    <button
                      key={cc}
                      type="button"
                      className="ez-suggest"
                      onClick={() => addCountry(cc)}
                      style={suggestItem}
                    >
                      {cc}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={charCount}>{countries.length}/{ESCALATION_FIELD_LIMITS.countriesMax} countries</div>
          </div>

          {/* Linked Zendesk + Jira URLs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={fieldGroup}>
              <label htmlFor="ez-zd" style={fieldLabel}>Linked Zendesk ticket</label>
              <input
                id="ez-zd"
                className="ez-input"
                type="url"
                value={linkedZdUrl}
                onChange={(e) => setLinkedZdUrl(e.target.value)}
                placeholder="https://…zendesk.com/agent/tickets/…"
                style={{ ...input, borderColor: zdValid ? 'var(--border)' : '#dc2626' }}
                maxLength={ESCALATION_FIELD_LIMITS.linkUrlMax}
                disabled={submitting}
              />
            </div>
            <div style={fieldGroup}>
              <label htmlFor="ez-jira" style={fieldLabel}>Linked Jira / Workbench</label>
              <input
                id="ez-jira"
                className="ez-input"
                type="url"
                value={linkedJiraUrl}
                onChange={(e) => setLinkedJiraUrl(e.target.value)}
                placeholder="https://…atlassian.net/browse/…"
                style={{ ...input, borderColor: jiraValid ? 'var(--border)' : '#dc2626' }}
                maxLength={ESCALATION_FIELD_LIMITS.linkUrlMax}
                disabled={submitting}
              />
            </div>
          </div>

          {error && (
            <div role="alert" style={errorBanner}>
              <i className="bi-exclamation-triangle-fill" style={{ fontSize: 13, marginRight: 6 }} />
              {error}
            </div>
          )}
        </div>

        <div style={footer}>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Submitting as <strong>{currentUser?.name || currentUser?.email || 'you'}</strong>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => !submitting && onClose?.()} disabled={submitting} style={ghostBtn}>
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit} style={{ ...primaryBtn, opacity: canSubmit ? 1 : 0.55, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
              {submitting ? (
                <><i className="bi-arrow-repeat" style={{ fontSize: 13, marginRight: 6, animation: 'spin 1s linear infinite' }} /> Submitting…</>
              ) : (
                <><i className="bi-send-fill" style={{ fontSize: 13, marginRight: 6 }} /> Submit escalation</>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
  backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
  zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 16,
};
const modal = {
  width: 'min(720px, 100%)', maxHeight: 'min(92vh, 880px)',
  background: 'var(--surface)', borderRadius: 14,
  boxShadow: 'var(--shadow-lg, 0 24px 64px rgba(15,23,42,0.18))',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  border: '1px solid var(--border-light)',
};
const header = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
  padding: '16px 18px', gap: 12,
  borderBottom: '1px solid var(--border-light)',
};
const body = {
  padding: '16px 18px', flex: 1, minHeight: 0, overflowY: 'auto',
  display: 'flex', flexDirection: 'column', gap: 14,
};
const footer = {
  padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  borderTop: '1px solid var(--border-light)', background: 'var(--surface-2)',
  gap: 12,
};
const fieldGroup = { display: 'flex', flexDirection: 'column', minWidth: 0 };
const fieldLabel = { fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.03em', textTransform: 'uppercase' };
const req = { color: '#dc2626' };
const input = {
  padding: '9px 11px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--surface)',
  color: 'var(--text)', fontSize: 13, lineHeight: 1.4,
  transition: 'border-color .12s, box-shadow .12s',
  width: '100%', boxSizing: 'border-box',
};
const textarea = { ...input, resize: 'vertical', minHeight: 90, fontFamily: 'inherit' };
const select = { ...input, appearance: 'auto', cursor: 'pointer' };
const charCount = { fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3, textAlign: 'right' };
const errorBanner = {
  padding: '10px 12px', borderRadius: 8,
  background: '#fef2f2', color: '#dc2626', fontSize: 12.5, fontWeight: 600,
  border: '1px solid #fecaca',
};
const iconBtn = {
  width: 32, height: 32, borderRadius: 8, border: 'none',
  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
const ghostBtn = {
  padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 600,
  cursor: 'pointer',
};
const primaryBtn = {
  display: 'inline-flex', alignItems: 'center',
  padding: '9px 16px', borderRadius: 10, border: 'none',
  background: '#7c3aed', color: 'white', fontSize: 13, fontWeight: 700,
  boxShadow: '0 2px 8px rgba(124,58,237,0.25)',
};
const suggestList = {
  position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 8, boxShadow: '0 4px 12px rgba(15,23,42,0.06)', zIndex: 5,
  maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column',
};
const suggestItem = {
  background: 'none', border: 'none', textAlign: 'left',
  padding: '8px 12px', cursor: 'pointer', fontSize: 12.5, color: 'var(--text)',
};
