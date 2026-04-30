import { useState, useContext, useMemo, useRef, useEffect } from 'react';
import { PermissionsContext, IntegrationsContext } from '../../App';
import { FLAGS } from '../../data/constants';
import { slaInfo } from '../../utils/helpers';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import MultiCountryPicker from '../team/MultiCountryPicker';
import { useQueueSlaSettings, broadcastQueueSlaUpdate } from '../../hooks/useQueueSlaSettings';
import { putQueueSlaSettings } from '../../services/queueSlaSettingsApi';
import { useCapacitySettings, broadcastCapacityUpdate } from '../../hooks/useCapacitySettings';
import { putCapacitySettings } from '../../services/capacityApi';
import { useOnboardingData } from '../../hooks/useOnboardingData';
import { useOffboardingData } from '../../hooks/useOffboardingData';
import { useWorkbenchData } from '../../hooks/useWorkbenchData';
import {
  normalizeOnboarding,
  normalizeOffboarding,
  normalizeWorkbench,
} from '../../utils/normalizeSourceRows';
import Avatar from '../ui/Avatar';
import PageHeader from '../ui/PageHeader';

// ── Last-login badge helper ─────────────────────────────────────────────────
// Renders a small pill next to each member that's accurate to the last hour.
// "Never logged in" (amber) if the DB has no row; "Today", "Yesterday",
// "X days ago", or the short date otherwise. Tooltip shows the full ISO time
// for anyone who needs an exact timestamp (ops / audit).
function formatLastLogin(iso) {
  if (!iso) return { label: 'Never logged in', tone: 'never' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { label: 'Never logged in', tone: 'never' };

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr  = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  // Less than 1 hour → minutes
  if (diffMin < 1) return { label: 'Just now', tone: 'fresh', iso };
  if (diffMin < 60) return { label: `${diffMin} min ago`, tone: 'fresh', iso };
  if (diffHr < 24) return { label: `${diffHr} hr ago`, tone: 'fresh', iso };
  if (diffDay === 1) return { label: 'Yesterday', tone: 'recent', iso };
  if (diffDay < 7) return { label: `${diffDay} days ago`, tone: 'recent', iso };
  if (diffDay < 30) return { label: `${Math.floor(diffDay / 7)}w ago`, tone: 'stale', iso };
  if (diffDay < 365) return { label: `${Math.floor(diffDay / 30)}mo ago`, tone: 'stale', iso };
  return { label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }), tone: 'stale', iso };
}

const LAST_LOGIN_TONE = {
  fresh:  { bg: '#e8f5e3', color: '#29811e' }, // green — active user
  recent: { bg: '#e8f0fe', color: '#1f74b3' }, // blue — logged in this week
  stale:  { bg: '#f7f5f2', color: '#616161' }, // grey — hasn't been here in a while
  never:  { bg: '#ffe2de', color: '#d42d35' }, // red — never signed in
};

// ── Parental Leave mock data ────────────────────────────────────────────────
const PARENTAL_LEAVE_DATA=[
  {id:'pl-1',name:'Sophie Muller',    country:'DE',region:'EMEA',type:'Maternity',startDate:'2026-01-15',endDate:'2026-07-15',status:'Active',   handover:'Complete'},
  {id:'pl-2',name:'James Okafor',     country:'DE',region:'EMEA',type:'Paternity',startDate:'2026-04-01',endDate:'2026-04-28',status:'Upcoming', handover:'Pending'},
  {id:'pl-3',name:'Mei Lin',          country:'SG',region:'APAC',type:'Maternity',startDate:'2025-12-01',endDate:'2026-03-28',status:'Returning soon',handover:'Complete'},
  {id:'pl-4',name:'Charlotte Dubois', country:'FR',region:'EMEA',type:'Maternity',startDate:'2025-09-10',endDate:'2026-03-10',status:'Returned', handover:'Complete'},
  {id:'pl-5',name:'Tom Walsh',        country:'FR',region:'EMEA',type:'Paternity',startDate:'2026-05-12',endDate:'2026-06-09',status:'Upcoming', handover:'Pending'},
  {id:'pl-6',name:'Yuki Tanaka',      country:'AU',region:'APAC',type:'Maternity',startDate:'2026-02-01',endDate:'2026-08-01',status:'Active',   handover:'Complete'},
  {id:'pl-7',name:'Lena Schmidt',     country:'DE',region:'EMEA',type:'Maternity',startDate:'2025-11-20',endDate:'2026-04-05',status:'Returning soon',handover:'Pending'},
  {id:'pl-8',name:'Anika Patel',      country:'UK',region:'EMEA',type:'Maternity',startDate:'2026-06-01',endDate:'2026-12-01',status:'Upcoming', handover:'Pending'},
];

const PL_STATUS_COLORS={
  'Upcoming':     {bg:'#e8f0fe',color:'#1f74b3'},
  'Active':       {bg:'#f3eff8',color:'#7c3aed'},
  'Returning soon':{bg:'#fff8e6',color:'#ed8d00'},
  'Returned':     {bg:'#e8f5e3',color:'#29811e'},
};

const REGIONS = [
  { id:'all',        label:'All Regions' },
  { id:'EMEA',       label:'EMEA' },
  { id:'APAC',       label:'APAC' },
  { id:'LATAM',      label:'LATAM' },
  { id:'NAM',        label:'NAM' },
  { id:'LATAM + NAM',label:'LATAM + NAM' },
];

const ACCESS_BADGE = {
  admin:            { label:'Admin',        bg:'#ffe2de', color:'#d42d35' },
  regional_manager: { label:'Regional Mgr', bg:'#e8f0fe', color:'#1f74b3' },
  team_lead:        { label:'Team Lead',    bg:'#f3eff8', color:'#7c3aed' },
  agent:            { label:'Agent',        bg:'#f7f5f2', color:'#616161' },
};

const TEAM_OPTIONS = ['All', 'EMEA', 'APAC', 'LATAM', 'NAM', 'LATAM + NAM'];
const ROLE_OPTIONS = ['agent', 'team_lead', 'regional_manager', 'admin'];
const REGION_OPTIONS = ['EMEA', 'APAC', 'LATAM', 'NAM', 'LATAM + NAM'];
const SERVICE_OPTIONS = ['EOR', 'LifeCycle', 'New Services', 'All'];

const EMPTY_FORM = {
  name: '',
  email: '',
  team: 'EMEA',
  role: 'agent',
  region: 'EMEA',
  country: '',
  managerEmail: '',
  service: 'EOR',
  title: 'HR Experience Specialist',
};

// Shape for the Edit Allocation modal — prefilled from the member being edited.
const EMPTY_ALLOC = {
  name: '',
  title: '',
  team: '',
  role: '',
  region: '',
  country: '',
  managerEmail: '',
  service: '',
};

const Team = ({ user, tasks, setTask, setView, realUser, onImpersonate, impersonating }) => {
  const [expanded, setExpanded] = useState(new Set());
  const [regionFilter, setRegionFilter] = useState('all');
  const [eodOpen, setEodOpen] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const [hoveredRow, setHoveredRow] = useState(null);
  const [showParentalLeave, setShowParentalLeave] = useState(false);

  // ── Team-member roster (persisted via useTeamMembers hook) ───────────────
  // The hook handles: fetching the merged baseline+overrides list, optimistic
  // local mutations, and reconciliation with /api/v1/team-members. Any edit
  // here survives reloads and pod restarts (zero data loss, per the Apr-2026
  // Team-tab overhaul).
  const {
    members: localMembers,
    membersByEmail: localMembersByEmail,
    getDirectReports: localGetDirectReports,
    getAllReports: localGetAllReports,
    loading: rosterLoading,
    addMember,
    updateMember,
    removeMember,
    toggleOnLeave,
    setCountries,
  } = useTeamMembers();

  // ── Deel-source breach inputs for the per-agent SLA dot ──────────────────
  // Mounting these hooks here lets `slaHealth(email)` cover Onboarding,
  // Offboarding and Workbench breaches in addition to ticket breaches —
  // matching what the agent sees in the Queue. Amendments/Redlines have
  // no per-agent assignee on the upstream payload, so they're not
  // attributable to a single agent and stay out of this calc.
  const teamOnbData = useOnboardingData(true);
  const teamOffData = useOffboardingData(true);
  const teamWbData = useWorkbenchData(true);
  const { sla: teamQueueSla } = useQueueSlaSettings();
  const onbAgentRows = useMemo(() => normalizeOnboarding(teamOnbData.items, teamQueueSla), [teamOnbData.items, teamQueueSla]);
  const offAgentRows = useMemo(() => normalizeOffboarding(teamOffData.items, teamQueueSla), [teamOffData.items, teamQueueSla]);
  const wbAgentRows  = useMemo(() => normalizeWorkbench(teamWbData.tasks, teamQueueSla), [teamWbData.tasks, teamQueueSla]);

  // UI state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM });
  const [addError, setAddError] = useState(null);
  const [addSaving, setAddSaving] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(null); // email of member whose menu is open
  const [editAllocEmail, setEditAllocEmail] = useState(null); // email of member being re-allocated (modal)
  const [permsModalEmail, setPermsModalEmail] = useState(null); // email of member whose permissions modal is open
  const [permsDraft, setPermsDraft] = useState({ isAnnouncementsAdmin: false, isAccessAdmin: false });
  const [permsSaving, setPermsSaving] = useState(false);
  const [permsError, setPermsError] = useState(null);
  const [allocForm, setAllocForm] = useState({ ...EMPTY_ALLOC });
  const [allocError, setAllocError] = useState(null);
  const [allocSaving, setAllocSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);   // email of member pending removal
  const [removeSaving, setRemoveSaving] = useState(false);
  const actionMenuRef = useRef(null);

  // Close action menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target)) {
        setActionMenuOpen(null);
      }
    };
    if (actionMenuOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [actionMenuOpen]);

  // ── Add Member handler ──────────────────────────────────────────────────
  const handleAddMember = async () => {
    const name = addForm.name.trim();
    const email = addForm.email.trim().toLowerCase();
    if (!name || !email) return;
    if (!email.endsWith('@deel.com')) {
      setAddError('Email must be a valid @deel.com address.');
      return;
    }
    setAddError(null);
    setAddSaving(true);
    const result = await addMember({
      email,
      name,
      title: addForm.title.trim() || 'HR Experience Specialist',
      access: addForm.role,
      team: addForm.team === 'All' ? null : addForm.team,
      region: addForm.region,
      service: addForm.service,
      country: addForm.country.trim() || null,
      managerEmail: addForm.managerEmail.trim().toLowerCase() || null,
    });
    setAddSaving(false);
    if (!result.ok) {
      setAddError(result.error || 'Failed to add member.');
      return;
    }
    setAddForm({ ...EMPTY_FORM });
    setShowAddModal(false);
  };

  // ── Edit Allocation — open modal prefilled from the target member ─────
  const openEditAllocation = (email) => {
    const m = localMembersByEmail[email.toLowerCase()];
    if (!m) return;
    setAllocForm({
      name: m.name || '',
      title: m.title || '',
      team: m.team || '',
      role: m.access || 'agent',
      region: m.region || m.team || 'EMEA',
      country: m.country || '',
      managerEmail: m.managerEmail || '',
      service: m.service || 'EOR',
    });
    setAllocError(null);
    setEditAllocEmail(email);
    setActionMenuOpen(null);
  };

  const handleSaveAllocation = async () => {
    if (!editAllocEmail) return;
    setAllocSaving(true);
    setAllocError(null);

    // Build a patch body — every field is editable. Empty country is sent as null
    // so the DB clears it; other fields pass through verbatim.
    const patch = {
      name: allocForm.name.trim() || null,
      title: allocForm.title.trim() || null,
      team: allocForm.team === 'All' ? null : allocForm.team || null,
      access: allocForm.role || 'agent',
      region: allocForm.region || null,
      country: allocForm.country.trim() || null,
      managerEmail: allocForm.managerEmail.trim().toLowerCase() || null,
      service: allocForm.service || null,
    };

    const result = await updateMember(editAllocEmail, patch);
    setAllocSaving(false);
    if (!result.ok) {
      setAllocError(result.error || 'Failed to save allocation.');
      return;
    }
    setEditAllocEmail(null);
    setAllocForm({ ...EMPTY_ALLOC });
  };

  // ── Toggle on-leave (persisted) ────────────────────────────────────────
  const handleToggleLeave = async (email) => {
    setActionMenuOpen(null);
    await toggleOnLeave(email);
  };

  // ── Manage per-user permissions ────────────────────────────────────────
  // Two additive capabilities, each orthogonal to the four-tier access model:
  //   • Announcements Admin — full announcement workflow (compose / approve /
  //     archive / override / send-reminder).
  //   • Access Admin — add / edit / remove team members + grant other per-
  //     user permissions. Lets a Director delegate roster maintenance
  //     without escalating someone's primary tier to regional_manager.
  // Both saved via the same /api/v1/team-members/:email PATCH that handles
  // allocation edits.
  const openPermissionsModal = (email) => {
    const member = localMembersByEmail[email];
    setPermsDraft({
      isAnnouncementsAdmin: member?.isAnnouncementsAdmin === true,
      isAccessAdmin: member?.isAccessAdmin === true,
    });
    setPermsError(null);
    setPermsModalEmail(email);
    setActionMenuOpen(null);
  };
  const closePermissionsModal = () => {
    setPermsModalEmail(null);
    setPermsDraft({ isAnnouncementsAdmin: false, isAccessAdmin: false });
    setPermsError(null);
  };
  const handleSavePermissions = async () => {
    if (!permsModalEmail) return;
    setPermsSaving(true);
    setPermsError(null);
    try {
      const ok = await updateMember(permsModalEmail, {
        isAnnouncementsAdmin: !!permsDraft.isAnnouncementsAdmin,
        isAccessAdmin: !!permsDraft.isAccessAdmin,
      });
      if (ok && ok.ok !== false) closePermissionsModal();
      else setPermsError(ok?.error || 'Save failed');
    } catch (e) {
      setPermsError(e?.message || 'Save failed');
    } finally {
      setPermsSaving(false);
    }
  };

  // ── Remove member (persisted soft-delete for baseline, hard-delete new) ─
  const handleRemoveMember = async (email) => {
    setRemoveSaving(true);
    const result = await removeMember(email);
    setRemoveSaving(false);
    if (result.ok) {
      setConfirmRemove(null);
      setActionMenuOpen(null);
    }
  };

  const perms = useContext(PermissionsContext);
  const { deelData } = useContext(IntegrationsContext);
  const isAdmin = perms?.dataScope === 'all_tasks';
  // Roster mutation gate — admin / regional_manager / per-user Access Admin
  // grant. Mirrors the server-side canManageRoster() in src/lib/access-admin.
  // When false we hide the Add Member button + the per-row actions menu so
  // we don't bait Team Leads into clicks that the server would just 403.
  const canManageRoster = perms?.canManageRoster === true;
  // Country-ownership editing is broader than roster mutations: TLs are
  // expected to maintain their team's country coverage themselves, even
  // though they can't add or remove members. Mirrors the server-side
  // canEditCountries() in app/api/v1/team-members/[email]/countries/route.js.
  const canEditCountries = (
    perms?.dataScope === 'all_tasks'
    || perms?.dataScope === 'regional_tasks'
    || perms?.dataScope === 'team_tasks'
    || canManageRoster
  );

  // Non-slack tasks for stats
  const ns = useMemo(() => tasks.filter(t => t.source !== 'slack'), [tasks]);

  // ── Stat helpers (email-based) ──────────────────────────────────────────
  const statsByEmails = (emails) => {
    const emailSet = new Set(emails.map(e => e.toLowerCase()));
    const ts = ns.filter(t => emailSet.has((t.assigneeEmail || '').toLowerCase()) && t.status !== 'resolved');
    return {
      total: ts.length,
      n: ts.filter(t => t.status === 'new').length,
      ip: ts.filter(t => t.status === 'in_progress').length,
      w: ts.filter(t => t.status === 'waiting').length,
    };
  };

  // SLA health for an agent email — combines tickets (ZD/Jira via slaInfo)
  // with the agent's onboarding / offboarding / workbench Deel rows
  // (slaBreachStatus from normalizeSourceRows). Amendments + Redlines have
  // no per-agent assignee on the upstream so they're not included here —
  // a footer note in the SLA card explains that.
  const slaHealth = (email) => {
    const e = email.toLowerCase();
    const agentTasks = ns.filter(t => (t.assigneeEmail || '').toLowerCase() === e && t.status !== 'resolved');
    const agentOnb = onbAgentRows.filter(r => (r.assigneeEmail || '').toLowerCase() === e);
    const agentOff = offAgentRows.filter(r => (r.assigneeEmail || '').toLowerCase() === e);
    const agentWb  = wbAgentRows.filter(r => (r.assigneeEmail || '').toLowerCase() === e);
    if (agentTasks.length === 0 && agentOnb.length === 0 && agentOff.length === 0 && agentWb.length === 0) {
      return 'green';
    }
    const ticketBreached = agentTasks.some(t => { const s = slaInfo(t); return (s && s.breach) || t.isAlert; });
    const deelBreached = [...agentOnb, ...agentOff, ...agentWb].some(r => r.slaBreachStatus === 'SLA_BREACHED');
    if (ticketBreached || deelBreached) return 'red';
    const ticketAtRisk = agentTasks.some(t => { const s = slaInfo(t); return s && !s.ok && !s.breach; });
    const deelAtRisk = [...agentOnb, ...agentOff, ...agentWb].some(r => {
      if (r.slaBreachStatus === 'SLA_BREACHED' || typeof r.slaRemaining !== 'number' || r.slaRemaining <= 0) return false;
      const windowSec = Number.isFinite(r.slaWindowMs) && r.slaWindowMs > 0 ? r.slaWindowMs / 1000 : 24*60*60;
      return r.slaRemaining < windowSec / 4;
    });
    if (ticketAtRisk || deelAtRisk) return 'yellow';
    return 'green';
  };

  const slaDot = (health) => {
    const color = health === 'red' ? 'var(--red-solid, #dc2626)' : health === 'yellow' ? 'var(--orange-solid, #d97706)' : 'var(--green-solid, #16a34a)';
    const statusLabel = health === 'red' ? 'SLA Breached' : health === 'yellow' ? '1-2 at risk' : 'Healthy';
    return <span title={statusLabel} style={{ width: 10, height: 10, borderRadius: 5, background: color, display: 'inline-block', flexShrink: 0 }} />;
  };

  const toggle = id => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Build hierarchy tree from current user ──────────────────────────────
  // Get direct reports of the effective user
  const userEmail = (user?.email || '').toLowerCase();
  const userMember = localMembersByEmail[userEmail];

  // For the "Login as" feature: who can be impersonated
  const realUserEmail = (realUser?.email || '').toLowerCase();
  const realUserMember = localMembersByEmail[realUserEmail];
  const realUserAllReports = useMemo(() => {
    if (!realUserMember) return new Set();
    if (['admin', 'regional_manager', 'team_lead'].includes(realUserMember.access)) {
      return new Set(localGetAllReports(realUserEmail));
    }
    return new Set();
  }, [realUserEmail, realUserMember, localGetAllReports]);

  const canLoginAs = (targetEmail) => {
    if (!realUserMember) return false;
    if (!['admin', 'regional_manager', 'team_lead'].includes(realUserMember.access)) return false;
    const te = targetEmail.toLowerCase();
    if (te === (impersonating || '').toLowerCase()) return false;
    // Don't offer Login-as on deleted/deactivated members — impersonating
    // them would load a permissions context we explicitly revoked.
    const target = localMembersByEmail[te];
    if (!target || target.isDeleted) return false;
    return realUserAllReports.has(te);
  };

  // Build the tree of people to display
  const visibleMembers = useMemo(() => {
    if (!userMember) return [];
    let directReports = localGetDirectReports(userEmail);

    // Apply region filter
    if (regionFilter !== 'all') {
      directReports = directReports.filter(m => {
        if (regionFilter === 'LATAM + NAM') return m.team === 'LATAM + NAM' || m.team === 'LATAM' || m.team === 'NAM';
        return m.team === regionFilter;
      });
    }
    return directReports;
  }, [userEmail, userMember, regionFilter, localGetDirectReports]);

  // Compute overall stats for KPI cards — user + all emails under them
  const allReportEmails = useMemo(() => [userEmail, ...localGetAllReports(userEmail)], [userEmail, localGetAllReports]);
  const ov = useMemo(() => statsByEmails(allReportEmails), [allReportEmails, ns]);

  // Manager picker options — anyone whose access puts them above "agent".
  // Sorted alphabetically by name for a predictable dropdown. Includes admins
  // so the top-of-org managers can be selected too.
  const managerOptions = useMemo(() => {
    const eligible = localMembers.filter(m => ['admin', 'regional_manager', 'team_lead'].includes(m.access));
    return [...eligible].sort((a, b) => a.name.localeCompare(b.name));
  }, [localMembers]);

  // EOD summary
  const resolvedToday = tasks.filter(t => t.status === 'resolved').length;
  const stillOpen = tasks.filter(t => t.status !== 'resolved').length;
  const slaBreached = tasks.filter(t => { const s = slaInfo(t); return (s && s.breach) || t.isAlert; }).length;
  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const copySummary = () => {
    const text = `Team EOD Report - ${dateStr}\nResolved: ${resolvedToday} | Open: ${stillOpen} | Breached: ${slaBreached}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    }).catch(() => {});
  };

  // ── Render a member row ─────────────────────────────────────────────────
  const renderMemberRow = (member, depth = 0) => {
    const email = member.email;
    const subReports = localGetDirectReports(email);
    const hasSubReports = subReports.length > 0;
    const isExpanded = expanded.has(email);
    const isManager = hasSubReports;
    const badge = ACCESS_BADGE[member.access] || ACCESS_BADGE.agent;
    const isHovered = hoveredRow === email;
    const isOnLeave = member.onLeave === true;
    const lastLogin = formatLastLogin(member.lastLoginAt);
    const lastLoginTone = LAST_LOGIN_TONE[lastLogin.tone] || LAST_LOGIN_TONE.never;

    // Stats: for managers, aggregate self + all reports; for agents, just self
    const reportEmails = hasSubReports ? [email, ...localGetAllReports(email)] : [email];
    const s = statsByEmails(reportEmails);
    const health = slaHealth(email);

    // Region filter for sub-reports
    let filteredSubReports = subReports;
    if (regionFilter !== 'all') {
      filteredSubReports = subReports.filter(m => {
        if (regionFilter === 'LATAM + NAM') return m.team === 'LATAM + NAM' || m.team === 'LATAM' || m.team === 'NAM';
        return m.team === regionFilter;
      });
    }

    const showLoginAs = canLoginAs(email) && onImpersonate;
    const isMenuOpen = actionMenuOpen === email;

    return (
      <div key={email}>
        {/* Main row */}
        <div
          onClick={() => isManager && toggle(email)}
          style={{
            padding: '12px 16px',
            minHeight: 48,
            borderBottom: '1px solid #f2f2f2',
            display: 'grid',
            gridTemplateColumns: '1fr 56px 150px 64px 64px 64px 64px 80px 32px',
            gap: 8,
            alignItems: 'center',
            cursor: isManager ? 'pointer' : 'default',
            background: isManager
              ? (isExpanded ? '#f9f8f6' : (isHovered ? '#f9f8f6' : 'white'))
              : (isHovered ? '#fafaf9' : depth > 0 ? '#fafaf9' : 'white'),
            transition: 'background 0.1s',
            position: 'relative',
          }}
          onMouseEnter={e => { if (isManager) e.currentTarget.style.background = '#f9f8f6'; setHoveredRow(email); }}
          onMouseLeave={e => { if (isManager) e.currentTarget.style.background = isExpanded ? '#f9f8f6' : 'white'; else if (depth > 0) e.currentTarget.style.background = '#fafaf9'; else e.currentTarget.style.background = 'white'; setHoveredRow(null); }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: depth > 0 ? 7 : 10, paddingLeft: depth > 0 ? 24 * depth : 0 }}>
            {depth > 0 && <div style={{ width: 1, height: 18, background: '#e8e8e8', marginRight: 7 }} />}
            <Avatar name={member.name} initials={member.initials} size={isManager ? 30 : 24} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: isManager ? 700 : 500, color: '#1b1b1b', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {member.name}
                <span style={{ background: badge.bg, color: badge.color, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 128 }}>{badge.label}</span>
                {/* Last-login pill. While the roster is still loading and we
                    have no cached value for this row, render a shimmer so
                    we don't flash a misleading "Never logged in" badge on
                    every member during the initial fetch. */}
                {rosterLoading && !member.lastLoginAt ? (
                  <span
                    title="Loading last login…"
                    style={{
                      background: '#f5f4f2',
                      color: '#9e9e9e',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 128,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <i className="bi-arrow-clockwise spin" style={{ fontSize: 9 }} />
                    Loading…
                  </span>
                ) : (
                  <span
                    title={lastLogin.iso ? `Last login: ${new Date(lastLogin.iso).toLocaleString()}` : 'This user has never signed in to Ops Hub'}
                    style={{
                      background: lastLoginTone.bg,
                      color: lastLoginTone.color,
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 128,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <i className={lastLogin.tone === 'never' ? 'bi-person-slash' : 'bi-clock-history'} style={{ fontSize: 9 }} />
                    {lastLogin.tone === 'never' ? 'Never logged in' : lastLogin.label}
                  </span>
                )}
                {member.isAnnouncementsAdmin && (
                  <span
                    title="This user has the Announcements Admin permission — full control over the announcement workflow (compose, approve, archive, override, send acknowledgements)."
                    style={{
                      background: '#f3eff8', color: '#7c3aed',
                      fontSize: 10, fontWeight: 700,
                      padding: '2px 8px', borderRadius: 128,
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <i className="bi-megaphone-fill" style={{ fontSize: 9 }} />
                    Announcements Admin
                  </span>
                )}
                {member.isAccessAdmin && (
                  <span
                    title="This user has the Access Admin permission — can add / edit / remove team members and grant other per-user permissions."
                    style={{
                      background: '#e8f0fe', color: '#0369a1',
                      fontSize: 10, fontWeight: 700,
                      padding: '2px 8px', borderRadius: 128,
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <i className="bi-shield-lock-fill" style={{ fontSize: 9 }} />
                    Access Admin
                  </span>
                )}
                {isOnLeave && (
                  <span style={{ background: '#fff8e6', color: '#ed8d00', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 128 }}>On Leave</span>
                )}
                {isManager && (
                  <span style={{ fontSize: 10, color: '#9e9e9e', fontWeight: 500 }}>
                    {subReports.length} report{subReports.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: '#616161', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {member.title}
              </div>
            </div>
            {isManager && (
              <i className={`bi-chevron-${isExpanded ? 'up' : 'down'}`} style={{ fontSize: 11, color: '#9e9e9e', marginLeft: 4, flexShrink: 0 }} />
            )}
            {showLoginAs && (
              <button
                onClick={(e) => { e.stopPropagation(); onImpersonate(email); }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 10px', borderRadius: 128,
                  border: '1px solid #7c3aed33',
                  background: '#7c3aed',
                  color: 'white',
                  fontSize: 10, fontWeight: 700,
                  cursor: 'pointer', flexShrink: 0,
                  transition: 'all .15s',
                  whiteSpace: 'nowrap',
                  opacity: isHovered ? 1 : 0.75,
                }}
                title={`Login as ${member.name}`}
              >
                <i className="bi-box-arrow-in-right" style={{ fontSize: 10 }} />
                Login as
              </button>
            )}
          </div>
          {/* Team badge (click the three-dot menu → Edit Allocation to change) */}
          <span style={{ textAlign: 'center', fontSize: 11, color: '#616161', background: '#f7f5f2', borderRadius: 128, padding: '2px 8px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {member.team || '—'}
          </span>
          {/* Countries — multi-select picker. Saves immediately on Save
              click; Queue scoping picks up the change on the next refresh
              because hydrateOwnerCountries fires from useTeamMembers. */}
          <div
            style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minWidth: 0 }}
            onClick={e => e.stopPropagation()}
          >
            <MultiCountryPicker
              selected={member.countries || []}
              canEdit={canEditCountries}
              size="sm"
              onSave={async (next) => setCountries(email, next)}
            />
          </div>
          <span style={{ textAlign: 'center', fontSize: isManager ? 15 : 14, fontWeight: isManager ? 700 : 600, color: '#1b1b1b', fontVariantNumeric: 'tabular-nums' }}>{s.total}</span>
          <span style={{ textAlign: 'center', fontSize: isManager ? 14 : 13, fontWeight: isManager ? 600 : 500, color: '#1f74b3', fontVariantNumeric: 'tabular-nums' }}>{s.n}</span>
          <span style={{ textAlign: 'center', fontSize: isManager ? 14 : 13, fontWeight: isManager ? 600 : 500, color: '#ed8d00', fontVariantNumeric: 'tabular-nums' }}>{s.ip}</span>
          <span style={{ textAlign: 'center', fontSize: isManager ? 14 : 13, fontWeight: isManager ? 600 : 500, color: '#9e9e9e', fontVariantNumeric: 'tabular-nums' }}>{s.w}</span>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            {slaDot(health)}
            <span style={{ fontSize: 10, color: health === 'red' ? '#d42d35' : health === 'yellow' ? '#ed8d00' : '#29811e', fontWeight: 600 }}>
              {health === 'red' ? 'Breached' : health === 'yellow' ? 'At Risk' : 'Healthy'}
            </span>
          </div>

          {/* Action menu (three dots) — visible only to roster managers so
              users without permission don't get baited into 403-ing clicks. */}
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }} onClick={e => e.stopPropagation()}>
            {canManageRoster && (
            <button
              onClick={() => setActionMenuOpen(isMenuOpen ? null : email)}
              style={{
                width: 24, height: 24, borderRadius: 6, border: 'none',
                background: isMenuOpen ? '#f3eff8' : (isHovered ? '#f7f5f2' : 'transparent'),
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#616161', fontSize: 13, transition: 'background .1s',
                opacity: isHovered || isMenuOpen ? 1 : 0,
              }}
              title="Actions"
            >
              <i className="bi-three-dots-vertical" />
            </button>
            )}
            {canManageRoster && isMenuOpen && (
              <div
                ref={actionMenuRef}
                style={{
                  position: 'absolute', top: 28, right: 0, zIndex: 100,
                  background: 'white', border: '1px solid #e8e8e8', borderRadius: 10,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.10)', minWidth: 160,
                  padding: '4px 0', overflow: 'hidden',
                }}
              >
                <button
                  onClick={() => openEditAllocation(email)}
                  style={{
                    width: '100%', padding: '8px 14px', border: 'none', background: 'transparent',
                    fontSize: 12, fontWeight: 500, color: '#1b1b1b', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f9f8f6'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <i className="bi-sliders" style={{ fontSize: 12, color: '#7c3aed' }} />
                  Edit Allocation
                </button>
                <button
                  onClick={() => handleToggleLeave(email)}
                  style={{
                    width: '100%', padding: '8px 14px', border: 'none', background: 'transparent',
                    fontSize: 12, fontWeight: 500, color: '#1b1b1b', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f9f8f6'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <i className={isOnLeave ? 'bi-person-check' : 'bi-calendar-x'} style={{ fontSize: 12, color: '#ed8d00' }} />
                  {isOnLeave ? 'End Leave' : 'Set On Leave'}
                </button>
                {/* Manage permissions — gated on the same canManageRoster
                    flag as the PATCH route (admin / regional_manager / per-
                    user Access Admin). Hidden for everyone else. */}
                {canManageRoster && (
                  <button
                    onClick={() => openPermissionsModal(email)}
                    style={{
                      width: '100%', padding: '8px 14px', border: 'none', background: 'transparent',
                      fontSize: 12, fontWeight: 500, color: '#1b1b1b', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f9f8f6'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <i className="bi-shield-lock" style={{ fontSize: 12, color: '#7c3aed' }} />
                    Manage permissions
                  </button>
                )}
                <div style={{ height: 1, background: '#f2f2f2', margin: '2px 0' }} />
                <button
                  onClick={() => setConfirmRemove(email)}
                  style={{
                    width: '100%', padding: '8px 14px', border: 'none', background: 'transparent',
                    fontSize: 12, fontWeight: 500, color: '#d42d35', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fff5f5'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <i className="bi-person-x" style={{ fontSize: 12 }} />
                  Remove
                </button>
              </div>
            )}

            {/* Confirm remove dialog */}
            {confirmRemove === email && (
              <div
                style={{
                  position: 'absolute', top: 28, right: 0, zIndex: 110,
                  background: 'white', border: '1px solid #e8e8e8', borderRadius: 10,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 200,
                  padding: '14px 16px',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1b1b1b', marginBottom: 6 }}>Remove {member.name}?</div>
                <div style={{ fontSize: 11, color: '#616161', marginBottom: 12 }}>This will remove them from the team list.</div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setConfirmRemove(null)}
                    style={{
                      padding: '4px 12px', borderRadius: 128, border: '1px solid #e8e8e8',
                      background: 'white', fontSize: 11, fontWeight: 600, color: '#616161', cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleRemoveMember(email)}
                    disabled={removeSaving}
                    style={{
                      padding: '4px 12px', borderRadius: 128, border: 'none',
                      background: removeSaving ? '#e8e8e8' : '#d42d35', fontSize: 11, fontWeight: 700,
                      color: removeSaving ? '#9e9e9e' : 'white',
                      cursor: removeSaving ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {removeSaving ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Expandable sub-reports */}
        {isManager && (
          <div style={{ maxHeight: isExpanded ? '9999px' : 0, overflow: 'hidden', transition: isExpanded ? 'max-height 0.4s ease-in' : 'max-height 0.25s ease-out' }}>
            {filteredSubReports.map(sub => renderMemberRow(sub, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
      <PageHeader
        icon={isAdmin ? 'bi-building' : 'bi-people-fill'}
        iconBg="#f3eff8"
        iconColor="#1f74b3"
        title={isAdmin ? 'All Teams Overview' : 'My Team'}
        subtitle="Click a manager to expand their reports"
        right={impersonating && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 128, background: '#f3eff8', border: '1px solid #7c3aed33' }}>
            <i className="bi-person-badge" style={{ color: '#7c3aed', fontSize: 13 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#7c3aed' }}>
              Viewing as {localMembersByEmail[impersonating.toLowerCase()]?.name || impersonating}
            </span>
            <button
              onClick={() => onImpersonate && onImpersonate(null)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 128, border: '1px solid #7c3aed', background: '#7c3aed', color: 'white', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
            >
              <i className="bi-x-lg" style={{ fontSize: 9 }} /> Exit
            </button>
          </div>
        )}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        {/* Deel API Connected banner */}
        {deelData?.isAvailable && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', marginBottom: 14, fontSize: 12 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
            <span style={{ fontWeight: 600, color: '#16a34a' }}>Deel API Connected</span>
            <span style={{ color: '#616161' }}>
              — {Array.isArray(deelData.people) ? deelData.people.length : 0} workers, {Array.isArray(deelData.timeOff) ? deelData.timeOff.length : 0} time-off requests
            </span>
          </div>
        )}

        {/* Region filter + Add Member button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {(isAdmin || (userMember && userMember.access === 'regional_manager')) && (
            <div style={{ display: 'flex', background: '#f7f5f2', borderRadius: 128, padding: 3, gap: 2, width: 'fit-content', flexWrap: 'wrap' }}>
              {REGIONS.map(r => {
                const active = regionFilter === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => setRegionFilter(r.id)}
                    style={{
                      padding: '5px 14px', borderRadius: 128, border: 'none',
                      background: active ? 'white' : 'transparent',
                      color: active ? '#1b1b1b' : '#616161',
                      fontSize: 12, fontWeight: active ? 700 : 500,
                      cursor: 'pointer',
                      boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : undefined,
                      transition: 'all .15s',
                    }}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          )}
          {canManageRoster && (
            <button
              onClick={() => setShowAddModal(true)}
              style={{
                padding: '5px 14px', borderRadius: 128,
                border: '1px solid #e8e8e8',
                background: 'white',
                color: '#1b1b1b',
                fontSize: 12, fontWeight: 600,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5,
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                transition: 'all .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#f9f8f6'; e.currentTarget.style.borderColor = '#d0d0d0'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#e8e8e8'; }}
            >
              <i className="bi-plus" style={{ fontSize: 13, fontWeight: 700 }} />
              Add Member
            </button>
          )}
          {/* Country-ownership audit export. Lets anyone with read access
              download a CSV of the current allocation so they can compare
              it against the Deel "Countries by Person Role" spreadsheet
              and spot members with no countries (or duplicate ownership).
              The endpoint is HTTP-cookie-authed so a regular <a> works
              and the browser handles the download correctly. */}
          <a
            href="/api/v1/team-members/countries/export"
            download
            title="Download a CSV of every team member with the countries they own — useful for comparing against the Deel Countries by Person Role sheet."
            style={{
              padding: '5px 14px', borderRadius: 128,
              border: '1px solid #e8e8e8',
              background: 'white',
              color: '#1b1b1b',
              fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 5,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              transition: 'all .15s',
              textDecoration: 'none',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f9f8f6'; e.currentTarget.style.borderColor = '#d0d0d0'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#e8e8e8'; }}
          >
            <i className="bi-download" style={{ fontSize: 12 }} />
            Export Country Ownership
          </a>
        </div>

        {/* KPI cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 22 }}>
          {[
            { l: 'Total Open', v: ov.total, c: '#1b1b1b', icon: 'bi-inbox', bg: '#f7f5f2' },
            { l: 'New', v: ov.n, c: '#1f74b3', icon: 'bi-plus-circle', bg: '#e8f0fe' },
            { l: 'In Progress', v: ov.ip, c: '#ed8d00', icon: 'bi-arrow-repeat', bg: '#fff8e6' },
            { l: 'Alerts', v: tasks.filter(t => t.isAlert && t.status !== 'resolved').length, c: '#d42d35', icon: 'bi-exclamation-triangle-fill', bg: '#ffe2de' },
          ].map(s => (
            <div
              key={s.l}
              style={{
                background: 'var(--surface, white)',
                border: '1px solid var(--border, #e8e8e8)',
                borderRadius: 'var(--radius-2xl)',
                padding: 'var(--space-5)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                transition: 'box-shadow .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'}
            >
              <div style={{ width: 40, height: 40, background: s.bg, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <i className={s.icon} style={{ color: s.c, fontSize: 17 }} />
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: s.c, fontVariantNumeric: 'tabular-nums' }}>{s.v}</div>
              <div style={{ fontSize: 12, color: '#616161', marginTop: 2, fontWeight: 500 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Team table */}
        <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e8e8e8', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div role="row" style={{ padding: '12px 16px', borderBottom: '1px solid #f2f2f2', display: 'grid', gridTemplateColumns: '1fr 56px 150px 64px 64px 64px 64px 80px 32px', gap: 8, background: '#fafaf9' }}>
            {['Manager / Agent', 'Team', 'Countries', 'Open', 'New', 'In prog', 'Pause', 'Health', ''].map((h, i) => (
              <span
                key={h || `col-${i}`}
                role="columnheader"
                style={{ color: 'var(--text-muted, #9e9e9e)', fontSize: 13, fontWeight: 500, textTransform: 'none', letterSpacing: 'normal', textAlign: h === 'Manager / Agent' ? 'left' : 'center' }}
              >
                {h}
              </span>
            ))}
          </div>
          {visibleMembers.length === 0 && (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9e9e9e' }}>
              <i className="bi-people" style={{ fontSize: 32, display: 'block', marginBottom: 12, opacity: 0.3 }} />
              <div style={{ fontSize: 14, fontWeight: 600 }}>No team members found</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Try adjusting the region filter above</div>
            </div>
          )}
          {visibleMembers.map(m => renderMemberRow(m, 0))}
        </div>

        {/* ── Parental Leave Tracker ──────────────────────────────────── */}
        {(() => {
          const plData = perms?.dataScope === 'all_tasks' && user?.region && user.region !== 'ALL'
            ? PARENTAL_LEAVE_DATA.filter(p => p.region === user.region)
            : PARENTAL_LEAVE_DATA;
          return (
            <div style={{ marginTop: 20, background: 'white', borderRadius: 16, border: '1px solid #e8e8e8', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div
                onClick={() => setShowParentalLeave(v => !v)}
                style={{
                  padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
                  background: showParentalLeave ? '#f9f8f6' : 'white', transition: 'background .1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#f9f8f6'}
                onMouseLeave={e => e.currentTarget.style.background = showParentalLeave ? '#f9f8f6' : 'white'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, background: '#ffe2ef', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="bi-heart" style={{ color: '#e0457b', fontSize: 14 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--font-base)', fontWeight: 600, color: '#1b1b1b', display: 'flex', alignItems: 'center', gap: 5 }}>Parental Leave Tracker</div>
                    <div style={{ fontSize: 11, color: '#9e9e9e' }}>{plData.filter(p => p.status === 'Active' || p.status === 'Returning soon').length} currently on leave</div>
                  </div>
                </div>
                <i className={`bi-chevron-${showParentalLeave ? 'up' : 'down'}`} style={{ fontSize: 12, color: '#9e9e9e' }} />
              </div>
              {showParentalLeave && (
                <div style={{ borderTop: '1px solid #f2f2f2', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#fafaf9' }}>
                        {['Employee', 'Country', 'Type', 'Start date', 'End date', 'Status', 'Handover'].map(h => (
                          <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 13, fontWeight: 500, color: '#9e9e9e', textTransform: 'none', letterSpacing: 'normal', borderBottom: '1px solid #f2f2f2', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {plData.map((p, i) => {
                        const sc = PL_STATUS_COLORS[p.status] || PL_STATUS_COLORS['Upcoming'];
                        const isHandoverDone = p.handover === 'Complete';
                        return (
                          <tr
                            key={p.id}
                            style={{ borderBottom: i < plData.length - 1 ? '1px solid #f2f2f2' : 'none', transition: 'background .1s' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <td style={{ padding: '11px 16px', fontWeight: 600, color: '#1b1b1b', whiteSpace: 'nowrap' }}>{p.name}</td>
                            <td style={{ padding: '11px 16px', color: '#616161', whiteSpace: 'nowrap' }}>{FLAGS[p.country] || '\u{1F310}'} {p.country}</td>
                            <td style={{ padding: '11px 16px', color: '#616161', whiteSpace: 'nowrap' }}>{p.type}</td>
                            <td style={{ padding: '11px 16px', color: '#616161', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{p.startDate}</td>
                            <td style={{ padding: '11px 16px', color: '#616161', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{p.endDate}</td>
                            <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                              <span style={{ background: sc.bg, color: sc.color, padding: '3px 10px', borderRadius: 128, fontSize: 11, fontWeight: 700 }}>{p.status}</span>
                            </td>
                            <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                              <span style={{ color: isHandoverDone ? '#29811e' : '#ed8d00', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                                {isHandoverDone ? '\u2713 Complete' : '\u26A0 Pending'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}

        {/* End of Day Summary */}
        <div style={{ marginTop: 20, background: 'white', borderRadius: 16, border: '1px solid #e8e8e8', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div
            onClick={() => setEodOpen(v => !v)}
            style={{
              padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
              background: eodOpen ? '#f9f8f6' : 'white', transition: 'background .1s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#f9f8f6'}
            onMouseLeave={e => e.currentTarget.style.background = eodOpen ? '#f9f8f6' : 'white'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, background: '#fff8e6', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="bi-moon-stars-fill" style={{ color: '#ed8d00', fontSize: 14 }} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1b1b1b' }}>End of Day Summary</div>
                <div style={{ fontSize: 11, color: '#9e9e9e' }}>{dateStr}</div>
              </div>
            </div>
            <i className={`bi-chevron-${eodOpen ? 'up' : 'down'}`} style={{ fontSize: 12, color: '#9e9e9e' }} />
          </div>
          {eodOpen && (
            <div style={{ padding: '16px 20px', borderTop: '1px solid #f2f2f2' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 16 }}>
                {[
                  { l: 'Resolved Today', v: resolvedToday, c: '#29811e', icon: 'bi-check-circle-fill', bg: '#e8f5e3' },
                  { l: 'Still Open', v: stillOpen, c: '#ed8d00', icon: 'bi-clock-fill', bg: '#fff8e6' },
                  { l: 'SLA Breached', v: slaBreached, c: slaBreached > 0 ? '#d42d35' : '#29811e', icon: 'bi-exclamation-triangle-fill', bg: slaBreached > 0 ? '#ffe2de' : '#e8f5e3' },
                ].map(s => (
                  <div key={s.l} style={{ background: s.bg, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 32, height: 32, background: 'white', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                      <i className={s.icon} style={{ color: s.c, fontSize: 14 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: s.c, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.v}</div>
                      <div style={{ fontSize: 11, color: '#616161', marginTop: 2, fontWeight: 500 }}>{s.l}</div>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={copySummary}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 128,
                  border: '1px solid #e8e8e8',
                  background: copyDone ? '#e8f5e3' : 'white',
                  color: copyDone ? '#29811e' : '#1b1b1b',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .2s',
                }}
              >
                <i className={copyDone ? 'bi-check2' : 'bi-clipboard'} style={{ fontSize: 12 }} />
                {copyDone ? 'Copied!' : 'Copy Summary'}
              </button>
            </div>
          )}
        </div>

      </div>

      {/* ── Add Member Modal ────────────────────────────────────────────── */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setShowAddModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'white', borderRadius: 16, padding: '28px 32px',
              width: 420, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1b1b1b' }}>Add Team Member</div>
              <button
                onClick={() => setShowAddModal(false)}
                style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: '#f7f5f2', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#616161', fontSize: 14 }}
              >
                <i className="bi-x-lg" />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 'calc(90vh - 200px)', overflowY: 'auto' }}>
              {/* Name */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Name <span style={{ color: '#d42d35' }}>*</span></label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Full name"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                    fontSize: 13, color: '#1b1b1b', outline: 'none', boxSizing: 'border-box',
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = '#7c3aed'}
                  onBlur={e => e.currentTarget.style.borderColor = '#e8e8e8'}
                />
              </div>

              {/* Email */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Email <span style={{ color: '#d42d35' }}>*</span></label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="name@deel.com"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                    fontSize: 13, color: '#1b1b1b', outline: 'none', boxSizing: 'border-box',
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = '#7c3aed'}
                  onBlur={e => e.currentTarget.style.borderColor = '#e8e8e8'}
                />
              </div>

              {/* Title */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Job title</label>
                <input
                  type="text"
                  value={addForm.title}
                  onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. HR Experience Specialist"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                    fontSize: 13, color: '#1b1b1b', outline: 'none', boxSizing: 'border-box',
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = '#7c3aed'}
                  onBlur={e => e.currentTarget.style.borderColor = '#e8e8e8'}
                />
              </div>

              {/* Team + Role row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Team / section</label>
                  <select
                    value={addForm.team}
                    onChange={e => setAddForm(f => ({ ...f, team: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                      fontSize: 13, color: '#1b1b1b', background: 'white', cursor: 'pointer',
                    }}
                  >
                    {TEAM_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Role / access</label>
                  <select
                    value={addForm.role}
                    onChange={e => setAddForm(f => ({ ...f, role: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                      fontSize: 13, color: '#1b1b1b', background: 'white', cursor: 'pointer',
                    }}
                  >
                    {ROLE_OPTIONS.map(r => (
                      <option key={r} value={r}>{ACCESS_BADGE[r]?.label || r}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Manager + Service row (NEW: fixes "cannot assign manager" gap) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Manager</label>
                  <select
                    value={addForm.managerEmail}
                    onChange={e => setAddForm(f => ({ ...f, managerEmail: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                      fontSize: 13, color: '#1b1b1b', background: 'white', cursor: 'pointer',
                    }}
                  >
                    <option value="">— Select a manager —</option>
                    {managerOptions.map(m => (
                      <option key={m.email} value={m.email}>
                        {m.name} ({ACCESS_BADGE[m.access]?.label || m.access})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Service line</label>
                  <select
                    value={addForm.service}
                    onChange={e => setAddForm(f => ({ ...f, service: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                      fontSize: 13, color: '#1b1b1b', background: 'white', cursor: 'pointer',
                    }}
                  >
                    {SERVICE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Region + Country row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Region</label>
                  <select
                    value={addForm.region}
                    onChange={e => setAddForm(f => ({ ...f, region: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                      fontSize: 13, color: '#1b1b1b', background: 'white', cursor: 'pointer',
                    }}
                  >
                    {REGION_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Countries</label>
                  <input
                    type="text"
                    value={addForm.country}
                    onChange={e => setAddForm(f => ({ ...f, country: e.target.value }))}
                    placeholder="e.g. DE, US, SG"
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                      fontSize: 13, color: '#1b1b1b', outline: 'none', boxSizing: 'border-box',
                    }}
                    onFocus={e => e.currentTarget.style.borderColor = '#7c3aed'}
                    onBlur={e => e.currentTarget.style.borderColor = '#e8e8e8'}
                  />
                </div>
              </div>
            </div>

            {addError && (
              <div style={{ marginTop: 14, padding: '10px 14px', background: '#ffe2de', color: '#d42d35', borderRadius: 10, fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="bi-exclamation-triangle-fill" style={{ fontSize: 13 }} />
                {addError}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
              <button
                onClick={() => { setShowAddModal(false); setAddError(null); }}
                disabled={addSaving}
                style={{
                  padding: '8px 18px', borderRadius: 128, border: '1px solid #e8e8e8',
                  background: 'white', fontSize: 13, fontWeight: 600, color: '#616161',
                  cursor: addSaving ? 'not-allowed' : 'pointer',
                  opacity: addSaving ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddMember}
                disabled={!addForm.name.trim() || !addForm.email.trim() || addSaving}
                style={{
                  padding: '8px 18px', borderRadius: 128, border: 'none',
                  background: (!addForm.name.trim() || !addForm.email.trim() || addSaving) ? '#e8e8e8' : '#7c3aed',
                  fontSize: 13, fontWeight: 700,
                  color: (!addForm.name.trim() || !addForm.email.trim() || addSaving) ? '#9e9e9e' : 'white',
                  cursor: (!addForm.name.trim() || !addForm.email.trim() || addSaving) ? 'not-allowed' : 'pointer',
                  transition: 'all .15s',
                }}
              >
                {addSaving ? 'Adding…' : 'Add Member'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Allocation Modal (full-settings editor) ─────────────────── */}
      {editAllocEmail && (() => {
        const target = localMembersByEmail[editAllocEmail.toLowerCase()];
        if (!target) return null;
        return (
          <div
            style={{
              position: 'fixed', inset: 0, zIndex: 1000,
              background: 'rgba(0,0,0,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={() => { if (!allocSaving) { setEditAllocEmail(null); setAllocError(null); } }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: 'white', borderRadius: 16, padding: '28px 32px',
                width: 460, maxWidth: '90vw', maxHeight: '90vh',
                boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
                display: 'flex', flexDirection: 'column',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#1b1b1b' }}>Edit Allocation</div>
                  <div style={{ fontSize: 12, color: '#616161', marginTop: 2 }}>
                    {target.name} · <span style={{ fontFamily: 'monospace' }}>{target.email}</span>
                  </div>
                </div>
                <button
                  onClick={() => { if (!allocSaving) { setEditAllocEmail(null); setAllocError(null); } }}
                  disabled={allocSaving}
                  style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: '#f7f5f2', cursor: allocSaving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#616161', fontSize: 14 }}
                >
                  <i className="bi-x-lg" />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14, overflowY: 'auto', paddingRight: 4 }}>
                {/* Name + Title */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Display name</label>
                    <input
                      type="text"
                      value={allocForm.name}
                      onChange={e => setAllocForm(f => ({ ...f, name: e.target.value }))}
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                        fontSize: 13, color: '#1b1b1b', outline: 'none', boxSizing: 'border-box',
                      }}
                      onFocus={e => e.currentTarget.style.borderColor = '#7c3aed'}
                      onBlur={e => e.currentTarget.style.borderColor = '#e8e8e8'}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Job title</label>
                    <input
                      type="text"
                      value={allocForm.title}
                      onChange={e => setAllocForm(f => ({ ...f, title: e.target.value }))}
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                        fontSize: 13, color: '#1b1b1b', outline: 'none', boxSizing: 'border-box',
                      }}
                      onFocus={e => e.currentTarget.style.borderColor = '#7c3aed'}
                      onBlur={e => e.currentTarget.style.borderColor = '#e8e8e8'}
                    />
                  </div>
                </div>

                {/* Team + Role */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Team / section</label>
                    <select
                      value={allocForm.team}
                      onChange={e => setAllocForm(f => ({ ...f, team: e.target.value }))}
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                        fontSize: 13, color: '#1b1b1b', background: 'white', cursor: 'pointer',
                      }}
                    >
                      <option value="">— Unassigned —</option>
                      {TEAM_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Role / access</label>
                    <select
                      value={allocForm.role}
                      onChange={e => setAllocForm(f => ({ ...f, role: e.target.value }))}
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                        fontSize: 13, color: '#1b1b1b', background: 'white', cursor: 'pointer',
                      }}
                    >
                      {ROLE_OPTIONS.map(r => (
                        <option key={r} value={r}>{ACCESS_BADGE[r]?.label || r}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Manager + Service */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Manager</label>
                    <select
                      value={allocForm.managerEmail}
                      onChange={e => setAllocForm(f => ({ ...f, managerEmail: e.target.value }))}
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                        fontSize: 13, color: '#1b1b1b', background: 'white', cursor: 'pointer',
                      }}
                    >
                      <option value="">— No manager —</option>
                      {managerOptions
                        .filter(m => m.email.toLowerCase() !== target.email.toLowerCase())
                        .map(m => (
                          <option key={m.email} value={m.email}>
                            {m.name} ({ACCESS_BADGE[m.access]?.label || m.access})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Service line</label>
                    <select
                      value={allocForm.service}
                      onChange={e => setAllocForm(f => ({ ...f, service: e.target.value }))}
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                        fontSize: 13, color: '#1b1b1b', background: 'white', cursor: 'pointer',
                      }}
                    >
                      {SERVICE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                {/* Region + Country */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Region</label>
                    <select
                      value={allocForm.region}
                      onChange={e => setAllocForm(f => ({ ...f, region: e.target.value }))}
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                        fontSize: 13, color: '#1b1b1b', background: 'white', cursor: 'pointer',
                      }}
                    >
                      <option value="">— No region —</option>
                      {REGION_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Countries</label>
                    <input
                      type="text"
                      value={allocForm.country}
                      onChange={e => setAllocForm(f => ({ ...f, country: e.target.value }))}
                      placeholder="e.g. DE, US, SG"
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e8e8e8',
                        fontSize: 13, color: '#1b1b1b', outline: 'none', boxSizing: 'border-box',
                      }}
                      onFocus={e => e.currentTarget.style.borderColor = '#7c3aed'}
                      onBlur={e => e.currentTarget.style.borderColor = '#e8e8e8'}
                    />
                  </div>
                </div>

                {/* Last-login read-only info */}
                <div style={{ padding: '10px 14px', background: '#f9f8f6', borderRadius: 10, fontSize: 11, color: '#616161', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <i className="bi-clock-history" style={{ fontSize: 14, color: '#7c3aed' }} />
                  <div>
                    <div style={{ fontWeight: 600, color: '#1b1b1b', fontSize: 12 }}>
                      {target.lastLoginAt ? `Last logged in: ${new Date(target.lastLoginAt).toLocaleString()}` : 'Has never signed in to Ops Hub'}
                    </div>
                    {target.loginCount > 0 && (
                      <div>Total logins: {target.loginCount}</div>
                    )}
                  </div>
                </div>
              </div>

              {allocError && (
                <div style={{ marginTop: 14, padding: '10px 14px', background: '#ffe2de', color: '#d42d35', borderRadius: 10, fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <i className="bi-exclamation-triangle-fill" style={{ fontSize: 13 }} />
                  {allocError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
                <button
                  onClick={() => { setEditAllocEmail(null); setAllocError(null); }}
                  disabled={allocSaving}
                  style={{
                    padding: '8px 18px', borderRadius: 128, border: '1px solid #e8e8e8',
                    background: 'white', fontSize: 13, fontWeight: 600, color: '#616161',
                    cursor: allocSaving ? 'not-allowed' : 'pointer',
                    opacity: allocSaving ? 0.6 : 1,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveAllocation}
                  disabled={allocSaving}
                  style={{
                    padding: '8px 18px', borderRadius: 128, border: 'none',
                    background: allocSaving ? '#e8e8e8' : '#7c3aed',
                    fontSize: 13, fontWeight: 700,
                    color: allocSaving ? '#9e9e9e' : 'white',
                    cursor: allocSaving ? 'not-allowed' : 'pointer',
                    transition: 'all .15s',
                  }}
                >
                  {allocSaving ? 'Saving…' : 'Save allocation'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Manage permissions modal ────────────────────────────────────── */}
      {permsModalEmail && (() => {
        const target = localMembersByEmail[permsModalEmail];
        const targetName = target?.name || permsModalEmail;
        return (
          <div
            onClick={closePermissionsModal}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,.32)', backdropFilter: 'blur(2px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'white', borderRadius: 16,
                width: 'min(92vw, 460px)',
                boxShadow: '0 20px 50px rgba(0,0,0,.25)',
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid #f0eeec', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f3eff8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="bi-shield-lock" style={{ fontSize: 16, color: '#7c3aed' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1b1b1b' }}>Manage permissions</div>
                  <div style={{ fontSize: 12, color: '#9e9e9e', marginTop: 1 }}>
                    Additive grants for <strong style={{ color: '#1b1b1b' }}>{targetName}</strong>. These apply on top of their normal access tier.
                  </div>
                </div>
              </div>
              <div style={{ padding: '14px 22px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '12px 14px',
                    border: `1.5px solid ${permsDraft.isAnnouncementsAdmin ? '#7c3aed' : '#e8e8e8'}`,
                    borderRadius: 12,
                    background: permsDraft.isAnnouncementsAdmin ? '#fbfafc' : 'white',
                    cursor: 'pointer',
                    transition: 'all .15s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={permsDraft.isAnnouncementsAdmin}
                    onChange={(e) => setPermsDraft({ ...permsDraft, isAnnouncementsAdmin: e.target.checked })}
                    style={{ marginTop: 2, accentColor: '#7c3aed' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1b1b1b', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <i className="bi-megaphone-fill" style={{ fontSize: 12, color: '#7c3aed' }} />
                      Announcements Admin
                    </div>
                    <div style={{ fontSize: 11, color: '#616161', marginTop: 4, lineHeight: 1.5 }}>
                      Full control over the announcement workflow — compose, approve / reject pending requests, archive &amp; unarchive, override draft fields before publishing, and send acknowledgement reminders. Treats this user as an admin for the announcements domain only; other permissions stay tied to their normal access tier.
                    </div>
                  </div>
                </label>
                <label
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '12px 14px',
                    border: `1.5px solid ${permsDraft.isAccessAdmin ? '#0369a1' : '#e8e8e8'}`,
                    borderRadius: 12,
                    background: permsDraft.isAccessAdmin ? '#f5fafd' : 'white',
                    cursor: 'pointer',
                    transition: 'all .15s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={permsDraft.isAccessAdmin}
                    onChange={(e) => setPermsDraft({ ...permsDraft, isAccessAdmin: e.target.checked })}
                    style={{ marginTop: 2, accentColor: '#0369a1' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1b1b1b', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <i className="bi-shield-lock-fill" style={{ fontSize: 12, color: '#0369a1' }} />
                      Access Admin
                    </div>
                    <div style={{ fontSize: 11, color: '#616161', marginTop: 4, lineHeight: 1.5 }}>
                      Manage the team roster — add / edit / remove members, edit allocations, set on-leave, and grant other per-user permissions. Use this to delegate roster maintenance without escalating someone's primary access tier to regional manager.
                    </div>
                  </div>
                </label>
              </div>
              <div style={{ padding: '12px 22px 18px', borderTop: '1px solid #f0eeec', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
                {permsError && <span style={{ fontSize: 12, color: '#d42d35', fontWeight: 600 }}>{permsError}</span>}
                <button
                  onClick={closePermissionsModal}
                  disabled={permsSaving}
                  style={{
                    padding: '8px 16px', borderRadius: 128, border: '1px solid #e8e8e8',
                    background: 'white', color: '#1b1b1b', fontSize: 13, fontWeight: 600,
                    cursor: permsSaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSavePermissions}
                  disabled={permsSaving}
                  style={{
                    padding: '8px 18px', borderRadius: 128, border: 'none',
                    background: permsSaving ? '#e8e8e8' : '#7c3aed',
                    color: permsSaving ? '#9e9e9e' : 'white',
                    fontSize: 13, fontWeight: 700,
                    cursor: permsSaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {permsSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Queue SLA settings ─ editable threshold table at the bottom ── */}
      <QueueSlaSettingsCard />
      <CapacitySettingsCard />
    </div>
  );
};

// ── QueueSlaSettingsCard ───────────────────────────────────────────────────
// Director / RM / TL editable table that controls the SLA windows applied to
// every queue (ZD / Jira / Workbench / Amendments / Redlines / Onboarding /
// Offboarding) plus the universal paused window. Persisted in app_settings.
// Anyone below TL sees read-only values. Saving triggers a BroadcastChannel
// ping so every open tab adopts the new thresholds without a refresh.
// Queue list controls the order + labels in the editor. All windows tick on
// the BUSINESS-DAY clock (Sat/Sun excluded) — the table header reminds the
// user. ZD now has a paused row (pending/hold tickets); Offboarding is
// split by row type (Termination / Resignation) so each path is tunable
// independently. Jira has no paused state.
const QUEUE_META = [
  { id: 'zendesk',                 label: 'Zendesk',                 anchor: 'last requester reply', hasPaused: true  },
  { id: 'jira',                    label: 'Jira',                    anchor: 'last update',          hasPaused: false },
  { id: 'workbench',               label: 'Workbench',               anchor: 'creation',             hasPaused: true  },
  { id: 'amendments',              label: 'Amendments',              anchor: 'creation',             hasPaused: true  },
  { id: 'redlines',                label: 'Redlines',                anchor: 'creation',             hasPaused: true  },
  { id: 'onboarding',              label: 'Onboarding',              anchor: 'task initiated',       hasPaused: true  },
  { id: 'offboarding_termination', label: 'Offboarding · Termination', anchor: 'creation',           hasPaused: true  },
  { id: 'offboarding_resignation', label: 'Offboarding · Resignation', anchor: 'creation',           hasPaused: true  },
];

// Display every duration in HOURS so the editor reads consistently across
// queues whose SLAs span 24h → 14d. Saves are lossless — the parser still
// accepts "h" / "d" / bare minutes inputs but the display always rounds to
// the nearest hour.
function formatMins(mins) {
  if (!Number.isFinite(mins) || mins <= 0) return '—';
  // Show whole-hour results without decimals; otherwise keep one decimal so a
  // 90-minute value reads as "1.5h" rather than "1h" (which would round-trip
  // wrong). 0–59 min stays in minutes for tiny windows.
  if (mins < 60) return `${Math.round(mins)}m`;
  const hours = mins / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}
// Parse a user input like "24h" / "7d" / "1440" → minutes. Returns null on
// a value we can't interpret so the form can show an inline error.
function parseDurationToMins(input) {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([mhd]?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2] || 'h';   // bare number → hours (display unit)
  if (unit === 'm') return Math.round(n);
  if (unit === 'h') return Math.round(n * 60);
  if (unit === 'd') return Math.round(n * 24 * 60);
  return null;
}

const QueueSlaSettingsCard = () => {
  const perms = useContext(PermissionsContext);
  const canEdit = !!(perms?.isAdmin || perms?.canDo?.('can_manage_team') || perms?.canDo?.('can_manage_settings'));
  const { sla, updatedBy, updatedAt, isLoading } = useQueueSlaSettings();

  // Local edit state — primed from the loaded settings, kept as { activeMins, pausedMins } per queue.
  const [draft, setDraft] = useState(sla);
  const [pausedMins, setPausedMins] = useState(48 * 60); // universal paused window — derived from any queue's pausedMins
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState('');

  // Re-prime the form whenever the hook delivers fresh settings.
  useEffect(() => {
    setDraft(sla);
    // Universal paused window — pick the first queue that has one. They all
    // default to the same value, but the UI lets you change it once and we
    // apply it across every queue that supports paused.
    const firstWithPaused = QUEUE_META.find(q => q.hasPaused && Number.isFinite(sla?.[q.id]?.pausedMins));
    if (firstWithPaused) setPausedMins(sla[firstWithPaused.id].pausedMins);
  }, [sla]);

  function setQueueActive(queueId, mins) {
    setDraft(d => ({ ...d, [queueId]: { ...(d?.[queueId] || {}), activeMins: mins } }));
  }
  function setUniversalPaused(mins) {
    setPausedMins(mins);
    setDraft(d => {
      const next = { ...d };
      for (const q of QUEUE_META) if (q.hasPaused) next[q.id] = { ...(next[q.id] || {}), pausedMins: mins };
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const payload = {};
      for (const q of QUEUE_META) {
        const cfg = draft?.[q.id] || {};
        const entry = { activeMins: cfg.activeMins };
        if (q.hasPaused) entry.pausedMins = cfg.pausedMins ?? pausedMins;
        payload[q.id] = entry;
      }
      const res = await putQueueSlaSettings(payload);
      // Ping other tabs (and the SLA hook in this tab) so per-row pills
      // adopt the new thresholds without a manual refresh.
      if (res && res.sla) broadcastQueueSlaUpdate(res);
      setSavedAt(new Date());
    } catch (e) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      marginTop: 24, background: 'white', border: '1px solid #e8e8e8', borderRadius: 16,
      overflow: 'hidden',
    }}>
      <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid #f0eeec', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: '#f3eff8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="bi-shield-check" style={{ fontSize: 14, color: '#7c3aed' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1b1b1b' }}>Queue SLA settings</div>
          <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 1 }}>
            {canEdit
              ? 'Set the SLA window for each queue. Saved values apply across the app immediately.'
              : 'Read-only — only Directors / Regional Managers / Team Leads can edit.'}
            {updatedBy && updatedAt && (
              <span> · Last updated by <strong>{updatedBy}</strong> · {new Date(updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: '4px 22px 18px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #f0eeec' }}>
              <th style={{ textAlign: 'left',  padding: '10px 8px', fontSize: 11, fontWeight: 700, color: '#9e9e9e', letterSpacing: '.04em', textTransform: 'uppercase' }}>Queue</th>
              <th style={{ textAlign: 'left',  padding: '10px 8px', fontSize: 11, fontWeight: 700, color: '#9e9e9e', letterSpacing: '.04em', textTransform: 'uppercase' }}>Active SLA from</th>
              <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: 11, fontWeight: 700, color: '#9e9e9e', letterSpacing: '.04em', textTransform: 'uppercase' }}>Active window</th>
              <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: 11, fontWeight: 700, color: '#9e9e9e', letterSpacing: '.04em', textTransform: 'uppercase' }}>Paused window</th>
            </tr>
          </thead>
          <tbody>
            {QUEUE_META.map(q => {
              const cfg = draft?.[q.id] || {};
              return (
                <tr key={q.id} style={{ borderBottom: '1px solid #f7f5f2' }}>
                  <td style={{ padding: '10px 8px', fontWeight: 600, color: '#1b1b1b' }}>{q.label}</td>
                  <td style={{ padding: '10px 8px', color: '#616161' }}>{q.anchor}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    <SlaInput
                      value={cfg.activeMins}
                      disabled={!canEdit || saving || isLoading}
                      onCommit={(mins) => setQueueActive(q.id, mins)}
                    />
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: q.hasPaused ? '#1b1b1b' : '#c5c5c5' }}>
                    {q.hasPaused ? formatMins(cfg.pausedMins ?? pausedMins) : 'n/a'}
                  </td>
                </tr>
              );
            })}
            <tr style={{ background: '#fbfafc' }}>
              <td colSpan={2} style={{ padding: '12px 8px', fontWeight: 700, color: '#1b1b1b' }}>
                Universal paused window
                <span style={{ marginLeft: 8, fontWeight: 500, fontSize: 11, color: '#9e9e9e' }}>(applies to every queue with a pause state)</span>
              </td>
              <td style={{ padding: '12px 8px', textAlign: 'right', color: '#9e9e9e', fontSize: 11 }}>—</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                <SlaInput
                  value={pausedMins}
                  disabled={!canEdit || saving || isLoading}
                  onCommit={setUniversalPaused}
                />
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
          {error && <span style={{ fontSize: 12, color: '#d42d35', fontWeight: 600 }}>{error}</span>}
          {savedAt && !error && (
            <span style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>
              Saved at {savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {canEdit && (
            <button
              onClick={handleSave}
              disabled={saving || isLoading}
              style={{
                padding: '8px 18px', borderRadius: 128, border: 'none',
                background: saving ? '#e8e8e8' : '#7c3aed',
                fontSize: 13, fontWeight: 700,
                color: saving ? '#9e9e9e' : 'white',
                cursor: saving ? 'not-allowed' : 'pointer',
                transition: 'all .15s',
              }}
            >
              {saving ? 'Saving…' : 'Save SLA settings'}
            </button>
          )}
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: '#9e9e9e' }}>
          All SLAs tick on the <strong>business-day clock</strong> — Saturday and Sunday do not elapse.
          Enter values as hours (<code style={{ background: '#f5f5f5', padding: '1px 5px', borderRadius: 4 }}>48</code> = 48h),
          or with an explicit unit (<code style={{ background: '#f5f5f5', padding: '1px 5px', borderRadius: 4 }}>5d</code>, <code style={{ background: '#f5f5f5', padding: '1px 5px', borderRadius: 4 }}>30m</code>).
          Per-row SLA pills and the Briefing aggregate update on next sync.
        </div>
      </div>
    </div>
  );
};

// Small inline input that accepts free-text duration ("24h" / "7d" / "1440")
// and commits to the parent on blur or Enter. Renders the formatted value
// when not focused so the row stays scannable.
const SlaInput = ({ value, disabled, onCommit }) => {
  const [draft, setDraft] = useState(formatMins(value));
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState(false);

  useEffect(() => { if (!focused) setDraft(formatMins(value)); }, [value, focused]);

  const commit = () => {
    setFocused(false);
    const mins = parseDurationToMins(draft);
    if (mins == null || mins <= 0) {
      setBad(true);
      setDraft(formatMins(value));
      setTimeout(() => setBad(false), 1500);
      return;
    }
    setBad(false);
    if (mins !== value) onCommit(mins);
  };

  return (
    <input
      value={draft}
      disabled={disabled}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      style={{
        width: 90, textAlign: 'right',
        padding: '6px 10px',
        borderRadius: 8,
        border: `1px solid ${bad ? '#d42d35' : '#e8e8e8'}`,
        fontSize: 13, fontFamily: 'inherit', color: disabled ? '#9e9e9e' : '#1b1b1b',
        background: disabled ? '#fafafa' : 'white',
        outline: 'none',
        transition: 'border-color .15s',
      }}
      onFocusCapture={e => { if (!disabled) e.target.style.borderColor = '#7c3aed'; }}
      onBlurCapture={e => { e.target.style.borderColor = bad ? '#d42d35' : '#e8e8e8'; }}
    />
  );
};

// ── CapacitySettingsCard ───────────────────────────────────────────────────
// Director / RM / TL editable thresholds that classify each agent's total
// open + paused workload as Low / Good / High. Persisted via
// /api/v1/settings/capacity. Mirrors the QueueSlaSettingsCard pattern —
// instant LS paint, BroadcastChannel notification on save, fallback to the
// route's defaults when the fetch hasn't resolved yet.
const CapacitySettingsCard = () => {
  const perms = useContext(PermissionsContext);
  const canEdit = !!(perms?.isAdmin || perms?.canDo?.('can_manage_team') || perms?.canDo?.('can_manage_settings'));
  const { capacity, updatedBy, updatedAt, isLoading } = useCapacitySettings();

  const [lowMaxDraft, setLowMaxDraft] = useState(capacity?.lowMax ?? 40);
  const [highMinDraft, setHighMinDraft] = useState(capacity?.highMin ?? 100);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (Number.isFinite(capacity?.lowMax)) setLowMaxDraft(capacity.lowMax);
    if (Number.isFinite(capacity?.highMin)) setHighMinDraft(capacity.highMin);
  }, [capacity?.lowMax, capacity?.highMin]);

  async function handleSave() {
    setError('');
    if (!Number.isFinite(lowMaxDraft) || !Number.isFinite(highMinDraft)) {
      setError('Both thresholds must be numbers'); return;
    }
    if (lowMaxDraft <= 0 || highMinDraft <= 0) {
      setError('Thresholds must be positive integers'); return;
    }
    if (lowMaxDraft >= highMinDraft) {
      setError('Low threshold must be less than High threshold'); return;
    }
    setSaving(true);
    try {
      const res = await putCapacitySettings({ lowMax: lowMaxDraft, highMin: highMinDraft });
      if (res && res.capacity) broadcastCapacityUpdate(res);
      setSavedAt(new Date());
    } catch (e) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 24, background: 'white', border: '1px solid #e8e8e8', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid #f0eeec', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="bi-speedometer2" style={{ fontSize: 14, color: '#1f74b3' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1b1b1b' }}>Workload capacity thresholds</div>
          <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 1 }}>
            {canEdit
              ? 'Set the workload bands used by Briefing health score and the Team workload pills.'
              : 'Read-only — only Directors / Regional Managers / Team Leads can edit.'}
            {updatedBy && updatedAt && (
              <span> · Last updated by <strong>{updatedBy}</strong> · {new Date(updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: '4px 22px 18px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #f0eeec' }}>
              <th style={{ textAlign: 'left',  padding: '10px 8px', fontSize: 11, fontWeight: 700, color: '#9e9e9e', letterSpacing: '.04em', textTransform: 'uppercase' }}>Band</th>
              <th style={{ textAlign: 'left',  padding: '10px 8px', fontSize: 11, fontWeight: 700, color: '#9e9e9e', letterSpacing: '.04em', textTransform: 'uppercase' }}>Range (open + paused tasks)</th>
              <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: 11, fontWeight: 700, color: '#9e9e9e', letterSpacing: '.04em', textTransform: 'uppercase' }}>Threshold</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #f7f5f2' }}>
              <td style={{ padding: '10px 8px', fontWeight: 600, color: '#1f74b3' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#1f74b3' }} />
                  Low (under-utilised)
                </span>
              </td>
              <td style={{ padding: '10px 8px', color: '#616161' }}>{`< ${lowMaxDraft}`}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                <CapacityInput value={lowMaxDraft} disabled={!canEdit || saving || isLoading} onCommit={setLowMaxDraft} />
              </td>
            </tr>
            <tr style={{ borderBottom: '1px solid #f7f5f2' }}>
              <td style={{ padding: '10px 8px', fontWeight: 600, color: '#29811e' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'linear-gradient(90deg, #29811e 0%, #ed8d00 100%)' }} />
                  Good (green near low → yellow near high)
                </span>
              </td>
              <td style={{ padding: '10px 8px', color: '#616161' }}>{`${lowMaxDraft} – ${highMinDraft}`}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#9e9e9e', fontSize: 11 }}>—</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #f7f5f2' }}>
              <td style={{ padding: '10px 8px', fontWeight: 600, color: '#d42d35' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#d42d35' }} />
                  High (burnout risk)
                </span>
              </td>
              <td style={{ padding: '10px 8px', color: '#616161' }}>{`> ${highMinDraft}`}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                <CapacityInput value={highMinDraft} disabled={!canEdit || saving || isLoading} onCommit={setHighMinDraft} />
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
          {error && <span style={{ fontSize: 12, color: '#d42d35', fontWeight: 600 }}>{error}</span>}
          {savedAt && !error && (
            <span style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>
              Saved at {savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {canEdit && (
            <button
              onClick={handleSave}
              disabled={saving || isLoading}
              style={{
                padding: '8px 18px', borderRadius: 128, border: 'none',
                background: saving ? '#e8e8e8' : '#1f74b3',
                fontSize: 13, fontWeight: 700,
                color: saving ? '#9e9e9e' : 'white',
                cursor: saving ? 'not-allowed' : 'pointer',
                transition: 'all .15s',
              }}
            >
              {saving ? 'Saving…' : 'Save capacity thresholds'}
            </button>
          )}
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: '#9e9e9e' }}>
          Workload count = each agent's open + paused tasks across Zendesk, Jira, Workbench,
          Onboarding, Offboarding (Amendments / Redlines have no per-agent assignee, so they
          aren't counted here). The Briefing health score's Capacity factor (default 20%) reads
          these thresholds directly.
        </div>
      </div>
    </div>
  );
};

const CapacityInput = ({ value, disabled, onCommit }) => {
  const [draft, setDraft] = useState(String(value ?? ''));
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState(false);

  useEffect(() => { if (!focused) setDraft(String(value ?? '')); }, [value, focused]);

  const commit = () => {
    setFocused(false);
    const n = Number(draft);
    if (!Number.isFinite(n) || n <= 0 || n > 1000) {
      setBad(true);
      setDraft(String(value ?? ''));
      setTimeout(() => setBad(false), 1500);
      return;
    }
    setBad(false);
    if (Math.round(n) !== value) onCommit(Math.round(n));
  };

  return (
    <input
      type="number"
      min={1}
      max={1000}
      value={draft}
      disabled={disabled}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      style={{
        width: 90, textAlign: 'right',
        padding: '6px 10px',
        borderRadius: 8,
        border: `1px solid ${bad ? '#d42d35' : '#e8e8e8'}`,
        fontSize: 13, fontFamily: 'inherit', color: disabled ? '#9e9e9e' : '#1b1b1b',
        background: disabled ? '#fafafa' : 'white',
        outline: 'none',
        transition: 'border-color .15s',
      }}
    />
  );
};

export default Team;
