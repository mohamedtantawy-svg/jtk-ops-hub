// ── Zendesk custom-field discovery (Phase 2) ────────────────────────────────
// Maps internal FE keys → Zendesk ticket-field titles. The user confirmed
// these four titles match exactly what's configured in Zendesk; if the
// admin renames one in Zendesk, update the title here (or fall back to
// substring match — see resolveCustomFieldIds() below).
//
// On first request we GET /ticket_fields.json, find each field by title,
// and cache the resolved {id, type, options} structure in-process for an
// hour. Field config rarely changes, so a stale-by-up-to-1h discovery is
// acceptable and saves us a round-trip on every queue refresh.
// ────────────────────────────────────────────────────────────────────────────

import { getTicketFields, isZendeskConfigured } from './zendesk-api';

// FE key → ZD field title (case-insensitive, trimmed match).
export const ZD_CUSTOM_FIELD_TITLES = {
  employeeCountry:    'Employee Country',
  form:               'Form',
  rootCauseSupport:   'Root Cause - Support',
  rootCauseSelector:  'Root Cause Selector',
};

// All FE keys, in display order.
export const ZD_CUSTOM_FIELD_KEYS = Object.keys(ZD_CUSTOM_FIELD_TITLES);

const CACHE_TTL_MS = 60 * 60 * 1000;        // 1 hour
let _cache = { value: null, ts: 0, inflight: null };

function normalizeTitle(s) {
  return String(s || '').trim().toLowerCase();
}

function buildShape(rawFields) {
  // Build a {feKey → {id, type, options}} map. Fields not found in Zendesk
  // produce a null entry so the FE can render a clearly-disabled control
  // ("field not configured in Zendesk") instead of crashing.
  const byTitle = new Map();
  for (const f of rawFields) {
    if (!f?.title) continue;
    byTitle.set(normalizeTitle(f.title), f);
  }
  const out = {};
  for (const [feKey, title] of Object.entries(ZD_CUSTOM_FIELD_TITLES)) {
    const f = byTitle.get(normalizeTitle(title));
    if (!f) {
      out[feKey] = null;
      continue;
    }
    out[feKey] = {
      id: f.id,
      title: f.title,
      type: f.type, // 'tagger' (dropdown), 'text', 'textarea', 'checkbox', etc.
      // For dropdown/multiselect fields, ZD returns options on
      // `custom_field_options`. For other types, options stays empty.
      options: Array.isArray(f.custom_field_options)
        ? f.custom_field_options.map(o => ({ value: o.value, name: o.name, default: !!o.default }))
        : [],
    };
  }
  return out;
}

// Discover the 4 fields with in-process cache + concurrent-call dedup.
// Returns a Promise<{ employeeCountry, form, rootCauseSupport, rootCauseSelector }>
// where each entry is either { id, title, type, options } or null.
export async function resolveCustomFieldIds({ force = false } = {}) {
  if (!isZendeskConfigured()) {
    return { employeeCountry: null, form: null, rootCauseSupport: null, rootCauseSelector: null };
  }
  const now = Date.now();
  if (!force && _cache.value && (now - _cache.ts) < CACHE_TTL_MS) return _cache.value;
  if (_cache.inflight) return _cache.inflight;

  _cache.inflight = (async () => {
    try {
      const res = await getTicketFields();
      const shape = buildShape(res?.ticket_fields || []);
      _cache = { value: shape, ts: Date.now(), inflight: null };
      return shape;
    } catch (err) {
      console.warn('[zendesk-fields] discovery failed:', err.message);
      _cache.inflight = null;
      // Fall back to whatever's cached, or an empty shape — never throw,
      // because callers are on the hot queue path.
      return _cache.value || { employeeCountry: null, form: null, rootCauseSupport: null, rootCauseSelector: null };
    }
  })();
  return _cache.inflight;
}

// Read the values of our 4 custom fields from a Zendesk ticket payload.
// `ticket.custom_fields` is an array `[{id, value}, ...]` — we look up each
// FE key's ID via the discovered map and extract its value (or null).
export function extractCustomFieldValues(ticket, fieldMeta) {
  const tcf = Array.isArray(ticket?.custom_fields) ? ticket.custom_fields : [];
  const byId = new Map(tcf.map(f => [f.id, f.value]));
  const out = {};
  for (const feKey of ZD_CUSTOM_FIELD_KEYS) {
    const meta = fieldMeta?.[feKey];
    if (!meta?.id) { out[feKey] = null; continue; }
    const v = byId.get(meta.id);
    out[feKey] = (v === undefined || v === null || v === '') ? null : v;
  }
  return out;
}

// Build the body of a `PUT /tickets/{id}` payload that updates one or more
// of our 4 custom fields. Filters out unknown keys and fields whose ID we
// couldn't discover. Returns the `custom_fields` array Zendesk expects.
export function buildCustomFieldsPatch(patch, fieldMeta) {
  const out = [];
  for (const [feKey, value] of Object.entries(patch || {})) {
    if (!ZD_CUSTOM_FIELD_KEYS.includes(feKey)) continue;
    const meta = fieldMeta?.[feKey];
    if (!meta?.id) continue;
    out.push({ id: meta.id, value: value ?? null });
  }
  return out;
}

// Test helper — clears the in-process cache. Used by Phase 2's PUT handler
// after a successful write so subsequent reads see fresh metadata if an
// admin changed the field's options between writes.
export function _bustTicketFieldsCache() {
  _cache = { value: null, ts: 0, inflight: null };
}
