// ── CountryHandoverDocView ────────────────────────────────────────────────
// Phase B of HANDOVER_TEMPLATE_REVAMP_PLAN.md. Three-column editor for the
// long-lived per-country handover doc:
//   • Left rail — country list (filtered to caller's editable countries by
//     default; "All" toggle for admins / HR Hub admins).
//   • Main     — 10-section accordion with the field-type matrix from §8.
//   • Right rail (optional) — last 50 history entries + status.
//
// Save model — debounced autosave PATCH per dirty field after 800ms of
// inactivity; status pill drives an explicit Save & Publish button when
// the row is still in draft.
//
// Permission model is enforced server-side (Phase A §7), but we mirror it
// client-side so the "read-only — only X can edit" banner can render
// before the user blunders into a 403.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { FLAGS, getCountryName } from '../../data/constants';
import {
  listCountryHandoverDocs,
  getCountryHandoverDoc,
  patchCountryHandoverDoc,
  publishCountryHandoverDoc,
  getCountryHandoverDocHistory,
} from '../../services/countryHandoverDocsApi';
import {
  Field, TextInput, UrlInput, MarkdownTextarea, TristateToggle, SegmentedControl,
  TagInput, MemberPicker, Repeater, OrderedTextRepeater,
} from './fields';

// ── Section accordion ─────────────────────────────────────────────────────
function Section({ id, title, hint, open, onToggle, children }) {
  return (
    <section
      style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--surface)',
        marginBottom: 12,
        breakInside: 'avoid',
        pageBreakInside: 'avoid',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`section-${id}-content`}
        style={{
          width: '100%',
          padding: '14px 16px',
          background: 'transparent',
          border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12,
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
          color: 'var(--text)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{title}</span>
          {hint && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{hint}</span>}
        </div>
        <i className={`bi ${open ? 'bi-chevron-up' : 'bi-chevron-down'}`} style={{ color: 'var(--text-secondary)' }} />
      </button>
      {open && (
        <div id={`section-${id}-content`} style={{ padding: '0 16px 16px' }}>
          {children}
        </div>
      )}
    </section>
  );
}

// ── Status pill ──────────────────────────────────────────────────────────
function StatusPill({ status }) {
  const map = {
    draft:     { bg: '#FEF3C7', fg: '#92400E', label: 'Draft' },
    published: { bg: '#D1FAE5', fg: '#065F46', label: 'Published' },
    archived:  { bg: '#F1F5F9', fg: '#334155', label: 'Archived' },
  };
  const s = map[status] || map.draft;
  return (
    <span style={{
      padding: '2px 10px', borderRadius: 999,
      background: s.bg, color: s.fg,
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em',
    }}>
      {s.label}
    </span>
  );
}

// ── SaveIndicator ─────────────────────────────────────────────────────────
// idle | dirty | saving | saved (with elapsed ago) | error
function SaveIndicator({ state }) {
  const text = (() => {
    if (state.kind === 'idle') return null;
    if (state.kind === 'dirty') return 'Unsaved changes';
    if (state.kind === 'saving') return 'Saving…';
    if (state.kind === 'error') return `Save failed — ${state.message}`;
    if (state.kind === 'saved') {
      const secs = Math.max(1, Math.round((Date.now() - state.at) / 1000));
      if (secs < 60) return `Saved ${secs}s ago`;
      const mins = Math.round(secs / 60);
      return `Saved ${mins}m ago`;
    }
    return null;
  })();

  if (!text) return null;
  const color = state.kind === 'error' ? '#B91C1C' : 'var(--text-secondary)';
  return (
    <span aria-live="polite" style={{ fontSize: 11, color, fontStyle: 'italic' }}>
      {text}
    </span>
  );
}

// ── Permission gate (client-side mirror of server §7) ─────────────────────
function canEditCountryCode({ user, countryCode, members }) {
  if (!user?.email || !countryCode) return false;
  const role = (user.role || '').toLowerCase();
  if (role === 'admin' || role === 'regional_manager') return true;
  const me = (members || []).find(m => (m?.email || '').toLowerCase() === user.email.toLowerCase());
  if (me?.isHrHubAdmin) return true;
  const owned = (me?.countries || []).map(c => String(c).toUpperCase());
  return owned.includes(countryCode.toUpperCase());
}

// ── PAYROLL_CYCLE_OPTIONS ─────────────────────────────────────────────────
const PAYROLL_CYCLE_OPTIONS = [
  { value: 'on_cycle',  label: 'On-cycle' },
  { value: 'off_cycle', label: 'Off-cycle' },
];

// ── SECTIONS — defines order, ids, titles, hints for accordion + nav ──────
const SECTION_DEFS = [
  { id: 'overview',    title: '1. Overview of HR Operations',     hint: 'Scope, signatory, languages, wet-ink, payroll cycle, stakeholders' },
  { id: 'payroll',     title: '2. Payroll & Stakeholders',        hint: 'Slack channel, country validation link, onboarding buffer' },
  { id: 'onboarding',  title: '3. Onboarding process',            hint: 'Pre-onboarding, manual start-date push, country specifics' },
  { id: 'post_onb',    title: '4. Post-Onboarding',               hint: 'What needs to happen after Day 1' },
  { id: 'amendments',  title: '5. Amendments review',             hint: 'Legal handover URL + country notes' },
  { id: 'offboarding', title: '6. Offboarding',                   hint: 'Termination + resignation processes' },
  { id: 'benefits',    title: '7. Benefits management',           hint: 'One row per benefit (provider, Slack, POCs, SOP)' },
  { id: 'evl',         title: '8. Employment verification',       hint: 'EVL template + SOP URLs + process notes' },
  { id: 'country',     title: '9. Country-specific processes',    hint: 'Visas, PTO, other country quirks' },
  { id: 'faqs',        title: '10. FAQs',                         hint: 'Repeating Q/A pairs the coverer should know' },
];

// ── Field-level "is set" helpers — used by the left-rail badge + section
// "filled" tick. Read-only; nothing more than null/empty/array-empty check.
function isFilled(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'boolean') return true;
  if (Array.isArray(v)) return v.length > 0;
  return false;
}

// Coalesce N field paths against a doc and return how many are filled. Used
// by the section-header "X / Y filled" badge.
function filledCount(doc, keys) {
  if (!doc) return 0;
  let n = 0;
  for (const k of keys) if (isFilled(doc[k])) n++;
  return n;
}

const SECTION_FIELDS = {
  overview:   ['scope_responsibilities','prepared_by_email','signatory','official_languages','wet_ink_required','payroll_cycle','payroll_cutoff_date','stakeholders'],
  payroll:    ['slack_channel_name','country_validation_url','onboarding_buffer'],
  onboarding: ['pre_onboarding_steps','manual_start_date_push','onboarding_team_handles','onboarding_guide_url','country_specific_onboarding'],
  post_onb:   ['post_onboarding_steps'],
  amendments: ['legal_amendment_handover_url','amendments_country_notes'],
  offboarding:['termination_process','termination_handover_url','resignation_process'],
  benefits:   ['benefits'],
  evl:        ['evl_template_url','evl_process_description','evl_sop_urls'],
  country:    ['visas_supported','pto_sop_urls','pto_key_aspects','pto_carry_over_rules','other_country_processes'],
  faqs:       ['faqs'],
};

// ── Sub-component: section bodies ─────────────────────────────────────────
function OverviewSection({ doc, members, update, readOnly }) {
  return (
    <>
      <Field label="Scope of responsibilities" hint="What this country team is responsible for — leave blank to keep the default template wording.">
        <MarkdownTextarea value={doc.scope_responsibilities} onChange={v => update({ scope_responsibilities: v })} readOnly={readOnly} placeholder="e.g. Onboarding, payroll, terminations, amendments…" minRows={4} />
      </Field>
      <Field label="Prepared by" hint="Country owner whose name appears on the doc. Defaults to the first owner in the Team-tab picker when blank.">
        <MemberPicker value={doc.prepared_by_email} onChange={v => update({ prepared_by_email: v })} members={members} readOnly={readOnly} />
      </Field>
      <Field label="Signatory" hint="Who signs employment agreements for this country">
        <TextInput value={doc.signatory} onChange={v => update({ signatory: v })} readOnly={readOnly} placeholder="Full name or role" />
      </Field>
      <Field label="Official languages" hint="ISO-2 codes — type and press Enter (e.g. EN, FR)">
        <TagInput value={doc.official_languages} onChange={v => update({ official_languages: v })} readOnly={readOnly} placeholder="EN, FR…" />
      </Field>
      <Field label="Wet ink required?">
        <TristateToggle value={doc.wet_ink_required} onChange={v => update({ wet_ink_required: v })} readOnly={readOnly} />
      </Field>
      <Field label="Payroll cycle for terminations">
        <SegmentedControl value={doc.payroll_cycle} onChange={v => update({ payroll_cycle: v })} options={PAYROLL_CYCLE_OPTIONS} readOnly={readOnly} />
      </Field>
      <Field label="Payroll cut-off date" hint='Free text — e.g. "15th of the month", "5 business days before EOM"'>
        <TextInput value={doc.payroll_cutoff_date} onChange={v => update({ payroll_cutoff_date: v })} readOnly={readOnly} placeholder="15th of the month" />
      </Field>
      <Field label="Stakeholders" hint="Add one row per PRM / Legal / CFM / Other contact.">
        <Repeater
          value={doc.stakeholders}
          onChange={v => update({ stakeholders: v })}
          readOnly={readOnly}
          addLabel="Add stakeholder"
          emptyHint="No stakeholders yet — add at least the PRM."
          emptyRow={() => ({ role: 'PRM', label: '', name: '', email: '' })}
          renderRow={(row, i, rowUpdate) => (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Role">
                <SegmentedControl
                  value={row.role}
                  onChange={v => rowUpdate({ ...row, role: v })}
                  options={[
                    { value: 'PRM', label: 'PRM' },
                    { value: 'Legal', label: 'Legal' },
                    { value: 'CFM', label: 'CFM' },
                    { value: 'Other', label: 'Other' },
                  ]}
                  readOnly={readOnly}
                />
              </Field>
              <Field label="Label (if Other)">
                <TextInput value={row.label} onChange={v => rowUpdate({ ...row, label: v })} readOnly={readOnly} placeholder="Tax advisor, Audit firm…" />
              </Field>
              <Field label="Name">
                <TextInput value={row.name} onChange={v => rowUpdate({ ...row, name: v })} readOnly={readOnly} placeholder="Full name" />
              </Field>
              <Field label="Email">
                <TextInput value={row.email} onChange={v => rowUpdate({ ...row, email: v })} readOnly={readOnly} placeholder="name@company.com" />
              </Field>
            </div>
          )}
        />
      </Field>
    </>
  );
}

function PayrollSection({ doc, update, readOnly }) {
  return (
    <>
      <Field label="Slack country channel" hint='Prefix with # — or type "NONE" if there isn’t one yet.'>
        <TextInput value={doc.slack_channel_name} onChange={v => update({ slack_channel_name: v })} readOnly={readOnly} placeholder="#country-fr" />
      </Field>
      <Field label="Country validation URL" hint="Link to the country-validation playbook">
        <UrlInput value={doc.country_validation_url} onChange={v => update({ country_validation_url: v })} readOnly={readOnly} />
      </Field>
      <Field label="Onboarding buffer time" hint="Lead time the team needs before a start date">
        <TextInput value={doc.onboarding_buffer} onChange={v => update({ onboarding_buffer: v })} readOnly={readOnly} placeholder="7 business days" />
      </Field>
    </>
  );
}

function OnboardingSection({ doc, update, readOnly }) {
  return (
    <>
      <Field label="Pre-onboarding steps" hint="Ordered list — drag arrows on each row to reorder.">
        <OrderedTextRepeater value={doc.pre_onboarding_steps} onChange={v => update({ pre_onboarding_steps: v })} readOnly={readOnly} />
      </Field>
      <Field label="Manual start-date push" hint="When this country routinely needs the start date pushed">
        <TextInput value={doc.manual_start_date_push} onChange={v => update({ manual_start_date_push: v })} readOnly={readOnly} placeholder="e.g. when EOR can't process inside 5 days" />
      </Field>
      <Field label="Does the onboarding team handle this country?">
        <TristateToggle value={doc.onboarding_team_handles} onChange={v => update({ onboarding_team_handles: v })} readOnly={readOnly} />
      </Field>
      <Field label="Onboarding guide URL">
        <UrlInput value={doc.onboarding_guide_url} onChange={v => update({ onboarding_guide_url: v })} readOnly={readOnly} />
      </Field>
      <Field label="Country-specific onboarding notes">
        <MarkdownTextarea value={doc.country_specific_onboarding} onChange={v => update({ country_specific_onboarding: v })} readOnly={readOnly} minRows={4} />
      </Field>
    </>
  );
}

function PostOnboardingSection({ doc, update, readOnly }) {
  return (
    <Field label="Post-onboarding steps" hint="What needs to happen after Day 1">
      <MarkdownTextarea value={doc.post_onboarding_steps} onChange={v => update({ post_onboarding_steps: v })} readOnly={readOnly} minRows={6} />
    </Field>
  );
}

function AmendmentsSection({ doc, update, readOnly }) {
  return (
    <>
      <Field label="Legal amendment handover URL">
        <UrlInput value={doc.legal_amendment_handover_url} onChange={v => update({ legal_amendment_handover_url: v })} readOnly={readOnly} />
      </Field>
      <Field label="Amendments — country notes">
        <MarkdownTextarea value={doc.amendments_country_notes} onChange={v => update({ amendments_country_notes: v })} readOnly={readOnly} minRows={4} />
      </Field>
    </>
  );
}

function OffboardingSection({ doc, update, readOnly }) {
  return (
    <>
      <Field label="Termination process">
        <MarkdownTextarea value={doc.termination_process} onChange={v => update({ termination_process: v })} readOnly={readOnly} minRows={4} />
      </Field>
      <Field label="Termination handover URL">
        <UrlInput value={doc.termination_handover_url} onChange={v => update({ termination_handover_url: v })} readOnly={readOnly} />
      </Field>
      <Field label="Resignation process">
        <MarkdownTextarea value={doc.resignation_process} onChange={v => update({ resignation_process: v })} readOnly={readOnly} minRows={4} />
      </Field>
    </>
  );
}

function BenefitsSection({ doc, update, readOnly }) {
  return (
    <Field label="Benefits" hint="One row per benefit/perk.">
      <Repeater
        value={doc.benefits}
        onChange={v => update({ benefits: v })}
        readOnly={readOnly}
        addLabel="Add benefit"
        emptyHint="No benefits documented yet."
        emptyRow={() => ({ benefit_type: '', provider_name: '', slack_channel: '', pocs: '', sop_url: '', country_process: '' })}
        renderRow={(row, i, rowUpdate) => (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Type"><TextInput value={row.benefit_type} onChange={v => rowUpdate({ ...row, benefit_type: v })} readOnly={readOnly} placeholder="Health, Pension…" /></Field>
            <Field label="Provider"><TextInput value={row.provider_name} onChange={v => rowUpdate({ ...row, provider_name: v })} readOnly={readOnly} /></Field>
            <Field label="Slack channel"><TextInput value={row.slack_channel} onChange={v => rowUpdate({ ...row, slack_channel: v })} readOnly={readOnly} placeholder="#…" /></Field>
            <Field label="Points of contact"><TextInput value={row.pocs} onChange={v => rowUpdate({ ...row, pocs: v })} readOnly={readOnly} placeholder="Name + email" /></Field>
            <Field label="SOP URL"><UrlInput value={row.sop_url} onChange={v => rowUpdate({ ...row, sop_url: v })} readOnly={readOnly} /></Field>
            <Field label="Country process"><MarkdownTextarea value={row.country_process} onChange={v => rowUpdate({ ...row, country_process: v })} readOnly={readOnly} minRows={2} /></Field>
          </div>
        )}
      />
    </Field>
  );
}

function EvlSection({ doc, update, readOnly }) {
  return (
    <>
      <Field label="EVL template URL">
        <UrlInput value={doc.evl_template_url} onChange={v => update({ evl_template_url: v })} readOnly={readOnly} />
      </Field>
      <Field label="EVL process description">
        <MarkdownTextarea value={doc.evl_process_description} onChange={v => update({ evl_process_description: v })} readOnly={readOnly} minRows={4} />
      </Field>
      <Field label="EVL SOP URLs" hint="Paste links, press Enter to add">
        <TagInput value={doc.evl_sop_urls} onChange={v => update({ evl_sop_urls: v })} readOnly={readOnly} placeholder="https://…" />
      </Field>
    </>
  );
}

function CountrySpecificSection({ doc, update, readOnly }) {
  return (
    <>
      <Field label="Visas supported?">
        <TristateToggle value={doc.visas_supported} onChange={v => update({ visas_supported: v })} readOnly={readOnly} />
      </Field>
      <Field label="PTO SOP URLs" hint="One link per row; press Enter to add">
        <TagInput value={doc.pto_sop_urls} onChange={v => update({ pto_sop_urls: v })} readOnly={readOnly} placeholder="https://…" />
      </Field>
      <Field label="PTO key aspects">
        <MarkdownTextarea value={doc.pto_key_aspects} onChange={v => update({ pto_key_aspects: v })} readOnly={readOnly} minRows={4} />
      </Field>
      <Field label="PTO carry-over rules">
        <MarkdownTextarea value={doc.pto_carry_over_rules} onChange={v => update({ pto_carry_over_rules: v })} readOnly={readOnly} minRows={3} />
      </Field>
      <Field label="Other country-specific processes">
        <MarkdownTextarea value={doc.other_country_processes} onChange={v => update({ other_country_processes: v })} readOnly={readOnly} minRows={4} />
      </Field>
    </>
  );
}

function FaqsSection({ doc, update, readOnly }) {
  return (
    <Field label="FAQs" hint="Country-specific questions the coverer should be able to answer.">
      <Repeater
        value={doc.faqs}
        onChange={v => update({ faqs: v })}
        readOnly={readOnly}
        addLabel="Add FAQ"
        emptyHint="No FAQs yet."
        emptyRow={() => ({ question: '', answer: '' })}
        renderRow={(row, i, rowUpdate) => (
          <>
            <Field label="Question">
              <TextInput value={row.question} onChange={v => rowUpdate({ ...row, question: v })} readOnly={readOnly} placeholder="What happens if…" />
            </Field>
            <Field label="Answer">
              <MarkdownTextarea value={row.answer} onChange={v => rowUpdate({ ...row, answer: v })} readOnly={readOnly} minRows={3} />
            </Field>
          </>
        )}
      />
    </Field>
  );
}

const SECTION_BODIES = {
  overview:    OverviewSection,
  payroll:     PayrollSection,
  onboarding:  OnboardingSection,
  post_onb:    PostOnboardingSection,
  amendments:  AmendmentsSection,
  offboarding: OffboardingSection,
  benefits:    BenefitsSection,
  evl:         EvlSection,
  country:     CountrySpecificSection,
  faqs:        FaqsSection,
};

// ── Main view ─────────────────────────────────────────────────────────────
export default function CountryHandoverDocView({ user }) {
  const { members } = useTeamMembers();

  const [list, setList] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedCC, setSelectedCC] = useState(null);
  const [doc, setDoc] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [error, setError] = useState(null);
  const [openSections, setOpenSections] = useState(() => new Set(['overview']));
  const [filter, setFilter] = useState('mine'); // 'mine' | 'all'
  const [search, setSearch] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saveState, setSaveState] = useState({ kind: 'idle' });
  const [publishing, setPublishing] = useState(false);

  const isAdmin = (user?.role || '').toLowerCase() === 'admin' || (user?.role || '').toLowerCase() === 'regional_manager';
  const myEmail = (user?.email || '').toLowerCase();

  const me = useMemo(
    () => (members || []).find(m => (m?.email || '').toLowerCase() === myEmail),
    [members, myEmail],
  );
  const myCountries = useMemo(() => {
    const set = new Set();
    for (const c of (me?.countries || [])) set.add(String(c).toUpperCase());
    return set;
  }, [me]);

  const canEdit = useMemo(
    () => selectedCC ? canEditCountryCode({ user, countryCode: selectedCC, members }) : false,
    [user, selectedCC, members],
  );

  const readOnly = !canEdit;

  // ── Load list on mount ──────────────────────────────────────────────────
  const refreshList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await listCountryHandoverDocs();
      setList(Array.isArray(res?.items) ? res.items : []);
    } catch (err) {
      console.warn('[CountryHandoverDocView] list failed:', err?.message);
      setList([]);
    } finally {
      setListLoading(false);
    }
  }, []);
  useEffect(() => { refreshList(); }, [refreshList]);

  // ── Auto-select first matching country ──────────────────────────────────
  useEffect(() => {
    if (selectedCC) return;
    if (list.length === 0) return;
    const editableFirst = list.find(d => (filter === 'mine' ? myCountries.has(d.country_code) : true));
    if (editableFirst) setSelectedCC(editableFirst.country_code);
  }, [list, selectedCC, filter, myCountries]);

  // ── Load selected doc ───────────────────────────────────────────────────
  const refreshDoc = useCallback(async (cc) => {
    if (!cc) { setDoc(null); return; }
    setDocLoading(true);
    setError(null);
    try {
      const res = await getCountryHandoverDoc(cc);
      setDoc(res?.item || null);
      setSaveState({ kind: 'idle' });
    } catch (err) {
      console.warn('[CountryHandoverDocView] get failed:', err?.message);
      setDoc(null);
      setError(err?.message || 'Failed to load doc');
    } finally {
      setDocLoading(false);
    }
  }, []);
  useEffect(() => { refreshDoc(selectedCC); }, [selectedCC, refreshDoc]);

  // ── History (lazy on first open) ────────────────────────────────────────
  useEffect(() => {
    if (!historyOpen || !selectedCC) return;
    let cancelled = false;
    setHistoryLoading(true);
    getCountryHandoverDocHistory(selectedCC)
      .then(res => { if (!cancelled) setHistory(res?.items || []); })
      .catch(err => { console.warn('[CountryHandoverDocView] history failed:', err?.message); if (!cancelled) setHistory([]); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [historyOpen, selectedCC]);

  // Reload history after a successful save (so the pane reflects the new
  // entry next time it's opened).
  function bumpHistoryIfOpen() {
    if (!historyOpen) return;
    getCountryHandoverDocHistory(selectedCC).then(res => setHistory(res?.items || [])).catch(() => {});
  }

  // ── Debounced autosave ──────────────────────────────────────────────────
  // We hold a pending patch (accumulating from every update call) and
  // flush it after 800ms of inactivity. setSaveState transitions through
  // dirty → saving → saved so the indicator never lies about state.
  const pendingRef = useRef({});
  const debounceRef = useRef(null);
  const inFlightRef = useRef(false);

  const flushSave = useCallback(async () => {
    debounceRef.current = null;
    if (!selectedCC) return;
    const body = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(body).length === 0) return;
    if (!canEdit) return;
    inFlightRef.current = true;
    setSaveState({ kind: 'saving' });
    try {
      const res = await patchCountryHandoverDoc(selectedCC, body);
      if (res?.item) setDoc(res.item);
      setSaveState({ kind: 'saved', at: Date.now() });
      bumpHistoryIfOpen();
      // Refresh the left-rail summary so counts/freshness pick up the save.
      refreshList();
    } catch (err) {
      console.warn('[CountryHandoverDocView] patch failed:', err?.message);
      setSaveState({ kind: 'error', message: err?.body?.error || err?.message || 'Network error' });
      // Re-apply the un-saved fields so the next flush retries them.
      pendingRef.current = { ...body, ...pendingRef.current };
    } finally {
      inFlightRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCC, canEdit, refreshList]);

  // Update the local doc immediately + schedule a save.
  const update = useCallback((patch) => {
    if (!canEdit) return;
    setDoc(prev => prev ? { ...prev, ...patch } : prev);
    pendingRef.current = { ...pendingRef.current, ...patch };
    setSaveState({ kind: 'dirty' });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(flushSave, 800);
  }, [canEdit, flushSave]);

  // Flush on unmount / country change so we don't lose unsaved edits.
  useEffect(() => () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);
  useEffect(() => {
    // Save on country switch.
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        flushSave();
      }
    };
  }, [selectedCC, flushSave]);

  // ── Publish flow ────────────────────────────────────────────────────────
  async function doPublish(unpublish = false) {
    if (!selectedCC || publishing) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      await flushSave();
    }
    const verb = unpublish ? 'Unpublish' : 'Publish';
    const ok = typeof window !== 'undefined' && window.confirm(
      unpublish
        ? `Unpublish the ${selectedCC} country handover doc?\n\nCoverers will lose read access until you publish again.`
        : `Publish the ${selectedCC} country handover doc?\n\nCoverers (and the rest of the org) will be able to read it once you confirm.`
    );
    if (!ok) return;
    setPublishing(true);
    try {
      const res = await publishCountryHandoverDoc(selectedCC, { unpublish });
      if (res?.item) setDoc(res.item);
      refreshList();
      bumpHistoryIfOpen();
    } catch (err) {
      console.warn('[CountryHandoverDocView] publish failed:', err?.message);
      setSaveState({ kind: 'error', message: err?.body?.error || err?.message || verb + ' failed' });
    } finally {
      setPublishing(false);
    }
  }

  // ── Derived left-rail rows (filter + search) ────────────────────────────
  // Phase F: search matches country code OR updated_by_email — basic
  // typeahead. Stakeholder/FAQ keyword search would need a backend
  // index pass; deferred to a future polish PR.
  const visibleList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list
      .filter(d => {
        if (filter === 'mine' && !myCountries.has(d.country_code) && !isAdmin) return false;
        if (q) {
          const hay = `${d.country_code} ${d.updated_by_email || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => a.country_code.localeCompare(b.country_code));
  }, [list, filter, myCountries, isAdmin, search]);

  const selectedSummary = useMemo(
    () => list.find(d => d.country_code === selectedCC) || null,
    [list, selectedCC],
  );

  function toggleSection(id) {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, background: 'var(--bg)' }}>
      {/* ── Left rail: country list ───────────────────────────────────── */}
      <aside data-print-hide style={{
        width: 260, flexShrink: 0,
        borderRight: '1px solid var(--border-light)',
        background: 'var(--surface)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 14px 8px' }}>
          <div role="tablist" aria-label="Country filter" style={{ display: 'inline-flex', borderRadius: 8, background: 'rgba(15,23,42,0.05)', padding: 2, marginBottom: 10 }}>
            {[
              { id: 'mine', label: 'Mine' },
              { id: 'all',  label: 'All' },
            ].map(opt => {
              const active = filter === opt.id;
              return (
                <button
                  key={opt.id}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => setFilter(opt.id)}
                  style={{
                    padding: '5px 12px', fontSize: 11, fontWeight: active ? 700 : 500,
                    fontFamily: 'inherit', border: 'none',
                    background: active ? 'var(--surface)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text-secondary)',
                    borderRadius: 6, cursor: 'pointer',
                    boxShadow: active ? '0 1px 2px rgba(15,23,42,0.08)' : 'none',
                  }}
                >{opt.label}</button>
              );
            })}
          </div>
          <input
            type="search"
            placeholder="Search by country or owner…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '8px 10px',
              border: '1px solid var(--border)', borderRadius: 8,
              fontSize: 12, fontFamily: 'inherit',
              background: 'var(--bg)', color: 'var(--text)',
            }}
          />
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '0 8px 12px' }}>
          {listLoading ? (
            <div style={{ padding: 12, color: 'var(--text-secondary)', fontSize: 12 }}>Loading countries…</div>
          ) : visibleList.length === 0 ? (
            <div style={{ padding: 12, color: 'var(--text-secondary)', fontSize: 12 }}>
              {filter === 'mine' ? 'You don’t own any countries yet — switch to "All" to browse.' : 'No countries match your search.'}
            </div>
          ) : visibleList.map(d => {
            const active = d.country_code === selectedCC;
            const owned = myCountries.has(d.country_code);
            return (
              <button
                key={d.country_code}
                type="button"
                onClick={() => setSelectedCC(d.country_code)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '8px 10px', marginBottom: 2,
                  background: active ? 'rgba(124, 58, 237, 0.10)' : 'transparent',
                  color: active ? 'var(--purple)' : 'var(--text)',
                  border: '1px solid ' + (active ? 'rgba(124,58,237,0.30)' : 'transparent'),
                  borderRadius: 8,
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 13, fontWeight: active ? 700 : 500,
                  textAlign: 'left',
                }}
              >
                {/* 2026-05-21 audit F33: render flag + name alongside
                    the ISO2 code so users don't have to recall that AD =
                    Andorra / AE = UAE / AL = Albania. Status pill moved to
                    a smaller right-aligned chip so the country name has
                    room to breathe. */}
                <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>{FLAGS[d.country_code] || ''}</span>
                <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{d.country_code}</span>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: active ? 'var(--purple)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {getCountryName(d.country_code) || d.country_code}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 500, flexShrink: 0 }}>
                  {d.status === 'published' ? `${d.counts?.sections_filled || 0}/10` : 'Draft'}
                </span>
                {owned && <i className="bi bi-pencil-square" title="You own this country" style={{ fontSize: 11, color: 'var(--text-secondary)' }} />}
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── Main pane ────────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedCC ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
            Select a country on the left to start editing.
          </div>
        ) : docLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
            <i className="bi bi-arrow-repeat" style={{ marginRight: 6 }} />
            Loading {selectedCC}…
          </div>
        ) : error ? (
          <div style={{ flex: 1, padding: 32, color: '#B91C1C', fontSize: 13 }}>
            {error}
          </div>
        ) : !doc ? null : (
          <>
            <header style={{
              padding: '14px 24px',
              borderBottom: '1px solid var(--border-light)',
              background: 'var(--surface)',
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{doc.country_code}</span>
                <StatusPill status={doc.status} />
              </div>
              <div style={{ flex: 1 }} />
              <SaveIndicator state={saveState} />
              <button
                type="button"
                onClick={() => { if (typeof window !== 'undefined') window.print(); }}
                style={{
                  height: 32, padding: '0 12px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                }}
                title="Print this country doc (Phase F)"
              >
                <i className="bi bi-printer" style={{ marginRight: 6 }} />
                Print
              </button>
              {!readOnly && (
                <>
                  <button
                    type="button"
                    onClick={() => setHistoryOpen(o => !o)}
                    aria-pressed={historyOpen}
                    style={{
                      height: 32, padding: '0 12px', borderRadius: 8,
                      border: '1px solid var(--border)', background: 'var(--surface)',
                      color: 'var(--text)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    <i className="bi bi-clock-history" style={{ marginRight: 6 }} />
                    History
                  </button>
                  <button
                    type="button"
                    onClick={() => doPublish(doc.status === 'published')}
                    disabled={publishing}
                    style={{
                      height: 32, padding: '0 14px', borderRadius: 8,
                      border: 'none',
                      background: doc.status === 'published' ? 'var(--surface)' : 'var(--purple, #7c3aed)',
                      color: doc.status === 'published' ? 'var(--text)' : 'white',
                      ...(doc.status === 'published' ? { borderColor: 'var(--border)', borderStyle: 'solid', borderWidth: 1 } : {}),
                      fontSize: 12, fontWeight: 700,
                      cursor: publishing ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit',
                      opacity: publishing ? 0.6 : 1,
                    }}
                  >
                    {doc.status === 'published' ? 'Unpublish' : 'Save & Publish'}
                  </button>
                </>
              )}
            </header>

            {readOnly && (
              <div style={{
                margin: '12px 24px 0',
                padding: '10px 14px',
                background: '#FEF3C7',
                border: '1px solid #FDE68A',
                borderRadius: 10,
                color: '#92400E',
                fontSize: 12,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <i className="bi bi-lock-fill" style={{ fontSize: 14 }} />
                <span>Read-only — only country owners and HR Hub admins can edit this doc.</span>
              </div>
            )}

            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              {/* Editor accordion */}
              <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
                {SECTION_DEFS.map(s => {
                  const Body = SECTION_BODIES[s.id];
                  const filled = filledCount(doc, SECTION_FIELDS[s.id]);
                  const total = SECTION_FIELDS[s.id].length;
                  return (
                    <div key={s.id}>
                      <Section
                        id={s.id}
                        title={s.title}
                        hint={`${filled}/${total} fields filled · ${s.hint}`}
                        open={openSections.has(s.id)}
                        onToggle={() => toggleSection(s.id)}
                      >
                        <Body doc={doc} members={members || []} update={update} readOnly={readOnly} />
                      </Section>
                    </div>
                  );
                })}

                {/* Misc footer field */}
                <Section
                  id="misc"
                  title="Misc"
                  hint="Folder with documents & drafts per country"
                  open={openSections.has('misc')}
                  onToggle={() => toggleSection('misc')}
                >
                  <Field label="Docs folder URL">
                    <UrlInput value={doc.docs_folder_url} onChange={v => update({ docs_folder_url: v })} readOnly={readOnly} />
                  </Field>
                </Section>

                <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-secondary)', textAlign: 'right' }}>
                  Updated {doc.updated_at ? new Date(doc.updated_at).toLocaleString() : '—'}
                  {doc.updated_by_email ? ` · by ${doc.updated_by_email}` : ''}
                </div>
              </div>

              {/* History pane (right rail) */}
              {historyOpen && (
                <aside style={{
                  width: 320, flexShrink: 0,
                  borderLeft: '1px solid var(--border-light)',
                  background: 'var(--surface)',
                  overflow: 'auto',
                  padding: '16px 18px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <strong style={{ fontSize: 13, color: 'var(--text)' }}>History</strong>
                    <button
                      type="button"
                      onClick={() => setHistoryOpen(false)}
                      aria-label="Close history"
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 14 }}
                    >×</button>
                  </div>
                  {historyLoading ? (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Loading…</div>
                  ) : history.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No edits yet.</div>
                  ) : history.map(h => (
                    <div key={h.id} style={{
                      padding: 10, marginBottom: 8,
                      border: '1px solid var(--border)', borderRadius: 10,
                      background: 'var(--bg)',
                      fontSize: 12,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{h.edited_by_email}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{new Date(h.edited_at).toLocaleString()}</span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)' }}>
                        {h.comment ? `${h.comment} · ` : ''}{h.changed_fields.length} field{h.changed_fields.length === 1 ? '' : 's'} changed
                      </div>
                      {h.changed_fields.length > 0 && (
                        <div style={{ marginTop: 4, fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, monospace', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                          {h.changed_fields.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </aside>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
