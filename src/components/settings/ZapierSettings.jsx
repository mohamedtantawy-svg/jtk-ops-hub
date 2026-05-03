import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TOOLS } from '../../data/constants';

// ── Extended source types for Zapier ─────────────────────────────────────────
const ZAPIER_SOURCES = { ...TOOLS };

// Helper to read nested field like "priority.name" — hoisted for use in all components
function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

// ── Mappable task fields ─────────────────────────────────────────────────────
const BUILT_IN_FIELDS = [
  { key: 'subject',       label: 'Subject',        required: true,  group: 'core' },
  { key: 'description',   label: 'Description',    required: false, group: 'core' },
  { key: 'priority',      label: 'Priority',       required: false, group: 'core', options: ['low','medium','high','critical'] },
  { key: 'country',       label: 'Country',        required: false, group: 'core' },
  { key: 'requesterName', label: 'Requester name',  required: false, group: 'core' },
  { key: 'externalUrl',   label: 'External URL',   required: false, group: 'core' },
  { key: 'tags',          label: 'Tags',           required: false, group: 'core' },
  { key: 'assigneeId',    label: 'Assignee ID',    required: false, group: 'core' },
  { key: 'type',          label: 'Function / type', required: false, group: 'core' },
  { key: 'status',        label: 'Status',         required: false, group: 'core', options: ['new','in_progress','waiting'] },
  { key: 'reason',        label: 'Escalation reason', required: false, group: 'escalation' },
  { key: 'managerId',     label: 'Manager ID',     required: false, group: 'escalation' },
  { key: 'channel',       label: 'Comms channel',  required: false, group: 'comms' },
  { key: 'commsType',     label: 'Comms type',     required: false, group: 'comms', options: ['alert','announce','update','guidance','kudos'] },
  { key: 'projectName',   label: 'Project name',   required: false, group: 'project' },
  { key: 'milestone',     label: 'Milestone',      required: false, group: 'project' },
  { key: 'reportType',    label: 'Report type',    required: false, group: 'reporting' },
  { key: 'reportData',    label: 'Report data',    required: false, group: 'reporting' },
];

// Custom fields stored in localStorage
const CUSTOM_FIELDS_KEY = 'ops_hub_custom_fields';
const loadCustomFields = () => { try { const r = localStorage.getItem(CUSTOM_FIELDS_KEY); return r ? JSON.parse(r) : []; } catch { return []; } };
const saveCustomFields = (list) => { try { localStorage.setItem(CUSTOM_FIELDS_KEY, JSON.stringify(list)); } catch {} };

// Destination types for routing
const DESTINATIONS = [
  { id: 'queue',       label: 'Queue',        icon: 'bi-inbox-fill',           color: '#1f74b3', bg: '#e8f0fe', desc: 'Task appears in the main task queue for agents to handle' },
  { id: 'escalations', label: 'Escalations',  icon: 'bi-arrow-up-circle-fill', color: '#ed8d00', bg: '#fff8e6', desc: 'Creates an escalation entry for manager review' },
  { id: 'comms',       label: 'Communications', icon: 'bi-megaphone-fill',     color: '#6b3fa0', bg: '#f3eff8', desc: 'Posts as a team communication or announcement' },
  { id: 'projects',    label: 'Projects',     icon: 'bi-kanban-fill',          color: '#29811e', bg: '#e8f5e9', desc: 'Creates or updates a project entry' },
  { id: 'reports',     label: 'HR Reports',   icon: 'bi-file-earmark-bar-graph-fill', color: '#1565c0', bg: '#e3f2fd', desc: 'Feeds data into the reporting dashboard' },
];

// ── Default field mappings per source ────────────────────────────────────────
const DEFAULT_MAPPINGS = {
  zendesk:    [{ sourceField: 'title', targetField: 'subject' }, { sourceField: 'description', targetField: 'description' }, { sourceField: 'priority', targetField: 'priority' }, { sourceField: 'requester_name', targetField: 'requesterName' }, { sourceField: 'url', targetField: 'externalUrl' }, { sourceField: 'tags', targetField: 'tags' }],
  jira:       [{ sourceField: 'summary', targetField: 'subject' }, { sourceField: 'description', targetField: 'description' }, { sourceField: 'priority.name', targetField: 'priority' }, { sourceField: 'reporter.displayName', targetField: 'requesterName' }, { sourceField: 'self', targetField: 'externalUrl' }, { sourceField: 'labels', targetField: 'tags' }],
  gmail:      [{ sourceField: 'subject', targetField: 'subject' }, { sourceField: 'snippet', targetField: 'description' }, { sourceField: 'from', targetField: 'requesterName' }, { sourceField: 'link', targetField: 'externalUrl' }],
  slack:      [{ sourceField: 'text', targetField: 'subject' }, { sourceField: 'text', targetField: 'description' }, { sourceField: 'user_name', targetField: 'requesterName' }, { sourceField: 'permalink', targetField: 'externalUrl' }],
  looker:     [{ sourceField: 'title', targetField: 'subject' }, { sourceField: 'message', targetField: 'description' }, { sourceField: 'dashboard_url', targetField: 'externalUrl' }],
  bamboohr:   [{ sourceField: 'employee_name', targetField: 'subject' }, { sourceField: 'request_type', targetField: 'type' }, { sourceField: 'notes', targetField: 'description' }],
  greenhouse: [{ sourceField: 'candidate_name', targetField: 'subject' }, { sourceField: 'job_name', targetField: 'description' }, { sourceField: 'url', targetField: 'externalUrl' }],
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const genId = () => 'zap_' + Math.random().toString(36).slice(2, 10);
const genSecret = () => 'whsec_' + Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(16).padStart(2, '0')).join('');
const STORAGE_KEY = 'ops_hub_zapier_integrations';

const load = () => { try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : []; } catch { return []; } };
const save = (list) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {} };

const relativeTime = (iso) => {
  if (!iso) return 'Never';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

// Mock payloads for test webhook — function so each test gets fresh unique IDs
const getMockPayload = (sourceType) => {
  const rnd = Math.floor(Math.random() * 9000 + 1000);
  const ts = Date.now();
  const payloads = {
    zendesk:    { id: 'ZD-' + rnd, title: 'Employee cannot access benefits portal', description: 'User reports 403 error when navigating to benefits page', priority: 'high', requester_name: 'Sarah Chen', tags: ['access', 'benefits'], url: 'https://deel.zendesk.com/agent/tickets/' + rnd },
    jira:       { key: 'HR-' + rnd, summary: 'Onboarding checklist incomplete for new hire', description: 'Missing IT equipment and badge access', priority: { name: 'Medium' }, reporter: { displayName: 'James Okafor' }, labels: ['onboarding'], self: 'https://deel.atlassian.net/browse/HR-' + rnd },
    gmail:      { id: 'msg-' + ts, subject: 'Urgent: Payroll discrepancy for March', snippet: 'Hi team, I noticed my March payslip shows incorrect overtime...', from: 'employee@company.com', link: 'https://mail.google.com/mail/u/0/#inbox/' + rnd },
    slack:      { ts: String(ts / 1000), text: 'Need help with visa documentation update for DE transfer', user_name: 'priya.nair', permalink: 'https://deel.slack.com/archives/C123/p' + ts },
    looker:     { id: 'alert-' + ts, title: 'Leave balance anomaly detected — 9 employees negative', message: 'Automated alert from leave tracking dashboard', dashboard_url: 'https://deel.looker.com/dashboards/42' },
    bamboohr:   { id: 'bhr-' + ts, employee_name: 'New time-off request from Tom Richards', request_type: 'Leave Request', notes: 'Annual leave 5 days starting April 14' },
    greenhouse: { id: 'gh-' + ts, candidate_name: 'Interview scheduled: Maria Lopez — Senior Ops Analyst', job_name: 'Senior Ops Analyst — EMEA', url: 'https://app.greenhouse.io/people/' + rnd },
    notion:     { id: 'not-' + ts, title: 'Policy update: Remote work guidelines v2.1', body: 'Updated remote work policy requires team acknowledgement', url: 'https://notion.so/deel/remote-work-policy' },
    custom:     { id: 'custom-' + ts, title: 'Custom integration test event', description: 'This is a test event from your custom source', priority: 'low' },
  };
  return payloads[sourceType] || payloads.custom;
};

// ── Main Component ──────────────────────────────────────────────────────────
const ZapierSettings = ({ addToast, tasks, setTasks }) => {
  const [integrations, setIntegrations] = useState(load);
  const [selectedId, setSelectedId] = useState(null);
  const [activeTab, setActiveTab] = useState('general');
  const [copied, setCopied] = useState(null);
  const [showSecret, setShowSecret] = useState({});
  const [testRunning, setTestRunning] = useState(false);
  const testTimeoutRef = useRef(null);

  // Cleanup timeout on unmount
  useEffect(() => () => { if (testTimeoutRef.current) clearTimeout(testTimeoutRef.current); }, []);

  const persist = useCallback((list) => { setIntegrations(list); save(list); }, []);

  const selected = useMemo(() => integrations.find(i => i.id === selectedId), [integrations, selectedId]);

  const updateSelected = useCallback((updates) => {
    persist(integrations.map(i => i.id === selectedId ? { ...i, ...updates } : i));
  }, [integrations, selectedId, persist]);

  // ── Add new integration ────────────────────────────────────────────────
  const addIntegration = (sourceType = 'zendesk') => {
    const src = ZAPIER_SOURCES[sourceType] || ZAPIER_SOURCES.custom;
    const id = genId();
    const newInt = {
      id,
      name: `${src.label} Integration`,
      sourceType,
      webhookSecret: genSecret(),
      status: 'active',
      lastEventAt: null,
      eventCount: 0,
      createdAt: new Date().toISOString(),
      destination: 'queue',
      externalIdField: sourceType === 'zendesk' ? 'id' : sourceType === 'jira' ? 'key' : sourceType === 'gmail' ? 'id' : 'id',
      fieldMappings: (DEFAULT_MAPPINGS[sourceType] || [{ sourceField: 'title', targetField: 'subject' }])
        .map(m => ({ ...m, id: genId(), defaultValue: '', valueMap: null })),
      filters: [],
      queueTab: 'inbound',
      subFilter: null,
      columnOverrides: null,
      activityLog: [],
    };
    persist([...integrations, newInt]);
    setSelectedId(id);
    setActiveTab('general');
  };

  // ── Delete integration ─────────────────────────────────────────────────
  const deleteIntegration = (id) => {
    persist(integrations.filter(i => i.id !== id));
    if (selectedId === id) { setSelectedId(null); setActiveTab('general'); }
  };

  // ── Duplicate integration ──────────────────────────────────────────────
  const duplicateIntegration = (int) => {
    const id = genId();
    const dup = {
      ...int, id, name: int.name + ' (copy)', webhookSecret: genSecret(),
      eventCount: 0, lastEventAt: null, activityLog: [], createdAt: new Date().toISOString(),
      fieldMappings: int.fieldMappings?.map(m => ({ ...m, id: genId(), valueMap: m.valueMap ? { ...m.valueMap } : null })) || [],
      filters: int.filters?.map(f => ({ ...f })) || [],
      columnOverrides: int.columnOverrides ? { ...int.columnOverrides } : null,
    };
    persist([...integrations, dup]);
    setSelectedId(id);
  };

  // ── Copy to clipboard ─────────────────────────────────────────────────
  const copyText = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  // ── Test webhook ──────────────────────────────────────────────────────
  const runTestWebhook = (int) => {
    setTestRunning(true);
    if (testTimeoutRef.current) clearTimeout(testTimeoutRef.current);
    testTimeoutRef.current = setTimeout(() => {
      const payload = getMockPayload(int.sourceType);
      // Apply field mappings
      const mapped = {};
      let hasSubject = false;
      int.fieldMappings.forEach(m => {
        if (!m.targetField) return;
        const val = m.sourceField ? getNestedValue(payload, m.sourceField) : m.defaultValue;
        if (val !== undefined && val !== null && val !== '') {
          mapped[m.targetField] = val;
          if (m.targetField === 'subject') hasSubject = true;
        } else if (m.defaultValue) {
          mapped[m.targetField] = m.defaultValue;
          if (m.targetField === 'subject') hasSubject = true;
        }
      });

      const logEntry = {
        id: 'evt_' + Date.now(),
        timestamp: new Date().toISOString(),
        payload,
      };

      // Check conditional filters
      const filters = int.filters || [];
      if (filters.length > 0) {
        const failed = filters.find(f => {
          const val = String(getNestedValue(payload, f.field) ?? '');
          switch (f.operator) {
            case 'equals': return val.toLowerCase() !== String(f.value).toLowerCase();
            case 'not_equals': return val.toLowerCase() === String(f.value).toLowerCase();
            case 'contains': return !val.toLowerCase().includes(String(f.value).toLowerCase());
            case 'not_contains': return val.toLowerCase().includes(String(f.value).toLowerCase());
            case 'exists': return !val;
            case 'not_exists': return !!val;
            default: return false;
          }
        });
        if (failed) {
          logEntry.status = 'skipped-filter';
          logEntry.summary = `Filtered out: "${failed.field}" ${failed.operator.replace('_', ' ')} "${failed.value || ''}" did not match`;
          updateSelected({ activityLog: [logEntry, ...(int.activityLog || []).slice(0, 49)] });
          if (addToast) addToast('info', 'Event Filtered', `Skipped — filter on "${failed.field}" did not match`);
          setTestRunning(false);
          return;
        }
      }

      // Apply value transforms (case-insensitive key lookup)
      int.fieldMappings.forEach(m => {
        if (m.valueMap && mapped[m.targetField] !== undefined) {
          const raw = String(mapped[m.targetField]);
          // Try exact match first, then case-insensitive
          let transformed = m.valueMap[raw];
          if (!transformed) {
            const rawLower = raw.toLowerCase();
            const matchKey = Object.keys(m.valueMap).find(k => k.toLowerCase() === rawLower);
            if (matchKey) transformed = m.valueMap[matchKey];
          }
          if (transformed) mapped[m.targetField] = transformed;
        }
      });

      if (!hasSubject || !mapped.subject) {
        logEntry.status = 'failed';
        logEntry.summary = 'Missing required field: subject. Check your field mappings.';
        updateSelected({
          activityLog: [logEntry, ...(int.activityLog || []).slice(0, 49)],
        });
        if (addToast) addToast('error', 'Test Failed', 'No subject field mapped');
      } else {
        const externalId = (int.externalIdField ? getNestedValue(payload, int.externalIdField) : null) || payload.id || payload.key || payload.ts || ('test-' + Date.now());
        const dest = int.destination || 'queue';
        const destLabel = DESTINATIONS.find(d => d.id === dest)?.label || 'Queue';

        // For queue destination, create a real task in state
        if (dest === 'queue') {
          const newTask = {
            id: externalId,
            source: int.sourceType,
            subject: String(mapped.subject).substring(0, 255),
            body: mapped.description || '',
            assigneeId: mapped.assigneeId ? Number(mapped.assigneeId) : null,
            country: mapped.country || '',
            receivedAt: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            minutesAgo: 0,
            updatedMinsAgo: 0,
            status: int.subFilter || 'new',
            type: mapped.type || 'Access Issue',
            isAlert: false,
            priority: (int.defaultPriority && int.defaultPriority !== 'from_source')
              ? int.defaultPriority
              : (mapped.priority?.toLowerCase?.() || mapped.priority || 'medium'),
            requesterName: mapped.requesterName || 'Zapier Test',
            linkedTickets: [],
            externalUrl: mapped.externalUrl || '',
            aiSummary: 'Test task created via Zapier webhook test',
            suggestedReply: '',
          };
          if (setTasks) setTasks(prev => [newTask, ...prev]);
        }

        logEntry.status = 'success';
        logEntry.summary = `${dest === 'queue' ? 'Task' : destLabel + ' entry'} ${externalId} created — "${String(mapped.subject).substring(0, 80)}"`;
        logEntry.destination = dest;
        updateSelected({
          activityLog: [logEntry, ...(int.activityLog || []).slice(0, 49)],
          eventCount: (int.eventCount || 0) + 1,
          lastEventAt: new Date().toISOString(),
        });
        if (addToast) addToast('success', 'Test Successful', `${dest === 'queue' ? 'Task' : destLabel + ' entry'} "${String(mapped.subject).substring(0, 40)}..." routed to ${destLabel}`);
      }
      setTestRunning(false);
    }, 800);
  };

  // ── Add source picker state ────────────────────────────────────────────
  const [showAddPicker, setShowAddPicker] = useState(false);

  // ── Render ────────────────────────────────────────────────────────────
  const webhookBaseUrl = 'https://ops-hub.deel.com/api/v1/webhooks/zapier';

  return (
    <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 500 }}>
      {/* ── Left: Integration List ──────────────────────────────────── */}
      <div style={{ width: 260, borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #e8e8e8' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <i className="bi-lightning-charge-fill" style={{ fontSize: 18, color: '#ed8d00' }}></i>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#1b1b1b' }}>Zapier Integrations</span>
          </div>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowAddPicker(!showAddPicker)} style={{ width: '100%', height: 36, borderRadius: 10, border: '1px dashed #c4c4c4', background: 'var(--surface)', color: '#1f74b3', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all .15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#e8f0fe'; e.currentTarget.style.borderColor = '#1f74b3'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#c4c4c4'; }}>
              <i className="bi-plus-lg" style={{ fontSize: 12 }}></i> Add Integration
            </button>
            {showAddPicker && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--surface)', border: '1px solid #e8e8e8', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 50, maxHeight: 320, overflowY: 'auto', padding: '6px 0' }}>
                {Object.entries(ZAPIER_SOURCES).map(([key, src]) => (
                  <button key={key} onClick={() => { addIntegration(key); setShowAddPicker(false); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#1b1b1b', transition: 'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f7f5f2'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: src.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <i className={src.icon} style={{ color: src.color, fontSize: 12 }}></i>
                    </div>
                    <span style={{ fontWeight: 500 }}>{src.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Integration list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {integrations.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 16px', color: '#9e9e9e' }}>
              <i className="bi-lightning-charge" style={{ fontSize: 28, display: 'block', marginBottom: 8 }}></i>
              <div style={{ fontSize: 13, fontWeight: 500 }}>No integrations yet</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Click "Add Integration" to connect a tool via Zapier</div>
            </div>
          )}
          {integrations.map(int => {
            const src = ZAPIER_SOURCES[int.sourceType] || ZAPIER_SOURCES.custom;
            const isSelected = selectedId === int.id;
            return (
              <button key={int.id} onClick={() => { setSelectedId(int.id); setActiveTab('general'); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', border: 'none', background: isSelected ? '#f7f5f2' : 'transparent', borderRadius: 10, cursor: 'pointer', marginBottom: 2, transition: 'all .12s', textAlign: 'left' }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#fafaf9'; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: src.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <i className={src.icon} style={{ color: src.color, fontSize: 13 }}></i>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{int.name}</div>
                  <div style={{ fontSize: 11, color: '#9e9e9e', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: int.status === 'active' ? '#29811e' : int.status === 'error' ? '#d42d35' : '#ed8d00', flexShrink: 0 }}></span>
                    {int.status === 'active' ? 'Active' : int.status === 'error' ? 'Error' : 'Paused'}
                    {int.eventCount > 0 && <span style={{ color: '#c4c4c4' }}>|</span>}
                    {int.eventCount > 0 && <span>{int.eventCount} events</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right: Detail panel ─────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9e9e9e' }}>
            <div style={{ textAlign: 'center' }}>
              <i className="bi-arrow-left" style={{ fontSize: 24, display: 'block', marginBottom: 8 }}></i>
              <div style={{ fontSize: 14, fontWeight: 500 }}>Select an integration to configure</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Or add a new one to get started</div>
            </div>
          </div>
        ) : (
          <>
            {/* Tab bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '10px 20px 0', borderBottom: '1px solid #e8e8e8', flexShrink: 0 }}>
              {[
                { id: 'general', label: 'General', icon: 'bi-gear' },
                { id: 'mapping', label: 'Field mapping', icon: 'bi-arrow-left-right' },
                { id: 'routing', label: 'Routing', icon: 'bi-signpost-split' },
                { id: 'columns', label: 'Columns', icon: 'bi-layout-three-columns' },
                { id: 'activity', label: 'Activity log', icon: 'bi-list-check' },
              ].map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: '8px 8px 0 0', border: 'none', background: activeTab === tab.id ? '#f3eff8' : 'transparent', color: activeTab === tab.id ? '#6b3fa0' : '#616161', fontSize: 13, fontWeight: activeTab === tab.id ? 600 : 500, cursor: 'pointer', transition: 'all .15s' }}
                  onMouseEnter={e => { if (activeTab !== tab.id) e.currentTarget.style.background = '#f9f8f6'; }}
                  onMouseLeave={e => { if (activeTab !== tab.id) e.currentTarget.style.background = 'transparent'; }}>
                  <i className={tab.icon} style={{ fontSize: 11 }}></i>{tab.label}
                  {tab.id === 'activity' && selected.activityLog?.length > 0 && (
                    <span style={{ background: '#e8e8e8', color: '#616161', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99 }}>{selected.activityLog.length}</span>
                  )}
                </button>
              ))}
              <div style={{ flex: 1 }}></div>
              <div style={{ display: 'flex', gap: 4, paddingBottom: 6 }}>
                <button onClick={() => duplicateIntegration(selected)} title="Duplicate" style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e8e8e8', background: 'var(--surface)', color: '#616161', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}><i className="bi-copy"></i></button>
                <button onClick={() => { if (confirm('Delete this integration? This cannot be undone.')) deleteIntegration(selected.id); }} title="Delete" style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #FCA5A5', background: '#ffe2de', color: '#d42d35', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}><i className="bi-trash3"></i></button>
              </div>
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
              {activeTab === 'general' && <GeneralTab int={selected} update={updateSelected} webhookBaseUrl={`${webhookBaseUrl}/${selected.id}`} copyText={copyText} copied={copied} showSecret={showSecret} setShowSecret={setShowSecret} testRunning={testRunning} runTestWebhook={() => runTestWebhook(selected)} />}
              {activeTab === 'mapping' && <MappingTab int={selected} update={updateSelected} />}
              {activeTab === 'routing' && <RoutingTab int={selected} update={updateSelected} />}
              {activeTab === 'columns' && <ColumnsTab int={selected} update={updateSelected} />}
              {activeTab === 'activity' && <ActivityTab int={selected} update={updateSelected} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// ── General Tab ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
const GeneralTab = ({ int, update, webhookBaseUrl, copyText, copied, showSecret, setShowSecret, testRunning, runTestWebhook }) => {
  const src = ZAPIER_SOURCES[int.sourceType] || ZAPIER_SOURCES.custom;
  return (
    <div>
      {/* Name */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 6 }}>Integration name</label>
        <input value={int.name} onChange={e => update({ name: e.target.value })}
          style={{ width: '100%', height: 38, border: '1px solid #e8e8e8', borderRadius: 10, padding: '0 12px', fontSize: 14, outline: 'none', fontFamily: 'inherit', color: '#1b1b1b', boxSizing: 'border-box' }}
          placeholder="e.g. Zendesk Inbound Tickets" />
      </div>

      {/* Source type */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 6 }}>Source type</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: '1px solid #e8e8e8', borderRadius: 10, background: '#fafaf9' }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: src.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <i className={src.icon} style={{ color: src.color, fontSize: 13 }}></i>
          </div>
          <span style={{ fontSize: 14, fontWeight: 500, color: '#1b1b1b' }}>{src.label}</span>
          <span style={{ fontSize: 12, color: '#9e9e9e', marginLeft: 'auto' }}>Source cannot be changed after creation</span>
        </div>
      </div>

      {/* Status toggle */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 6 }}>Status</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {['active', 'paused'].map(st => (
            <button key={st} onClick={() => update({ status: st })}
              style={{
                flex: 1, height: 40, borderRadius: 10, border: int.status === st ? `2px solid ${st === 'active' ? '#29811e' : '#ed8d00'}` : '1px solid #e8e8e8',
                background: int.status === st ? (st === 'active' ? '#e8f5e9' : '#fff8e6') : 'white',
                color: int.status === st ? (st === 'active' ? '#29811e' : '#ed8d00') : '#616161',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all .15s',
              }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: st === 'active' ? '#29811e' : '#ed8d00' }}></span>
              {st === 'active' ? 'Active' : 'Paused'}
            </button>
          ))}
        </div>
        {int.status === 'paused' && <div style={{ fontSize: 12, color: '#ed8d00', marginTop: 6 }}><i className="bi-pause-circle" style={{ marginRight: 4 }}></i>Paused integrations will ignore incoming webhook events</div>}
      </div>

      {/* Webhook URL */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 6 }}>Webhook URL</label>
        <div style={{ fontSize: 12, color: '#9e9e9e', marginBottom: 6 }}>Use this URL in your Zapier webhook action (POST request)</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, padding: '9px 12px', border: '1px solid #e8e8e8', borderRadius: 10, background: '#fafaf9', fontSize: 12.5, fontFamily: 'SFMono-Regular, Menlo, monospace', color: '#1b1b1b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {webhookBaseUrl}
          </div>
          <button onClick={() => copyText(webhookBaseUrl, 'url')}
            style={{ height: 38, padding: '0 14px', borderRadius: 10, border: '1px solid #e8e8e8', background: copied === 'url' ? '#e8f5e9' : 'white', color: copied === 'url' ? '#29811e' : '#1f74b3', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', transition: 'all .15s' }}>
            <i className={copied === 'url' ? 'bi-check-lg' : 'bi-clipboard'} style={{ fontSize: 12 }}></i>
            {copied === 'url' ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Webhook Secret */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 6 }}>Webhook secret</label>
        <div style={{ fontSize: 12, color: '#9e9e9e', marginBottom: 6 }}>Add as <code style={{ background: '#f3f3f3', padding: '1px 5px', borderRadius: 4, fontSize: 11.5 }}>Authorization: Bearer &lt;secret&gt;</code> header in Zapier</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, padding: '9px 12px', border: '1px solid #e8e8e8', borderRadius: 10, background: '#fafaf9', fontSize: 12.5, fontFamily: 'SFMono-Regular, Menlo, monospace', color: '#1b1b1b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {showSecret[int.id] ? int.webhookSecret : '••••••••••••••••••••••••'}
          </div>
          <button onClick={() => setShowSecret(prev => ({ ...prev, [int.id]: !prev[int.id] }))}
            style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid #e8e8e8', background: 'var(--surface)', color: '#616161', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
            <i className={showSecret[int.id] ? 'bi-eye-slash' : 'bi-eye'}></i>
          </button>
          <button onClick={() => copyText(int.webhookSecret, 'secret')}
            style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid #e8e8e8', background: copied === 'secret' ? '#e8f5e9' : 'white', color: copied === 'secret' ? '#29811e' : '#1f74b3', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
            <i className={copied === 'secret' ? 'bi-check-lg' : 'bi-clipboard'}></i>
          </button>
          <button onClick={() => { if (confirm('Regenerate secret? Existing Zapier zaps using the old secret will stop working.')) update({ webhookSecret: genSecret() }); }}
            style={{ height: 38, padding: '0 12px', borderRadius: 10, border: '1px solid #FCA5A5', background: 'var(--surface)', color: '#d42d35', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
            <i className="bi-arrow-clockwise" style={{ fontSize: 11 }}></i>Rotate
          </button>
        </div>
      </div>

      {/* External ID field */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 6 }}>External ID field</label>
        <div style={{ fontSize: 12, color: '#9e9e9e', marginBottom: 6 }}>Which field in the incoming payload uniquely identifies each event (used for deduplication)</div>
        <input value={int.externalIdField || ''} onChange={e => update({ externalIdField: e.target.value })}
          placeholder="e.g. id, key, ticket_id"
          style={{ width: '100%', height: 38, border: '1px solid #e8e8e8', borderRadius: 10, padding: '0 12px', fontSize: 13, outline: 'none', fontFamily: 'SFMono-Regular, Menlo, monospace', color: '#1b1b1b', boxSizing: 'border-box' }} />
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, padding: '14px 16px', background: '#f7f5f2', borderRadius: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#9e9e9e', marginBottom: 4 }}>Total events</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1b1b1b' }}>{int.eventCount || 0}</div>
        </div>
        <div style={{ flex: 1, padding: '14px 16px', background: '#f7f5f2', borderRadius: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#9e9e9e', marginBottom: 4 }}>Last event</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1b1b1b' }}>{relativeTime(int.lastEventAt)}</div>
        </div>
        <div style={{ flex: 1, padding: '14px 16px', background: '#f7f5f2', borderRadius: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#9e9e9e', marginBottom: 4 }}>Created</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1b1b1b' }}>{int.createdAt ? new Date(int.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}</div>
        </div>
      </div>

      {/* Test webhook */}
      <div style={{ padding: '16px', background: '#e8f0fe', borderRadius: 12, border: '1px solid #c7e2fe', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1E40AF' }}>Test this integration</div>
            <div style={{ fontSize: 12, color: '#1f74b3', marginTop: 2 }}>Send a mock event through the pipeline. A test task will appear in your queue.</div>
          </div>
          <button onClick={runTestWebhook} disabled={testRunning}
            style={{ height: 36, padding: '0 18px', borderRadius: 10, border: 'none', background: testRunning ? '#9e9e9e' : '#1f74b3', color: 'white', fontSize: 13, fontWeight: 600, cursor: testRunning ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'all .15s' }}>
            {testRunning ? <><i className="bi-hourglass-split" style={{ fontSize: 12 }}></i>Sending...</> : <><i className="bi-play-fill" style={{ fontSize: 13 }}></i>Send Test Event</>}
          </button>
        </div>
      </div>

      {/* Setup Guide */}
      <SetupGuide int={int} webhookBaseUrl={webhookBaseUrl} copyText={copyText} copied={copied} />
    </div>
  );
};

// ── Setup Guide (collapsible) ────────────────────────────────────────────────
const SetupGuide = ({ int, webhookBaseUrl, copyText, copied }) => {
  const [open, setOpen] = useState(false);
  const src = ZAPIER_SOURCES[int.sourceType] || ZAPIER_SOURCES.custom;
  const samplePayload = JSON.stringify({
    source: int.sourceType,
    externalId: `${int.sourceType.toUpperCase()}-1234`,
    subject: `Sample ${src.label} task`,
    description: 'Describe the task here...',
    priority: 'medium',
    requesterName: 'Jane Doe',
    country: 'US',
    tags: ['sample', 'test'],
    externalUrl: `https://${int.sourceType}.example.com/item/1234`,
  }, null, 2);

  return (
    <div style={{ border: '1px solid #e8e8e8', borderRadius: 12, overflow: 'hidden' }}>
      <button onClick={() => setOpen(!open)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', border: 'none', background: '#fafaf9', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#1b1b1b', textAlign: 'left' }}>
        <i className="bi-book" style={{ fontSize: 15, color: '#6b3fa0' }}></i>
        Zapier setup guide
        <span style={{ fontSize: 12, fontWeight: 400, color: '#9e9e9e', flex: 1 }}>Step-by-step instructions</span>
        <i className={open ? 'bi-chevron-up' : 'bi-chevron-down'} style={{ fontSize: 11, color: '#9e9e9e' }}></i>
      </button>
      {open && (
        <div style={{ padding: '16px 20px', borderTop: '1px solid #e8e8e8', fontSize: 13, color: '#1b1b1b', lineHeight: 1.7 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#6b3fa0', color: 'white', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>1</span>
              Create a Zap in Zapier
            </div>
            <div style={{ paddingLeft: 30, color: '#616161', fontSize: 12.5 }}>
              Set your trigger to <strong>{src.label}</strong> (e.g. "New Ticket" or "Updated Record"). Choose the event that should create a task in Ops Hub.
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#6b3fa0', color: 'white', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>2</span>
              Add a "Webhooks by Zapier" action
            </div>
            <div style={{ paddingLeft: 30, color: '#616161', fontSize: 12.5 }}>
              Choose <strong>POST</strong> as the action event. Set the URL to your unique webhook endpoint:
            </div>
            <div style={{ marginLeft: 30, marginTop: 6, padding: '8px 12px', background: '#f7f5f2', borderRadius: 8, fontFamily: 'SFMono-Regular, Menlo, monospace', fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{webhookBaseUrl}</span>
              <button onClick={() => copyText(webhookBaseUrl, 'guide-url')}
                style={{ padding: '2px 8px', border: '1px solid #e8e8e8', borderRadius: 6, background: copied === 'guide-url' ? '#e8f5e9' : 'white', color: copied === 'guide-url' ? '#29811e' : '#1f74b3', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {copied === 'guide-url' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#6b3fa0', color: 'white', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>3</span>
              Set headers
            </div>
            <div style={{ paddingLeft: 30, color: '#616161', fontSize: 12.5 }}>
              Add these headers in the Zapier webhook action:
            </div>
            <div style={{ marginLeft: 30, marginTop: 6, padding: '8px 12px', background: '#f7f5f2', borderRadius: 8, fontFamily: 'SFMono-Regular, Menlo, monospace', fontSize: 11.5, lineHeight: 1.8 }}>
              <div>Content-Type: <span style={{ color: '#6b3fa0' }}>application/json</span></div>
              <div>Authorization: <span style={{ color: '#6b3fa0' }}>Bearer {'<your-webhook-secret>'}</span></div>
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#6b3fa0', color: 'white', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>4</span>
              Configure the payload
            </div>
            <div style={{ paddingLeft: 30, color: '#616161', fontSize: 12.5, marginBottom: 8 }}>
              Set "Payload Type" to <strong>JSON</strong>. Map your {src.label} fields to the keys below. Only <code style={{ background: '#f3f3f3', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>source</code>, <code style={{ background: '#f3f3f3', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>externalId</code>, and <code style={{ background: '#f3f3f3', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>subject</code> are required.
            </div>
            <div style={{ marginLeft: 30, position: 'relative' }}>
              <pre style={{ padding: '12px 14px', background: '#1b1b1b', color: '#e8e8e8', borderRadius: 10, fontSize: 11.5, fontFamily: 'SFMono-Regular, Menlo, monospace', overflow: 'auto', maxHeight: 240, margin: 0, lineHeight: 1.6 }}>{samplePayload}</pre>
              <button onClick={() => copyText(samplePayload, 'payload')}
                style={{ position: 'absolute', top: 8, right: 8, padding: '3px 10px', border: '1px solid #444', borderRadius: 6, background: copied === 'payload' ? '#29811e' : '#333', color: 'white', fontSize: 11, cursor: 'pointer' }}>
                {copied === 'payload' ? 'Copied' : 'Copy JSON'}
              </button>
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#6b3fa0', color: 'white', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>5</span>
              Test and turn on
            </div>
            <div style={{ paddingLeft: 30, color: '#616161', fontSize: 12.5 }}>
              Use the "Send Test Event" button above to verify your field mappings. Then publish your Zap in Zapier and you're done!
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// ── Field Mapping Tab ───────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
const MappingTab = ({ int, update }) => {
  const mappings = int.fieldMappings || [];
  const [customFields, setCustomFields] = useState(loadCustomFields);
  const [showNewField, setShowNewField] = useState(null); // idx of row showing new field input
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldKey, setNewFieldKey] = useState('');
  const [showTransform, setShowTransform] = useState(null); // idx of row showing value map
  const [newMapFrom, setNewMapFrom] = useState('');
  const [newMapTo, setNewMapTo] = useState('');

  // All available target fields = built-in + custom
  const allTargetFields = [...BUILT_IN_FIELDS, ...customFields];

  // Group labels for optgroup display
  const fieldGroups = {
    core: 'Core task fields',
    escalation: 'Escalation fields',
    comms: 'Communications fields',
    project: 'Project fields',
    reporting: 'Reporting fields',
    custom: 'Custom fields',
  };

  const updateMapping = (idx, field, value) => {
    if (field === 'targetField' && value === '__new__') {
      setShowNewField(idx);
      setNewFieldName('');
      setNewFieldKey('');
      return;
    }
    const updated = mappings.map((m, i) => i === idx ? { ...m, [field]: value } : m);
    update({ fieldMappings: updated });
  };

  const addMapping = () => {
    update({ fieldMappings: [...mappings, { id: genId(), sourceField: '', targetField: '', defaultValue: '', valueMap: null }] });
  };

  const removeMapping = (idx) => {
    update({ fieldMappings: mappings.filter((_, i) => i !== idx) });
    if (showNewField === idx) setShowNewField(null);
  };

  const createCustomField = (idx) => {
    const key = newFieldKey.trim() || newFieldName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const label = newFieldName.trim();
    if (!key || !label) return;
    // Check for duplicate
    if (allTargetFields.some(f => f.key === key)) {
      // Just select it instead of creating duplicate
      const updated = mappings.map((m, i) => i === idx ? { ...m, targetField: key } : m);
      update({ fieldMappings: updated });
      setShowNewField(null);
      return;
    }
    const newField = { key, label, required: false, group: 'custom' };
    const updatedCustom = [...customFields, newField];
    setCustomFields(updatedCustom);
    saveCustomFields(updatedCustom);
    const updated = mappings.map((m, i) => i === idx ? { ...m, targetField: key } : m);
    update({ fieldMappings: updated });
    setShowNewField(null);
  };

  const deleteCustomField = (key) => {
    const updatedCustom = customFields.filter(f => f.key !== key);
    setCustomFields(updatedCustom);
    saveCustomFields(updatedCustom);
  };

  // Group fields for the dropdown
  const groupedFields = {};
  allTargetFields.forEach(f => {
    const g = f.group || 'core';
    if (!groupedFields[g]) groupedFields[g] = [];
    groupedFields[g].push(f);
  });

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1b1b1b', marginBottom: 4 }}>Field mapping</div>
        <div style={{ fontSize: 13, color: '#9e9e9e' }}>Map fields from the incoming Zapier payload to Ops Hub fields. Use dot notation for nested fields (e.g. <code style={{ background: '#f3f3f3', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>priority.name</code>). Select "Create custom field" to add your own.</div>
      </div>

      <div style={{ border: '1px solid #e8e8e8', borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 32px 1fr 1fr 36px', gap: 8, padding: '10px 14px', background: '#fafaf9', borderBottom: '1px solid #e8e8e8', fontSize: 12, fontWeight: 600, color: '#9e9e9e' }}>
          <span>Source field</span>
          <span></span>
          <span>Ops Hub field</span>
          <span>Default value</span>
          <span></span>
        </div>

        {/* Mapping rows */}
        {mappings.map((m, idx) => {
          const targetDef = allTargetFields.find(f => f.key === m.targetField);
          const isCustom = targetDef?.group === 'custom';
          const rowKey = m.id || `row-${idx}`;
          return (
            <div key={rowKey}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 32px 1fr 1fr 36px', gap: 8, padding: '8px 14px', borderBottom: showNewField === idx ? 'none' : '1px solid #f5f5f5', alignItems: 'center' }}>
                <input value={m.sourceField} onChange={e => updateMapping(idx, 'sourceField', e.target.value)}
                  placeholder="e.g. title" style={{ height: 34, border: '1px solid #e8e8e8', borderRadius: 8, padding: '0 10px', fontSize: 13, outline: 'none', fontFamily: 'SFMono-Regular, Menlo, monospace', color: '#1b1b1b', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c4c4c4' }}>
                  <i className="bi-arrow-right" style={{ fontSize: 14 }}></i>
                </div>
                <div style={{ position: 'relative' }}>
                  <select value={m.targetField} onChange={e => updateMapping(idx, 'targetField', e.target.value)}
                    style={{ width: '100%', height: 34, border: `1px solid ${isCustom ? '#6b3fa0' : '#e8e8e8'}`, borderRadius: 8, padding: '0 8px', fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1b1b1b', cursor: 'pointer', background: isCustom ? '#f9f5ff' : 'white' }}>
                    <option value="">-- Select field --</option>
                    {Object.entries(groupedFields).map(([group, fields]) => (
                      <optgroup key={group} label={fieldGroups[group] || group}>
                        {fields.map(f => (
                          <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>
                        ))}
                      </optgroup>
                    ))}
                    <optgroup label="────────────">
                      <option value="__new__">+ Create custom field...</option>
                    </optgroup>
                  </select>
                </div>
                {targetDef?.options ? (
                  <select value={m.defaultValue || ''} onChange={e => updateMapping(idx, 'defaultValue', e.target.value)}
                    style={{ height: 34, border: '1px solid #e8e8e8', borderRadius: 8, padding: '0 8px', fontSize: 13, outline: 'none', fontFamily: 'inherit', color: m.defaultValue ? '#1b1b1b' : '#9e9e9e', cursor: 'pointer', background: 'var(--surface)' }}>
                    <option value="">No default</option>
                    {targetDef.options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input value={m.defaultValue || ''} onChange={e => updateMapping(idx, 'defaultValue', e.target.value)}
                    placeholder="Fallback value" style={{ height: 34, border: '1px solid #e8e8e8', borderRadius: 8, padding: '0 10px', fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1b1b1b', boxSizing: 'border-box' }} />
                )}
                <div style={{ display: 'flex', gap: 2 }}>
                  <button onClick={() => { setShowTransform(showTransform === idx ? null : idx); setNewMapFrom(''); setNewMapTo(''); }} title="Value transforms"
                    style={{ width: 26, height: 26, borderRadius: 5, border: 'none', background: (m.valueMap && Object.keys(m.valueMap).length > 0) ? '#e8f0fe' : 'transparent', color: (m.valueMap && Object.keys(m.valueMap).length > 0) ? '#1f74b3' : '#c4c4c4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, transition: 'all .12s' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#1f74b3'; e.currentTarget.style.background = '#e8f0fe'; }}
                    onMouseLeave={e => { if (!(m.valueMap && Object.keys(m.valueMap).length > 0)) { e.currentTarget.style.color = '#c4c4c4'; e.currentTarget.style.background = 'transparent'; } }}>
                    <i className="bi-arrow-repeat"></i>
                  </button>
                  <button onClick={() => removeMapping(idx)} title="Remove mapping"
                    style={{ width: 26, height: 26, borderRadius: 5, border: 'none', background: 'transparent', color: '#c4c4c4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, transition: 'all .12s' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#d42d35'; e.currentTarget.style.background = '#ffe2de'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#c4c4c4'; e.currentTarget.style.background = 'transparent'; }}>
                    <i className="bi-trash3"></i>
                  </button>
                </div>
              </div>
              {/* Value transform editor */}
              {showTransform === idx && (
                <div style={{ padding: '8px 14px 12px', borderBottom: '1px solid #f5f5f5', background: '#f0f7ff' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#1f74b3', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <i className="bi-arrow-repeat" style={{ fontSize: 10 }}></i>Value transforms for "{m.sourceField || m.targetField}"
                    <span style={{ fontWeight: 400, color: '#9e9e9e', marginLeft: 4 }}>Map source values to Ops Hub values</span>
                  </div>
                  {Object.entries(m.valueMap || {}).map(([from, to]) => (
                    <div key={from} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <code style={{ fontSize: 12, background: '#e8e8e8', padding: '2px 8px', borderRadius: 4, color: '#1b1b1b' }}>{from}</code>
                      <i className="bi-arrow-right" style={{ fontSize: 10, color: '#9e9e9e' }}></i>
                      <code style={{ fontSize: 12, background: '#e8f0fe', padding: '2px 8px', borderRadius: 4, color: '#1f74b3' }}>{to}</code>
                      <button onClick={() => {
                        const newMap = { ...(m.valueMap || {}) };
                        delete newMap[from];
                        const updated = mappings.map((mm, i) => i === idx ? { ...mm, valueMap: Object.keys(newMap).length ? newMap : null } : mm);
                        update({ fieldMappings: updated });
                      }} style={{ width: 20, height: 20, borderRadius: 4, border: 'none', background: 'transparent', color: '#c4c4c4', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#d42d35'}
                        onMouseLeave={e => e.currentTarget.style.color = '#c4c4c4'}>
                        <i className="bi-x-lg"></i>
                      </button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                    <input value={newMapFrom} onChange={e => setNewMapFrom(e.target.value)} placeholder="Source value (e.g. Urgent)"
                      style={{ width: 140, height: 28, border: '1px solid #c7e2fe', borderRadius: 6, padding: '0 8px', fontSize: 12, outline: 'none', fontFamily: 'SFMono-Regular, Menlo, monospace' }} />
                    <i className="bi-arrow-right" style={{ fontSize: 10, color: '#9e9e9e' }}></i>
                    <input value={newMapTo} onChange={e => setNewMapTo(e.target.value)} placeholder="Ops Hub value (e.g. critical)"
                      style={{ width: 140, height: 28, border: '1px solid #c7e2fe', borderRadius: 6, padding: '0 8px', fontSize: 12, outline: 'none', fontFamily: 'SFMono-Regular, Menlo, monospace' }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newMapFrom.trim() && newMapTo.trim()) {
                          const newMap = { ...(m.valueMap || {}), [newMapFrom.trim()]: newMapTo.trim() };
                          const updated = mappings.map((mm, i) => i === idx ? { ...mm, valueMap: newMap } : mm);
                          update({ fieldMappings: updated });
                          setNewMapFrom(''); setNewMapTo('');
                        }
                      }} />
                    <button onClick={() => {
                      if (!newMapFrom.trim() || !newMapTo.trim()) return;
                      const newMap = { ...(m.valueMap || {}), [newMapFrom.trim()]: newMapTo.trim() };
                      const updated = mappings.map((mm, i) => i === idx ? { ...mm, valueMap: newMap } : mm);
                      update({ fieldMappings: updated });
                      setNewMapFrom(''); setNewMapTo('');
                    }} disabled={!newMapFrom.trim() || !newMapTo.trim()}
                      style={{ height: 28, padding: '0 10px', borderRadius: 6, border: 'none', background: newMapFrom.trim() && newMapTo.trim() ? '#1f74b3' : '#c7e2fe', color: 'white', fontSize: 11, fontWeight: 600, cursor: newMapFrom.trim() && newMapTo.trim() ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
                      Add
                    </button>
                  </div>
                </div>
              )}
              {/* Inline custom field creator */}
              {showNewField === idx && (
                <div style={{ display: 'flex', gap: 8, padding: '8px 14px 12px', borderBottom: '1px solid #f5f5f5', background: '#f9f5ff', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#6b3fa0', display: 'block', marginBottom: 4 }}>Field label</label>
                    <input value={newFieldName} onChange={e => { setNewFieldName(e.target.value); setNewFieldKey(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')); }}
                      placeholder="e.g. Employee ID" autoFocus style={{ width: '100%', height: 32, border: '1px solid #d4bfea', borderRadius: 8, padding: '0 10px', fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1b1b1b', boxSizing: 'border-box', background: 'var(--surface)' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#6b3fa0', display: 'block', marginBottom: 4 }}>Field key <span style={{ fontWeight: 400, color: '#9e9e9e' }}>(auto-generated)</span></label>
                    <input value={newFieldKey} onChange={e => setNewFieldKey(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                      placeholder="employee_id" style={{ width: '100%', height: 32, border: '1px solid #d4bfea', borderRadius: 8, padding: '0 10px', fontSize: 13, outline: 'none', fontFamily: 'SFMono-Regular, Menlo, monospace', color: '#1b1b1b', boxSizing: 'border-box', background: 'var(--surface)' }} />
                  </div>
                  <button onClick={() => createCustomField(idx)} disabled={!newFieldName.trim()}
                    style={{ height: 32, padding: '0 14px', borderRadius: 8, border: 'none', background: newFieldName.trim() ? '#6b3fa0' : '#d4bfea', color: 'white', fontSize: 12, fontWeight: 600, cursor: newFieldName.trim() ? 'pointer' : 'default', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <i className="bi-plus-lg" style={{ fontSize: 10 }}></i>Create
                  </button>
                  <button onClick={() => setShowNewField(null)}
                    style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid #e8e8e8', background: 'var(--surface)', color: '#616161', fontSize: 12, cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={addMapping}
          style={{ height: 36, padding: '0 16px', borderRadius: 10, border: '1px dashed #c4c4c4', background: 'var(--surface)', color: '#1f74b3', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e8f0fe'; e.currentTarget.style.borderColor = '#1f74b3'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#c4c4c4'; }}>
          <i className="bi-plus-lg" style={{ fontSize: 11 }}></i> Add field mapping
        </button>
      </div>

      {/* Custom fields manager */}
      {customFields.length > 0 && (
        <div style={{ marginTop: 20, border: '1px solid #d4bfea', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', background: '#f9f5ff', borderBottom: '1px solid #d4bfea', display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className="bi-puzzle" style={{ fontSize: 12, color: '#6b3fa0' }}></i>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#6b3fa0' }}>Custom fields ({customFields.length})</span>
            <span style={{ fontSize: 11, color: '#9e9e9e', marginLeft: 4 }}>Available across all integrations</span>
          </div>
          {customFields.map(f => (
            <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid #f3eff8', fontSize: 13 }}>
              <span style={{ fontWeight: 500, color: '#1b1b1b', flex: 1 }}>{f.label}</span>
              <code style={{ fontSize: 11, color: '#6b3fa0', background: '#f3eff8', padding: '2px 6px', borderRadius: 4 }}>{f.key}</code>
              <button onClick={() => deleteCustomField(f.key)} title="Delete custom field"
                style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: '#c4c4c4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}
                onMouseEnter={e => { e.currentTarget.style.color = '#d42d35'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#c4c4c4'; }}>
                <i className="bi-x-lg"></i>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Info box */}
      <div style={{ marginTop: 16, padding: '12px 14px', background: '#f7f5f2', borderRadius: 10, fontSize: 12, color: '#616161' }}>
        <i className="bi-info-circle" style={{ marginRight: 6 }}></i>
        <strong>Required:</strong> At least one mapping to <strong>Subject</strong> is needed. Leave source field empty and set a default value to use a static value. Custom fields are shared across all integrations and stored with each task.
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// ── Routing Tab ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
const RoutingTab = ({ int, update }) => {
  const dest = int.destination || 'queue';
  const filters = int.filters || [];

  const addFilter = () => update({ filters: [...filters, { field: '', operator: 'equals', value: '' }] });
  const updateFilter = (idx, key, val) => update({ filters: filters.map((f, i) => i === idx ? { ...f, [key]: val } : f) });
  const removeFilter = (idx) => update({ filters: filters.filter((_, i) => i !== idx) });

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1b1b1b', marginBottom: 4 }}>Destination & routing</div>
        <div style={{ fontSize: 13, color: '#9e9e9e' }}>Choose where incoming events from this integration are routed to within Ops Hub.</div>
      </div>

      {/* Conditional filters */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <i className="bi-funnel" style={{ fontSize: 12, color: '#6b3fa0' }}></i>
          Filters
          {filters.length > 0 && <span style={{ fontSize: 11, fontWeight: 400, color: '#9e9e9e' }}>Only process events matching ALL conditions</span>}
        </label>
        {filters.length === 0 ? (
          <div style={{ padding: '12px 14px', background: '#fafaf9', borderRadius: 10, border: '1px dashed #e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12.5, color: '#9e9e9e' }}><i className="bi-check-circle" style={{ marginRight: 6 }}></i>No filters — all incoming events are processed</span>
            <button onClick={addFilter}
              style={{ height: 28, padding: '0 12px', borderRadius: 7, border: '1px solid #e8e8e8', background: 'var(--surface)', color: '#6b3fa0', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <i className="bi-plus-lg" style={{ fontSize: 10 }}></i>Add filter
            </button>
          </div>
        ) : (
          <div style={{ border: '1px solid #e8e8e8', borderRadius: 12, overflow: 'hidden' }}>
            {filters.map((f, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: idx < filters.length - 1 ? '1px solid #f5f5f5' : 'none', fontSize: 13 }}>
                <span style={{ fontSize: 11, color: '#9e9e9e', width: 28, textAlign: 'center', flexShrink: 0 }}>{idx === 0 ? 'If' : 'AND'}</span>
                <input value={f.field} onChange={e => updateFilter(idx, 'field', e.target.value)}
                  placeholder="payload field (e.g. priority)"
                  style={{ flex: 1, height: 32, border: '1px solid #e8e8e8', borderRadius: 7, padding: '0 10px', fontSize: 12, outline: 'none', fontFamily: 'SFMono-Regular, Menlo, monospace' }} />
                <select value={f.operator} onChange={e => updateFilter(idx, 'operator', e.target.value)}
                  style={{ height: 32, border: '1px solid #e8e8e8', borderRadius: 7, padding: '0 6px', fontSize: 12, outline: 'none', cursor: 'pointer', color: '#6b3fa0', fontWeight: 500 }}>
                  <option value="equals">equals</option>
                  <option value="not_equals">not equals</option>
                  <option value="contains">contains</option>
                  <option value="not_contains">not contains</option>
                  <option value="exists">exists</option>
                  <option value="not_exists">not exists</option>
                </select>
                {!['exists', 'not_exists'].includes(f.operator) && (
                  <input value={f.value || ''} onChange={e => updateFilter(idx, 'value', e.target.value)}
                    placeholder="value"
                    style={{ width: 120, height: 32, border: '1px solid #e8e8e8', borderRadius: 7, padding: '0 10px', fontSize: 12, outline: 'none', fontFamily: 'SFMono-Regular, Menlo, monospace' }} />
                )}
                <button onClick={() => removeFilter(idx)}
                  style={{ width: 26, height: 26, borderRadius: 5, border: 'none', background: 'transparent', color: '#c4c4c4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#d42d35'; e.currentTarget.style.background = '#ffe2de'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#c4c4c4'; e.currentTarget.style.background = 'transparent'; }}>
                  <i className="bi-x-lg"></i>
                </button>
              </div>
            ))}
            <div style={{ padding: '6px 12px', borderTop: '1px solid #f5f5f5' }}>
              <button onClick={addFilter}
                style={{ height: 28, padding: '0 10px', borderRadius: 6, border: 'none', background: 'transparent', color: '#6b3fa0', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <i className="bi-plus-lg" style={{ fontSize: 10 }}></i>Add condition
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ height: 1, background: '#e8e8e8', margin: '0 0 24px' }}></div>

      {/* Destination picker */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 10 }}>Destination</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {DESTINATIONS.map(d => (
            <button key={d.id} onClick={() => update({ destination: d.id })}
              style={{
                padding: '14px 16px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', transition: 'all .15s',
                border: dest === d.id ? `2px solid ${d.color}` : '1px solid #e8e8e8',
                background: dest === d.id ? d.bg : 'white',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: dest === d.id ? `${d.color}22` : '#f3f3f3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className={d.icon} style={{ fontSize: 13, color: dest === d.id ? d.color : '#9e9e9e' }}></i>
                </div>
                <span style={{ fontSize: 14, fontWeight: 600, color: dest === d.id ? d.color : '#1b1b1b' }}>{d.label}</span>
              </div>
              <div style={{ fontSize: 11.5, color: '#9e9e9e', lineHeight: 1.4 }}>{d.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: '#e8e8e8', margin: '20px 0' }}></div>

      {/* Queue-specific options */}
      {dest === 'queue' && (<>
        {/* Inbound / Outbound */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 8 }}>Queue direction</label>
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              { val: 'inbound', label: 'Inbound', icon: 'bi-inbox', desc: 'Tasks received from external sources' },
              { val: 'outbound', label: 'Outbound', icon: 'bi-send', desc: 'Tasks sent out or follow-ups' },
            ].map(opt => (
              <button key={opt.val} onClick={() => update({ queueTab: opt.val })}
                style={{
                  flex: 1, padding: '14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', transition: 'all .15s',
                  border: int.queueTab === opt.val ? '2px solid #1f74b3' : '1px solid #e8e8e8',
                  background: int.queueTab === opt.val ? '#e8f0fe' : 'white',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <i className={opt.icon} style={{ fontSize: 14, color: int.queueTab === opt.val ? '#1f74b3' : '#9e9e9e' }}></i>
                  <span style={{ fontSize: 13, fontWeight: 600, color: int.queueTab === opt.val ? '#1f74b3' : '#1b1b1b' }}>{opt.label}</span>
                </div>
                <div style={{ fontSize: 11.5, color: '#9e9e9e' }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Default status on arrival */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 8 }}>Default status on arrival</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['new', 'in_progress'].map(st => (
              <button key={st} onClick={() => update({ subFilter: st === 'new' ? null : st })}
                style={{
                  padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all .15s',
                  border: (!int.subFilter && st === 'new') || int.subFilter === st ? '2px solid #1f74b3' : '1px solid #e8e8e8',
                  background: (!int.subFilter && st === 'new') || int.subFilter === st ? '#e8f0fe' : 'white',
                  color: (!int.subFilter && st === 'new') || int.subFilter === st ? '#1f74b3' : '#616161',
                }}>
                {st === 'new' ? 'New' : 'In Progress'}
              </button>
            ))}
          </div>
        </div>

        {/* Auto-assignment */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 8 }}>Auto-assignment</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { val: 'none', label: 'Unassigned', desc: 'Goes to pool' },
              { val: 'round_robin', label: 'Round robin', desc: 'Rotate between agents' },
              { val: 'load_balance', label: 'Least loaded', desc: 'Agent with fewest tasks' },
            ].map(opt => (
              <button key={opt.val} onClick={() => update({ autoAssign: opt.val })}
                style={{
                  flex: 1, padding: '12px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', transition: 'all .15s',
                  border: (int.autoAssign || 'none') === opt.val ? '2px solid #1f74b3' : '1px solid #e8e8e8',
                  background: (int.autoAssign || 'none') === opt.val ? '#e8f0fe' : 'white',
                }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: (int.autoAssign || 'none') === opt.val ? '#1f74b3' : '#1b1b1b' }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 2 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Priority override */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 8 }}>Default priority</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['from_source', 'low', 'medium', 'high', 'critical'].map(p => {
              const colors = { from_source: '#616161', low: '#9e9e9e', medium: '#0369a1', high: '#d97706', critical: '#d42d35' };
              const labels = { from_source: 'From source', low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
              return (
                <button key={p} onClick={() => update({ defaultPriority: p })}
                  style={{
                    padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all .15s',
                    border: (int.defaultPriority || 'from_source') === p ? `2px solid ${colors[p]}` : '1px solid #e8e8e8',
                    background: (int.defaultPriority || 'from_source') === p ? `${colors[p]}11` : 'white',
                    color: (int.defaultPriority || 'from_source') === p ? colors[p] : '#616161',
                  }}>
                  {labels[p]}
                </button>
              );
            })}
          </div>
        </div>
      </>)}

      {/* Escalation-specific options */}
      {dest === 'escalations' && (<>
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 8 }}>Escalation behavior</label>
          <div style={{ fontSize: 12, color: '#9e9e9e', marginBottom: 10 }}>How should incoming events be handled as escalations?</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { val: 'create', label: 'Create new escalation', desc: 'Each event creates a new escalation entry' },
              { val: 'link', label: 'Link to existing task', desc: 'Attach as escalation to a matching open task' },
            ].map(opt => (
              <button key={opt.val} onClick={() => update({ escalationMode: opt.val })}
                style={{
                  flex: 1, padding: '14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', transition: 'all .15s',
                  border: (int.escalationMode || 'create') === opt.val ? '2px solid #ed8d00' : '1px solid #e8e8e8',
                  background: (int.escalationMode || 'create') === opt.val ? '#fff8e6' : 'white',
                }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: (int.escalationMode || 'create') === opt.val ? '#ed8d00' : '#1b1b1b' }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 2 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 8 }}>Default escalation status</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['pending', 'in_review'].map(st => (
              <button key={st} onClick={() => update({ escalationStatus: st })}
                style={{
                  padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all .15s',
                  border: (int.escalationStatus || 'pending') === st ? '2px solid #ed8d00' : '1px solid #e8e8e8',
                  background: (int.escalationStatus || 'pending') === st ? '#fff8e6' : 'white',
                  color: (int.escalationStatus || 'pending') === st ? '#ed8d00' : '#616161',
                }}>
                {st === 'pending' ? 'Pending' : 'In Review'}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: '12px 14px', background: '#fff8e6', borderRadius: 10, border: '1px solid #f5deb3', fontSize: 12, color: '#92600e' }}>
          <i className="bi-info-circle" style={{ marginRight: 6 }}></i>
          Map the <strong>reason</strong> and <strong>managerId</strong> fields in the Field Mapping tab to populate escalation details automatically.
        </div>
      </>)}

      {/* Comms-specific options */}
      {dest === 'comms' && (<>
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 8 }}>Communication type</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['alert', 'announce', 'update', 'guidance', 'kudos'].map(t => {
              const labels = { alert: 'Alert', announce: 'Announcement', update: 'Update', guidance: 'Guidance', kudos: 'Kudos' };
              const icons = { alert: 'bi-exclamation-triangle-fill', announce: 'bi-megaphone-fill', update: 'bi-arrow-clockwise', guidance: 'bi-lightbulb-fill', kudos: 'bi-star-fill' };
              return (
                <button key={t} onClick={() => update({ commsType: t })}
                  style={{
                    padding: '10px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all .15s',
                    border: (int.commsType || 'update') === t ? '2px solid #6b3fa0' : '1px solid #e8e8e8',
                    background: (int.commsType || 'update') === t ? '#f3eff8' : 'white',
                    color: (int.commsType || 'update') === t ? '#6b3fa0' : '#616161',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                  <i className={icons[t]} style={{ fontSize: 11 }}></i>{labels[t]}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 8 }}>Requires acknowledgement</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[true, false].map(v => (
              <button key={String(v)} onClick={() => update({ commsRequireAck: v })}
                style={{
                  padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all .15s',
                  border: (int.commsRequireAck ?? false) === v ? '2px solid #6b3fa0' : '1px solid #e8e8e8',
                  background: (int.commsRequireAck ?? false) === v ? '#f3eff8' : 'white',
                  color: (int.commsRequireAck ?? false) === v ? '#6b3fa0' : '#616161',
                }}>
                {v ? 'Yes — agents must acknowledge' : 'No — informational only'}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: '12px 14px', background: '#f3eff8', borderRadius: 10, border: '1px solid #d4bfea', fontSize: 12, color: '#6b3fa0' }}>
          <i className="bi-info-circle" style={{ marginRight: 6 }}></i>
          Map the <strong>channel</strong> and <strong>commsType</strong> fields in Field Mapping to override these defaults per event.
        </div>
      </>)}

      {/* Projects-specific options */}
      {dest === 'projects' && (<>
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 8 }}>Project behavior</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { val: 'create', label: 'Create new project', desc: 'Each event creates a new project entry' },
              { val: 'update', label: 'Update existing', desc: 'Match by name and update progress/milestones' },
              { val: 'task', label: 'Add as project task', desc: 'Add as a task within a matched project' },
            ].map(opt => (
              <button key={opt.val} onClick={() => update({ projectMode: opt.val })}
                style={{
                  flex: 1, padding: '12px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', transition: 'all .15s',
                  border: (int.projectMode || 'create') === opt.val ? '2px solid #29811e' : '1px solid #e8e8e8',
                  background: (int.projectMode || 'create') === opt.val ? '#e8f5e9' : 'white',
                }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: (int.projectMode || 'create') === opt.val ? '#29811e' : '#1b1b1b' }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 2 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: '12px 14px', background: '#e8f5e9', borderRadius: 10, border: '1px solid #c2eeb5', fontSize: 12, color: '#29811e' }}>
          <i className="bi-info-circle" style={{ marginRight: 6 }}></i>
          Map <strong>projectName</strong> and <strong>milestone</strong> in Field Mapping. For "Update existing", the project is matched by name.
        </div>
      </>)}

      {/* Reports-specific options */}
      {dest === 'reports' && (<>
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 8 }}>Report type</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['headcount', 'attrition', 'leave', 'payroll', 'compliance', 'custom'].map(t => (
              <button key={t} onClick={() => update({ reportCategory: t })}
                style={{
                  padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all .15s',
                  border: (int.reportCategory || 'custom') === t ? '2px solid #1565c0' : '1px solid #e8e8e8',
                  background: (int.reportCategory || 'custom') === t ? '#e3f2fd' : 'white',
                  color: (int.reportCategory || 'custom') === t ? '#1565c0' : '#616161',
                  textTransform: 'capitalize',
                }}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', display: 'block', marginBottom: 8 }}>Data handling</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { val: 'append', label: 'Append data', desc: 'Add to existing report dataset' },
              { val: 'replace', label: 'Replace snapshot', desc: 'Replace the latest data snapshot' },
            ].map(opt => (
              <button key={opt.val} onClick={() => update({ reportDataMode: opt.val })}
                style={{
                  flex: 1, padding: '12px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', transition: 'all .15s',
                  border: (int.reportDataMode || 'append') === opt.val ? '2px solid #1565c0' : '1px solid #e8e8e8',
                  background: (int.reportDataMode || 'append') === opt.val ? '#e3f2fd' : 'white',
                }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: (int.reportDataMode || 'append') === opt.val ? '#1565c0' : '#1b1b1b' }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 2 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: '12px 14px', background: '#e3f2fd', borderRadius: 10, border: '1px solid #90caf9', fontSize: 12, color: '#1565c0' }}>
          <i className="bi-info-circle" style={{ marginRight: 6 }}></i>
          Map <strong>reportType</strong> and <strong>reportData</strong> in Field Mapping to structure your incoming data.
        </div>
      </>)}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// ── Columns Tab ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
const ColumnsTab = ({ int, update }) => {
  const useGlobal = !int.columnOverrides;
  const cols = int.columnOverrides || { ticket: true, source: true, function: true, assignee: true, country: true, time: true, status: true };

  const toggleGlobal = () => {
    if (useGlobal) {
      update({ columnOverrides: { ticket: true, source: true, function: true, assignee: true, country: true, time: true, status: true } });
    } else {
      update({ columnOverrides: null });
    }
  };

  const toggleCol = (key) => {
    update({ columnOverrides: { ...cols, [key]: !cols[key] } });
  };

  const COLUMN_DEFS = [
    { key: 'ticket', label: 'Ticket ID', desc: 'External ticket/task identifier' },
    { key: 'source', label: 'Source', desc: 'Integration source badge (Zendesk, Jira, etc.)' },
    { key: 'function', label: 'Function', desc: 'Task category (Onboarding, Payroll, etc.)' },
    { key: 'assignee', label: 'Assignee', desc: 'Assigned agent avatar and name' },
    { key: 'country', label: 'Country', desc: 'Country flag and code' },
    { key: 'time', label: 'Time', desc: 'Received and updated timestamps' },
    { key: 'status', label: 'Status', desc: 'Current task status badge' },
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1b1b1b', marginBottom: 4 }}>Column visibility</div>
        <div style={{ fontSize: 13, color: '#9e9e9e' }}>Choose which columns are visible for tasks from this integration.</div>
      </div>

      {/* Global toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid #e8e8e8', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#1b1b1b' }}>Use global column defaults</div>
          <div style={{ fontSize: 12, color: '#9e9e9e', marginTop: 2 }}>When enabled, this integration follows the global column settings from UI & Display</div>
        </div>
        <button onClick={toggleGlobal}
          style={{ width: 44, height: 24, borderRadius: 12, border: 'none', background: useGlobal ? '#29811e' : '#dedede', cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
          <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--surface)', position: 'absolute', top: 3, left: useGlobal ? 23 : 3, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.15)' }}></div>
        </button>
      </div>

      {/* Column toggles */}
      <div style={{ opacity: useGlobal ? 0.4 : 1, pointerEvents: useGlobal ? 'none' : 'auto', transition: 'opacity .2s' }}>
        {COLUMN_DEFS.map(col => (
          <div key={col.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f5f5f5' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#1b1b1b' }}>{col.label}</div>
              <div style={{ fontSize: 12, color: '#9e9e9e', marginTop: 1 }}>{col.desc}</div>
            </div>
            <button onClick={() => toggleCol(col.key)}
              style={{ width: 44, height: 24, borderRadius: 12, border: 'none', background: cols[col.key] ? '#29811e' : '#dedede', cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--surface)', position: 'absolute', top: 3, left: cols[col.key] ? 23 : 3, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.15)' }}></div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// ── Activity Log Tab ────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
const ActivityTab = ({ int, update }) => {
  const logs = int.activityLog || [];
  const [expandedId, setExpandedId] = useState(null);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1b1b1b' }}>Activity log</div>
          <div style={{ fontSize: 13, color: '#9e9e9e' }}>Recent webhook events (last 50)</div>
        </div>
        {logs.length > 0 && (
          <button onClick={() => update({ activityLog: [] })}
            style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid #e8e8e8', background: 'var(--surface)', color: '#616161', fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <i className="bi-x-lg" style={{ fontSize: 10 }}></i>Clear log
          </button>
        )}
      </div>

      {logs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9e9e9e' }}>
          <i className="bi-journal" style={{ fontSize: 28, display: 'block', marginBottom: 8 }}></i>
          <div style={{ fontSize: 13, fontWeight: 500 }}>No events yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Events will appear here when webhooks are received or tests are run</div>
        </div>
      ) : (
        <div style={{ border: '1px solid #e8e8e8', borderRadius: 14, overflow: 'hidden' }}>
          {logs.map((log, idx) => {
            const isExpanded = expandedId === log.id;
            const statusColors = {
              success: { bg: '#e8f5e9', color: '#29811e', label: 'Success' },
              failed: { bg: '#ffe2de', color: '#d42d35', label: 'Failed' },
              'skipped-duplicate': { bg: '#fff8e6', color: '#ed8d00', label: 'Skipped' },
              'skipped-filter': { bg: '#f3eff8', color: '#6b3fa0', label: 'Filtered' },
            };
            const st = statusColors[log.status] || statusColors.success;
            return (
              <div key={log.id}>
                <div onClick={() => setExpandedId(isExpanded ? null : log.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: idx < logs.length - 1 || isExpanded ? '1px solid #f5f5f5' : 'none', cursor: 'pointer', transition: 'background .1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontSize: 12, color: '#9e9e9e', whiteSpace: 'nowrap', width: 70, flexShrink: 0 }}>
                    {log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--'}
                  </span>
                  <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 99, background: st.bg, color: st.color, fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                    {st.label}
                  </span>
                  <span style={{ fontSize: 13, color: '#1b1b1b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.summary}
                  </span>
                  <i className={isExpanded ? 'bi-chevron-up' : 'bi-chevron-down'} style={{ fontSize: 10, color: '#9e9e9e', flexShrink: 0 }}></i>
                </div>
                {isExpanded && log.payload && (
                  <div style={{ padding: '10px 14px', background: '#fafaf9', borderBottom: idx < logs.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#9e9e9e', marginBottom: 6 }}>RAW PAYLOAD</div>
                    <pre style={{ fontSize: 11.5, fontFamily: 'SFMono-Regular, Menlo, monospace', color: '#616161', background: '#f0f0f0', padding: '10px 12px', borderRadius: 8, overflow: 'auto', maxHeight: 200, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {JSON.stringify(log.payload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ZapierSettings;
