// ── queueV2Utils ─────────────────────────────────────────────────────────────
// Shared pure helpers for QueueV2. No React, no DOM side effects outside
// exportCsv/shareLink which are called from event handlers.
import { SLA_MINS } from '../../data/constants';

// ── Unified SLA computation ──────────────────────────────────────────────────
// Returns { severity, label, rank, reason }.
// severity: 'ok' | 'at_risk' | 'breached' | 'none'
// rank: lower = more urgent (used for sort)
// reason: human-readable explanation for the "why this priority?" tooltip
export function computeSla(row) {
  // Workbench — API-provided breach status
  if (row.slaBreachStatus) {
    if (row.slaBreachStatus === 'SLA_BREACHED') {
      return { severity: 'breached', label: fmtDuration(row.slaRemaining || 0, true), rank: -1e9, reason: 'Workbench SLA breached (upstream).' };
    }
    if (row.slaBreachStatus === 'SLA_NOT_BREACHED' && row.slaRemaining != null) {
      const sev = row.slaRemaining < 3600 * 24 ? 'at_risk' : 'ok';
      const reason = sev === 'at_risk'
        ? `Workbench SLA: ${fmtDuration(row.slaRemaining, false)} remaining (< 24h).`
        : `Workbench SLA: ${fmtDuration(row.slaRemaining, false)} remaining.`;
      return { severity: sev, label: fmtDuration(row.slaRemaining, false), rank: -row.slaRemaining, reason };
    }
    return { severity: 'none', label: '--', rank: 1e9, reason: 'No SLA set.' };
  }

  // Paused onboarding — 48h countdown from pausedAt
  if (row.isPaused && row.pausedAt) {
    const pausedMs = new Date(row.pausedAt).getTime();
    if (!isNaN(pausedMs)) {
      const remaining = 48 * 3600 * 1000 - (Date.now() - pausedMs);
      if (remaining <= 0) {
        const overHrs = Math.floor(Math.abs(remaining) / 3600000);
        const overLabel = overHrs >= 24 ? `${Math.floor(overHrs / 24)}d over` : `${overHrs}h over`;
        return { severity: 'breached', label: overLabel, rank: remaining, reason: `Paused ${overLabel} — 48h follow-up limit exceeded.` };
      }
      const severity = remaining < 6 * 3600 * 1000 ? 'breached' : remaining < 24 * 3600 * 1000 ? 'at_risk' : 'ok';
      const sevReason = severity === 'breached' ? 'Under 6h to 48h follow-up limit.'
                       : severity === 'at_risk' ? 'Under 24h to 48h follow-up limit.'
                       : 'On track: <48h from pause start.';
      return { severity, label: fmtMs(remaining), rank: remaining, reason: sevReason };
    }
  }

  // ZD/Jira — type-specific thresholds
  if (row.source === 'zendesk' || row.source === 'jira') {
    const raw = row._raw;
    if (!raw || raw.status === 'resolved' || raw.status === 'waiting') {
      return { severity: 'none', label: '--', rank: 1e9, reason: raw?.status === 'waiting' ? 'Paused — SLA clock stopped.' : 'Resolved.' };
    }
    const lim = SLA_MINS[raw.type] || 1440;
    const used = raw.minutesSinceLastResponse ?? raw.minutesAgo ?? 0;
    const rem = lim - used;
    const limLabel = fmtMinutes(lim);
    if (rem <= 0) return { severity: 'breached', label: `${Math.floor(-rem / 60)}h over`, rank: rem, reason: `${raw.type} SLA (${limLabel}) breached.` };
    const pct = rem / lim;
    const severity = pct <= 0.25 ? 'breached' : pct <= 0.5 ? 'at_risk' : 'ok';
    const sevReason = severity === 'breached' ? `< 25% of ${raw.type} SLA (${limLabel}) left.`
                     : severity === 'at_risk' ? `< 50% of ${raw.type} SLA (${limLabel}) left.`
                     : `${Math.round(pct * 100)}% of ${raw.type} SLA (${limLabel}) remaining.`;
    return { severity, label: fmtMinutes(rem), rank: rem, reason: sevReason };
  }

  // Offboarding — type-aware (14d term / 5d resig) + end-date proximity
  if (row.source === 'offboarding') {
    const threshold = (row.typeLabel || '').startsWith('Resignation') ? 5 : 14;
    const ageMs = row.createdAt ? Date.now() - new Date(row.createdAt).getTime() : 0;
    if (isNaN(ageMs) || ageMs < 0) return { severity: 'none', label: '--', rank: 1e9, reason: 'No created date.' };
    const days = ageMs / 86400000;
    const endDateMs = row.endDate ? new Date(row.endDate).getTime() : NaN;
    const endDays = Number.isFinite(endDateMs) ? (endDateMs - Date.now()) / 86400000 : null;

    if (days >= threshold) {
      const reason = `Offboarding ${row.typeLabel || ''} open ${Math.floor(days)}d (SLA ${threshold}d)${endDays != null && endDays <= 3 ? ' + end date imminent' : ''}.`;
      return { severity: 'breached', label: `${Math.floor(days)}d`, rank: threshold - days, reason };
    }
    if (endDays != null && endDays <= 3 && endDays >= 0) {
      return { severity: 'breached', label: `end in ${Math.floor(endDays)}d`, rank: endDays - 999, reason: `End date in ${Math.floor(endDays)} days — urgent.` };
    }
    if (days >= threshold * 0.7) {
      return { severity: 'at_risk', label: `${Math.floor(days)}d`, rank: threshold - days, reason: `${Math.floor(days)}d open (70% of ${threshold}d SLA used).` };
    }
    return { severity: 'ok', label: `${Math.floor(days)}d`, rank: threshold - days, reason: `${Math.floor(days)}d open (${threshold}d SLA).` };
  }

  // Generic age-based (onboarding, amendments, redlines)
  const ageMs = row.createdAt ? Date.now() - new Date(row.createdAt).getTime() : 0;
  if (isNaN(ageMs) || ageMs < 0) return { severity: 'none', label: '--', rank: 1e9, reason: 'No created date.' };
  const days = ageMs / 86400000;
  if (days >= 7) return { severity: 'breached', label: `${Math.floor(days)}d`, rank: 7 - days, reason: `Open ${Math.floor(days)} days — over 7-day threshold.` };
  if (days >= 3) return { severity: 'at_risk', label: `${Math.floor(days)}d`, rank: 7 - days, reason: `Open ${Math.floor(days)} days — past 3-day check-in.` };
  const hrs = ageMs / 3600000;
  return { severity: 'ok', label: days >= 1 ? `${Math.floor(days)}d` : `${Math.floor(hrs)}h`, rank: 7 - days, reason: days >= 1 ? `${Math.floor(days)}d open.` : `${Math.floor(hrs)}h old.` };
}

function fmtDuration(seconds, isOver) {
  const s = Math.abs(seconds);
  const hrs = Math.floor(s / 3600);
  if (hrs >= 24) return `${Math.floor(hrs / 24)}d${isOver ? ' over' : ''}`;
  if (hrs > 0) return `${hrs}h${isOver ? ' over' : ''}`;
  return `${Math.floor(s / 60)}m${isOver ? ' over' : ''}`;
}
function fmtMs(ms) {
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hrs >= 24) return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}
function fmtMinutes(m) {
  if (m >= 1440) return `${Math.floor(m / 1440)}d`;
  if (m >= 60) return `${Math.floor(m / 60)}h`;
  return `${m}m`;
}

// ── Deterministic "quick action" per row ────────────────────────────────────
// Returns { id, label, icon } where id is one of:
//   'assign' | 'escalate' | 'nudge' | 'start' | 'confirm_end_date' | 'open'
export function quickAction(row, currentUser) {
  if (!row.assignee && currentUser?.name) {
    return { id: 'assign', label: 'Assign me', icon: 'bi-person-plus' };
  }
  if (row.sla?.severity === 'breached') {
    return { id: 'escalate', label: 'Escalate', icon: 'bi-arrow-up-circle' };
  }
  if (row.isPaused) {
    return { id: 'nudge', label: 'Nudge', icon: 'bi-bell' };
  }
  if (row.source === 'offboarding' && row.endDate) {
    const endDays = (new Date(row.endDate).getTime() - Date.now()) / 86400000;
    if (Number.isFinite(endDays) && endDays <= 3 && endDays >= 0 && row.endDateIsConfirmed === false) {
      return { id: 'confirm_end_date', label: 'Confirm date', icon: 'bi-calendar-check' };
    }
  }
  const rawStatus = row._raw?.status;
  if (rawStatus === 'new') {
    return { id: 'start', label: 'Start', icon: 'bi-play-circle' };
  }
  return { id: 'open', label: 'Open', icon: 'bi-box-arrow-up-right' };
}

// ── SLA forecast ─────────────────────────────────────────────────────────────
// Based only on current remaining time vs thresholds — no velocity model yet.
// Returns { breachingIn3h, breachingIn24h }.
export function slaForecast(rows) {
  const now = Date.now();
  let in3h = 0, in24h = 0;
  for (const r of rows) {
    const sev = r.sla?.severity;
    if (sev === 'breached' || sev === 'none') continue;
    // Workbench (seconds-based)
    if (r.slaBreachStatus === 'SLA_NOT_BREACHED' && r.slaRemaining != null) {
      if (r.slaRemaining <= 3 * 3600) in3h++;
      else if (r.slaRemaining <= 24 * 3600) in24h++;
      continue;
    }
    // Paused onboarding (48h countdown)
    if (r.isPaused && r.pausedAt) {
      const pausedMs = new Date(r.pausedAt).getTime();
      if (!isNaN(pausedMs)) {
        const rem = 48 * 3600000 - (now - pausedMs);
        if (rem > 0 && rem <= 3 * 3600000) in3h++;
        else if (rem > 0 && rem <= 24 * 3600000) in24h++;
        continue;
      }
    }
    // ZD/Jira (minute-based via SLA_MINS)
    if ((r.source === 'zendesk' || r.source === 'jira') && r._raw?.type) {
      const lim = SLA_MINS[r._raw.type] || 1440;
      const used = r._raw.minutesSinceLastResponse ?? r._raw.minutesAgo ?? 0;
      const rem = lim - used;
      if (rem > 0 && rem <= 180) in3h++;
      else if (rem > 0 && rem <= 1440) in24h++;
      continue;
    }
    // Offboarding & generic (day-based) — only classify as near-breach if
    // we're close to the threshold.
    const createdMs = r.createdAt ? new Date(r.createdAt).getTime() : NaN;
    if (!Number.isFinite(createdMs)) continue;
    const days = (now - createdMs) / 86400000;
    const threshold = r.source === 'offboarding'
      ? ((r.typeLabel || '').startsWith('Resignation') ? 5 : 14)
      : 7;
    const daysToBreach = threshold - days;
    if (daysToBreach > 0 && daysToBreach <= 0.125) in3h++;       // ~3h
    else if (daysToBreach > 0 && daysToBreach <= 1) in24h++;
  }
  return { breachingIn3h: in3h, breachingIn24h: in24h };
}

// ── CSV export ───────────────────────────────────────────────────────────────
export function exportCsv(rows, filename = 'queue.csv') {
  const headers = ['Source', 'Subject', 'Country', 'Assignee', 'Created', 'Status', 'SLA', 'URL'];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      r.source,
      esc(r.subject),
      esc(r.country),
      esc(r.assignee),
      r.createdAt || '',
      esc(r.status?.label),
      esc(r.sla?.label),
      esc(r.openUrl),
    ].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── URL ↔ filter state ───────────────────────────────────────────────────────
export function filtersToQuery(f) {
  const p = new URLSearchParams();
  if (f.group && f.group !== 'all') p.set('g', f.group);
  if (f.subSource) p.set('s', f.subSource);
  if (f.fStatus) p.set('st', f.fStatus);
  if (f.fCountry?.length) p.set('c', f.fCountry.join(','));
  if (f.fSla) p.set('sla', f.fSla);
  if (f.sort && f.sort !== 'sla') p.set('o', f.sort);
  if (f.search) p.set('q', f.search);
  if (f.focus) p.set('focus', '1');
  if (f.density && f.density !== 'comfortable') p.set('d', f.density);
  if (f.bundle) p.set('b', '1');
  return p.toString();
}
export function queryToFilters(searchStr) {
  const p = new URLSearchParams(searchStr);
  const out = {};
  if (p.get('g')) out.group = p.get('g');
  if (p.get('s')) out.subSource = p.get('s');
  if (p.get('st')) out.fStatus = p.get('st');
  const c = p.get('c'); if (c) out.fCountry = c.split(',').filter(Boolean);
  if (p.get('sla')) out.fSla = p.get('sla');
  if (p.get('o')) out.sort = p.get('o');
  if (p.get('q')) out.search = p.get('q');
  if (p.get('focus') === '1') out.focus = true;
  if (p.get('d')) out.density = p.get('d');
  if (p.get('b') === '1') out.bundle = true;
  return out;
}

// ── Bundle rows by shared employee ───────────────────────────────────────────
// Groups rows whose `subject` matches (primary key for an employee in this UI)
// and whose group is 'tasks' (tickets stay flat). Returns an ordered list of
// { type: 'row', row } | { type: 'bundle', key, rows }.
export function bundleRows(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = (r.subject || '').toLowerCase().trim();
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  const out = [];
  const consumed = new Set();
  for (const r of rows) {
    if (consumed.has(r)) continue;
    const key = (r.subject || '').toLowerCase().trim();
    const group = map.get(key) || [];
    if (group.length >= 2) {
      if (!consumed.has(group[0])) {
        for (const g of group) consumed.add(g);
        out.push({ type: 'bundle', key: r.subject, rows: group });
      }
    } else {
      consumed.add(r);
      out.push({ type: 'row', row: r });
    }
  }
  return out;
}

// ── Rules engine ─────────────────────────────────────────────────────────────
// Rules live in localStorage ('ops_hub_queuev2_rules'). Shape:
//   { id, name, if: { country?, source?, statusSeverity?, isUnassigned? }, then: { assigneeEmail?, snooze? } }
// Application is non-destructive: rules annotate a row with `appliedRule`.
export function loadRules() {
  try {
    const raw = localStorage.getItem('ops_hub_queuev2_rules');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
export function saveRules(rules) {
  try { localStorage.setItem('ops_hub_queuev2_rules', JSON.stringify(rules)); } catch {}
}
export function applyRules(rows, rules) {
  if (!rules?.length) return rows;
  return rows.map(r => {
    for (const rule of rules) {
      const cond = rule.if || {};
      if (cond.country && (r.country || '').toUpperCase() !== cond.country.toUpperCase()) continue;
      if (cond.source && r.source !== cond.source) continue;
      if (cond.statusSeverity && r.status?.severity !== cond.statusSeverity) continue;
      if (cond.isUnassigned != null && (!!r.assignee === cond.isUnassigned)) continue;
      // Match — attach rule hint
      return { ...r, appliedRule: { id: rule.id, name: rule.name, then: rule.then } };
    }
    return r;
  });
}

// ── Working-hours dim ────────────────────────────────────────────────────────
// Returns true if "now" is outside the agent's configured hours.
// Simple heuristic: Mon–Fri 9–18 in browser-local time unless overridden.
export function isOutsideWorkingHours(overrides) {
  const cfg = overrides || { days: [1, 2, 3, 4, 5], start: 9, end: 18 };
  const now = new Date();
  const day = now.getDay();
  const hr = now.getHours();
  if (!cfg.days.includes(day)) return true;
  return hr < cfg.start || hr >= cfg.end;
}

// ── Row summary (deterministic, "AI-style") ──────────────────────────────────
// Short one-liner that explains what this row needs next. Not an LLM call —
// a careful heuristic that uses SLA + source + status to produce something
// that *feels* like a summary.
export function rowSummary(row) {
  const bits = [];
  const sev = row.sla?.severity;
  if (sev === 'breached') bits.push('⚠ SLA breached');
  else if (sev === 'at_risk') bits.push('~ at-risk');
  if (row.source === 'offboarding') {
    const type = row.typeLabel || 'Offboarding';
    bits.push(`${type}${row.endDate ? ' · ends ' + fmtShortDate(row.endDate) : ''}`);
    if (row.endDateIsConfirmed === false) bits.push('end date unconfirmed');
    if (row.reason) bits.push(row.reason);
  } else if (row.source === 'onboarding') {
    if (row.isPaused) {
      bits.push(`Paused · ${row.pauseType || 'manual'}`);
    } else if (row.startDate) {
      const sd = new Date(row.startDate);
      const daysToStart = isFinite(sd) ? Math.ceil((sd.getTime() - Date.now()) / 86400000) : null;
      if (daysToStart != null && daysToStart >= 0 && daysToStart <= 14) bits.push(`starts in ${daysToStart}d`);
      else if (daysToStart != null && daysToStart < 0) bits.push(`started ${Math.abs(daysToStart)}d ago`);
    }
    const flow = (row.function || '').replace(/·/g, '·');
    if (flow) bits.push(flow);
  } else if (row.source === 'amendments') {
    bits.push('Amendment pending');
    if (row.function) bits.push(row.function);
  } else if (row.source === 'redlines') {
    bits.push('Redline in review');
    if (row.function) bits.push(row.function);
  } else if (row.source === 'workbench') {
    bits.push(row.function || 'Workbench task');
  } else if (row.source === 'zendesk' || row.source === 'jira') {
    const raw = row._raw || {};
    if (raw.type) bits.push(raw.type);
    if (raw.status === 'waiting') bits.push('paused — awaiting reply');
    else if (raw.status === 'new') bits.push('untouched');
    else if (raw.status === 'escalated') bits.push('escalated');
  }
  if (!row.assignee) bits.push('unassigned');
  return bits.join(' · ');
}
function fmtShortDate(d) {
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Templates (ZD/Jira canned replies) ───────────────────────────────────────
export const DEFAULT_TEMPLATES = [
  { id: 'docs',       trigger: 'docs',       title: 'Request missing documents',
    body: 'Hi {name},\n\nThanks for reaching out. To move forward we need the following documents: [list].\n\nCould you upload them when you get a moment?\n\nBest,\n{agent}' },
  { id: 'eor-nudge',  trigger: 'eor-nudge',  title: 'EOR nudge — client sign',
    body: 'Hi {client},\n\nJust a quick nudge — we\'re waiting on your countersignature for {name}\'s contract. Once you sign, we kick off the rest of onboarding.\n\nThanks,\n{agent}' },
  { id: 'extension',  trigger: 'extension',  title: 'Contract extension draft',
    body: 'Hi {name},\n\nWe\'ve drafted the extension to your contract per the agreed terms. Please review and sign when you have a moment.\n\nLet us know if anything looks off.\n\nBest,\n{agent}' },
  { id: 'offb-confirm', trigger: 'offb-confirm', title: 'Confirm offboarding end date',
    body: 'Hi {name},\n\nCould you confirm your last working day so we can finalise the offboarding checklist?\n\nThanks,\n{agent}' },
  { id: 'holding',    trigger: 'holding',    title: 'Holding — we are looking into it',
    body: 'Hi {name},\n\nThanks for raising this — we\'re looking into it and will come back with a clear answer shortly.\n\nBest,\n{agent}' },
];
export function loadTemplates() {
  try {
    const raw = localStorage.getItem('ops_hub_queuev2_templates');
    const custom = raw ? JSON.parse(raw) : [];
    return [...DEFAULT_TEMPLATES, ...(Array.isArray(custom) ? custom : [])];
  } catch { return DEFAULT_TEMPLATES; }
}
export function renderTemplate(template, row, currentUser) {
  if (!template) return '';
  const name = (row?.assignee && row?._raw?.requesterName) ? row._raw.requesterName : (row?.subject || 'there');
  const agent = currentUser?.name || '';
  const client = row?.clientName || 'team';
  return (template.body || '')
    .replace(/\{name\}/g, name)
    .replace(/\{agent\}/g, agent)
    .replace(/\{client\}/g, client);
}

// ── OOO (out of office) state — localStorage per-user ────────────────────────
export function getOooState(email) {
  if (!email) return { ooo: false };
  try {
    const raw = localStorage.getItem(`ops_hub_queuev2_ooo_${email.toLowerCase()}`);
    return raw ? JSON.parse(raw) : { ooo: false };
  } catch { return { ooo: false }; }
}
export function setOooState(email, state) {
  if (!email) return;
  try { localStorage.setItem(`ops_hub_queuev2_ooo_${email.toLowerCase()}`, JSON.stringify(state)); } catch {}
}

// ── Presence — BroadcastChannel wrapper ──────────────────────────────────────
// Lets multiple tabs of the same user (and, if same origin, multiple agents
// on the same machine) see each other's "open row" state. Degrades gracefully
// when BroadcastChannel is not available.
export function createPresenceChannel(userId, name) {
  if (typeof BroadcastChannel === 'undefined') {
    return { broadcast: () => {}, subscribe: () => () => {}, close: () => {} };
  }
  const ch = new BroadcastChannel('ops_hub_queuev2_presence');
  const listeners = new Set();
  ch.onmessage = (e) => { for (const l of listeners) l(e.data); };
  return {
    broadcast(rowId) {
      try { ch.postMessage({ userId, name, rowId, ts: Date.now() }); } catch {}
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close() { listeners.clear(); try { ch.close(); } catch {} },
  };
}

// ── New-row detection ───────────────────────────────────────────────────────
// Given current IDs and a ref of previously-seen IDs, returns the set of IDs
// that were never seen before. Call this on every render, then use .clear()
// after the flash animation expires.
//
// Edge case: on first mount, data may arrive in the second render after an
// initial empty snapshot. We therefore DEFER initialisation until we see a
// non-empty set — otherwise every row flashes NEW once.
export function diffNewIds(currentIds, seenRef) {
  const now = Date.now();
  if (!seenRef.initialised) {
    if (currentIds.length === 0) return new Set();
    seenRef.seen = new Set(currentIds);
    seenRef.firstSeenAt = new Map(currentIds.map(id => [id, 0]));
    seenRef.initialised = true;
    return new Set();
  }
  for (const id of currentIds) {
    if (!seenRef.seen.has(id)) {
      seenRef.seen.add(id);
      seenRef.firstSeenAt.set(id, now);
    }
  }
  const freshlyNew = new Set();
  for (const [id, ts] of seenRef.firstSeenAt.entries()) {
    if (ts > 0 && now - ts < 15000) freshlyNew.add(id);
  }
  return freshlyNew;
}
