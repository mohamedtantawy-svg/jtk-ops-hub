// ── OnboardingPanel ─────────────────────────────────────────────────────────
// Shows actionable onboarding tasks from Deel Admin API, grouped by country.
// Driven by action.severity from the server — no hardcoded status strings.
import { useState, useMemo } from 'react';
import { FLAGS } from '../../data/constants';
import { fetchDeelHealth } from '../../services/integrationsApi';

// Severity-based styling (matches action.severity from server)
const SEV_CONFIG = {
  critical: { label: 'Overdue',        color: '#d42d35', bg: '#fef2f2', icon: 'bi-exclamation-triangle-fill', border: '#fca5a5' },
  warning:  { label: 'At Risk',        color: '#92400e', bg: '#fef3c7', icon: 'bi-exclamation-circle-fill',   border: '#ffe27c' },
  active:   { label: 'In Progress',    color: '#1d4ed8', bg: '#eff6ff', icon: 'bi-arrow-repeat',              border: '#bddcf0' },
  info:     { label: 'Pending Invite', color: '#616161', bg: '#f7f5f2', icon: 'bi-envelope',                  border: '#e8e8e8' },
};

const HIRING_TYPE_LABELS = {
  eor: 'EOR', EOR: 'EOR',
  contractor: 'Contractor', CONTRACTOR: 'Contractor',
  direct_employee: 'Direct Employee', DIRECT_EMPLOYEE: 'Direct Employee',
  hris_direct_employee: 'HRIS Direct',
  hris_direct_contractor: 'HRIS Contractor',
  peo: 'PEO', PEO: 'PEO',
};

const DEEL_CONTRACT_BASE = 'https://app.deel.com/contracts';

export default function OnboardingPanel({ byCountry = [], counts = {}, loading, error, onRefresh }) {
  const [expandedCountries, setExpandedCountries] = useState(new Set(['_all']));
  const [statusFilter, setStatusFilter] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const toggleCountry = (ctry) => {
    setExpandedCountries(prev => {
      const next = new Set(prev);
      if (next.has(ctry)) next.delete(ctry);
      else next.add(ctry);
      return next;
    });
  };

  const expandAll = () => {
    const all = new Set(byCountry.map(g => g.country));
    all.add('_all');
    setExpandedCountries(all);
  };
  const collapseAll = () => setExpandedCountries(new Set());

  // Filter by severity + search
  const FILTER_MAP = {
    critical: p => p.action?.severity === 'critical',
    warning:  p => p.action?.severity === 'warning',
    active:   p => p.action?.severity === 'active',
    info:     p => p.action?.severity === 'info',
  };

  const filtered = useMemo(() => {
    return byCountry.map(group => {
      let people = group.people;
      if (statusFilter && FILTER_MAP[statusFilter]) {
        people = people.filter(FILTER_MAP[statusFilter]);
      }
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        people = people.filter(p =>
          p.name?.toLowerCase().includes(q) ||
          p.email?.toLowerCase().includes(q) ||
          p.jobTitle?.toLowerCase().includes(q) ||
          p.team?.toLowerCase().includes(q) ||
          p.organizationName?.toLowerCase().includes(q) ||
          p.contractId?.toLowerCase().includes(q)
        );
      }
      return { ...group, people };
    }).filter(g => g.people.length > 0);
  }, [byCountry, statusFilter, searchTerm]);

  const totalFiltered = filtered.reduce((sum, g) => sum + g.people.length, 0);

  // Diagnostics
  const [diagResult, setDiagResult] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const runDiagnostic = async () => {
    setDiagLoading(true);
    try {
      const res = await fetchDeelHealth();
      setDiagResult(res);
    } catch (e) {
      setDiagResult({ error: e.message });
    } finally {
      setDiagLoading(false);
    }
  };

  // Error state
  if (error && byCountry.length === 0) {
    const isAuth = error.includes('401') || error.includes('400') || error.toLowerCase().includes('not authorized') || error.toLowerCase().includes('unauthorized') || error.toLowerCase().includes('unsupported authorization');
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center' }}>
        <i className={isAuth ? 'bi-shield-lock' : 'bi-exclamation-triangle'} style={{ fontSize: 40, color: isAuth ? '#d42d35' : '#ed8d00', marginBottom: 12 }} />
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1b1b1b', marginBottom: 6 }}>
          {isAuth ? 'Deel API authentication failed' : 'Unable to load onboarding data'}
        </div>
        <div style={{ fontSize: 13, color: '#9e9e9e', marginBottom: 16, maxWidth: 480 }}>{error}</div>
        {isAuth && (
          <div style={{ fontSize: 11, color: '#b0a8a0', marginBottom: 16, maxWidth: 400 }}>
            Ensure DEEL_API_KEY on Nexus contains a valid admin token from admin.deel.network Admin Debug Tool.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onRefresh} style={{ padding: '8px 20px', borderRadius: 128, border: '1px solid #e8e8e8', background: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#1b1b1b' }}>
            <i className="bi-arrow-clockwise" style={{ marginRight: 6 }} />Retry
          </button>
          <button onClick={runDiagnostic} disabled={diagLoading} style={{ padding: '8px 20px', borderRadius: 128, border: '1px solid #e8e8e8', background: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer', color: '#616161' }}>
            <i className="bi-bug" style={{ marginRight: 6 }} />{diagLoading ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
        {diagResult && (
          <div style={{ marginTop: 16, padding: 16, background: '#fafaf9', borderRadius: 8, border: '1px solid #e8e8e8', textAlign: 'left', maxWidth: 540, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: '#616161', lineHeight: '1.6' }}>
            {JSON.stringify(diagResult, null, 2)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: '#fafaf9' }}>
      {/* Summary bar */}
      <div style={{ padding: '12px 24px', background: 'white', borderBottom: '1px solid #f0efed', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <StatusPill label="All" count={counts.total} active={!statusFilter} onClick={() => setStatusFilter(null)} color="#1b1b1b" />
        {counts.critical > 0 && <StatusPill label="Overdue" count={counts.critical} active={statusFilter === 'critical'} onClick={() => setStatusFilter(statusFilter === 'critical' ? null : 'critical')} color="#d42d35" />}
        {counts.warning > 0 && <StatusPill label="At Risk" count={counts.warning} active={statusFilter === 'warning'} onClick={() => setStatusFilter(statusFilter === 'warning' ? null : 'warning')} color="#ed8d00" />}
        {counts.active > 0 && <StatusPill label="In Progress" count={counts.active} active={statusFilter === 'active'} onClick={() => setStatusFilter(statusFilter === 'active' ? null : 'active')} color="#1d4ed8" />}
        {counts.info > 0 && <StatusPill label="Pending" count={counts.info} active={statusFilter === 'info'} onClick={() => setStatusFilter(statusFilter === 'info' ? null : 'info')} color="#616161" />}

        <div style={{ flex: 1 }} />

        <div style={{ position: 'relative' }}>
          <i className="bi-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#9e9e9e' }} />
          <input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search name, title, org..."
            style={{ width: 200, height: 32, paddingLeft: 30, paddingRight: 10, borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, outline: 'none' }}
          />
        </div>

        <button onClick={expandAll} title="Expand all" style={iconBtnStyle}><i className="bi-arrows-expand" style={{ fontSize: 12 }} /></button>
        <button onClick={collapseAll} title="Collapse all" style={iconBtnStyle}><i className="bi-arrows-collapse" style={{ fontSize: 12 }} /></button>
        <button onClick={onRefresh} title="Refresh data" style={{ ...iconBtnStyle, color: loading ? '#ed8d00' : '#9e9e9e' }}>
          <i className={loading ? 'bi-arrow-clockwise spin' : 'bi-arrow-clockwise'} style={{ fontSize: 12 }} />
        </button>

        <span style={{ fontSize: 11, color: '#9e9e9e' }}>{totalFiltered} {totalFiltered === 1 ? 'person' : 'people'}</span>
      </div>

      {/* Loading */}
      {loading && byCountry.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <i className="bi-arrow-clockwise spin" style={{ fontSize: 28, color: '#9e9e9e', display: 'block', marginBottom: 12 }} />
          <div style={{ fontSize: 14, color: '#9e9e9e' }}>Loading onboarding data...</div>
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <i className="bi-person-check" style={{ fontSize: 40, color: '#c0c0c0', display: 'block', marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1b1b1b', marginBottom: 6 }}>
            {searchTerm || statusFilter ? 'No matches' : 'No actionable onboarding tasks'}
          </div>
          <div style={{ fontSize: 13, color: '#9e9e9e' }}>
            {searchTerm || statusFilter ? 'Try adjusting the filters' : 'All employees are fully onboarded'}
          </div>
        </div>
      )}

      {/* Country groups */}
      {filtered.map(group => {
        const isExpanded = expandedCountries.has(group.country) || expandedCountries.has('_all');
        const flag = FLAGS[group.country] || '';

        return (
          <div key={group.country} style={{ borderBottom: '1px solid #f0efed' }}>
            <div
              onClick={() => toggleCountry(group.country)}
              style={{
                padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 10,
                cursor: 'pointer', background: isExpanded ? '#f9f8f6' : 'white',
                transition: 'background .15s', position: 'sticky', top: 0, zIndex: 1,
              }}
            >
              <i className={isExpanded ? 'bi-chevron-down' : 'bi-chevron-right'} style={{ fontSize: 10, color: '#9e9e9e', width: 14 }} />
              <span style={{ fontSize: 16 }}>{flag}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b' }}>{group.country}</span>
              <span style={{ fontSize: 12, color: '#9e9e9e' }}>{group.people.length} {group.people.length === 1 ? 'person' : 'people'}</span>
              {group.overdueCount > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 128, background: '#fef2f2', color: '#d42d35', fontSize: 10, fontWeight: 700 }}>
                  <i className="bi-exclamation-triangle-fill" style={{ fontSize: 9 }} />{group.overdueCount} overdue
                </span>
              )}
              {group.atRiskCount > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 128, background: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: 700 }}>
                  {group.atRiskCount} at risk
                </span>
              )}
            </div>

            {isExpanded && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f5f4f2' }}>
                    <th style={thStyle}>Employee</th>
                    <th style={{ ...thStyle, width: 140 }}>Job Title</th>
                    <th style={{ ...thStyle, width: 90 }}>Type</th>
                    <th style={{ ...thStyle, width: 100 }}>Start Date</th>
                    <th style={{ ...thStyle, width: 90 }}>Team</th>
                    <th style={{ ...thStyle, width: 120 }}>Status</th>
                    <th style={{ ...thStyle, width: 80 }}>Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {group.people.map(person => (
                    <PersonRow key={person.id || person.contractId || person.name} person={person} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Sub-components ──

function PersonRow({ person }) {
  const [hov, setHov] = useState(false);
  const sev = person.action?.severity || 'active';
  const cfg = SEV_CONFIG[sev] || SEV_CONFIG.active;
  const actionLabel = person.action?.label || cfg.label;
  const isOverdue = sev === 'critical';
  const isAtRisk = sev === 'warning';
  const rowBg = isOverdue ? '#fffbfb' : isAtRisk ? '#fffdf5' : 'white';

  const typeLabel = HIRING_TYPE_LABELS[person.hiringType] || person.hiringType || '--';
  const contractUrl = person.contractId ? `${DEEL_CONTRACT_BASE}/${person.contractId}` : null;
  const startDate = person.startDate
    ? new Date(person.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '--';

  return (
    <tr
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderBottom: '1px solid #f0efed',
        background: hov ? '#faf8ff' : rowBg,
        transition: 'background .1s',
        borderLeft: isOverdue ? '3px solid #d42d35' : isAtRisk ? '3px solid #ed8d00' : '3px solid transparent',
      }}
    >
      {/* Employee */}
      <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', background: '#f0ecff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700, color: '#7c3aed', flexShrink: 0,
          }}>
            {(person.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', lineHeight: 1.2 }}>{person.name}</div>
            {person.email && <div style={{ fontSize: 10, color: '#9e9e9e' }}>{person.email}</div>}
            {person.organizationName && <div style={{ fontSize: 10, color: '#b0a8a0' }}>{person.organizationName}</div>}
          </div>
        </div>
      </td>

      {/* Job title */}
      <td style={{ ...tdStyle, fontSize: 12, color: '#444', textAlign: 'left' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: 180 }}>
          {person.jobTitle || '--'}
        </span>
      </td>

      {/* Hiring type */}
      <td style={tdStyle}>
        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 128, background: '#f2f2f2', color: '#616161', whiteSpace: 'nowrap' }}>
          {typeLabel}
        </span>
      </td>

      {/* Start date */}
      <td style={{ ...tdStyle, fontSize: 12, color: '#616161', whiteSpace: 'nowrap' }}>
        {startDate}
      </td>

      {/* Team */}
      <td style={{ ...tdStyle, fontSize: 11, color: '#9e9e9e' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: 100 }}>
          {person.team || '--'}
        </span>
      </td>

      {/* Status badge */}
      <td style={tdStyle}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '3px 10px', borderRadius: 128,
          background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
          fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
        }}>
          <i className={cfg.icon} style={{ fontSize: 9 }} />
          {actionLabel}
        </span>
        {person.hiringStatus && person.hiringStatus !== actionLabel && (
          <div style={{ fontSize: 9, color: '#b0a8a0', marginTop: 2, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={person.hiringStatus}>
            {person.hiringStatus}
          </div>
        )}
      </td>

      {/* Contract link */}
      <td style={tdStyle}>
        {contractUrl ? (
          <a
            href={contractUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 10px', borderRadius: 6,
              background: hov ? '#e8f0fe' : '#f5f4f2',
              color: hov ? '#1f74b3' : '#9e9e9e',
              fontSize: 10, fontWeight: 600, textDecoration: 'none',
              transition: 'all .15s', whiteSpace: 'nowrap',
              border: hov ? '1px solid #c8d9f0' : '1px solid transparent',
            }}
          >
            <i className="bi-box-arrow-up-right" style={{ fontSize: 9 }} />
            Deel
          </a>
        ) : (
          <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>
        )}
      </td>
    </tr>
  );
}

function StatusPill({ label, count, active, onClick, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 12px', borderRadius: 128,
        border: active ? `1px solid ${color}` : '1px solid #e8e8e8',
        background: active ? `${color}10` : 'white',
        color: active ? color : '#616161',
        fontSize: 12, fontWeight: active ? 600 : 500,
        cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap',
      }}
    >
      {label}
      {count > 0 && (
        <span style={{
          padding: '1px 6px', borderRadius: 128, fontSize: 10, fontWeight: 700,
          background: active ? `${color}18` : '#f2f2f2',
          color: active ? color : '#9e9e9e',
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

// ── Styles ──
const iconBtnStyle = { width: 32, height: 32, borderRadius: 8, border: '1px solid #e8e8e8', background: 'white', color: '#9e9e9e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const thStyle = { padding: '8px 12px', fontSize: 10, fontWeight: 600, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #e8e8e8' };
const tdStyle = { padding: '8px 12px', textAlign: 'center', verticalAlign: 'middle' };
