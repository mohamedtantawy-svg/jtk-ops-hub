// ── ChangeRequestPanel ──────────────────────────────────────────────────────
// Shows amendments + redlines from Deel Admin API, with tab navigation.
// Two tabs: Amendments (grouped by country) and Redlines (grouped by country).
import { useState, useMemo } from 'react';
import { FLAGS, getFlag, getCountryName } from '../../data/constants';
import { fetchDeelHealth } from '../../services/integrationsApi';

const SEV_CONFIG = {
  critical: { color: '#d42d35', bg: '#fef2f2', icon: 'bi-exclamation-triangle-fill', border: '#fca5a5' },
  warning:  { color: '#92400e', bg: '#fef3c7', icon: 'bi-exclamation-circle-fill',   border: '#ffe27c' },
  active:   { color: '#1d4ed8', bg: '#eff6ff', icon: 'bi-arrow-repeat',              border: '#bddcf0' },
  info:     { color: '#616161', bg: '#f7f5f2', icon: 'bi-clock',                     border: '#e8e8e8' },
};

const DEEL_CONTRACT_BASE = 'https://app.deel.com/contracts';

export default function ChangeRequestPanel({
  amendments = [],
  redlines = [],
  amendmentsByCountry = [],
  redlinesByCountry = [],
  amendmentCounts = {},
  redlineCounts = {},
  loading,
  error,
  onRefresh,
}) {
  const [activeTab, setActiveTab] = useState('amendments');
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
    const groups = activeTab === 'amendments' ? amendmentsByCountry : redlinesByCountry;
    const all = new Set(groups.map(g => g.country));
    all.add('_all');
    setExpandedCountries(all);
  };
  const collapseAll = () => setExpandedCountries(new Set());

  // Reset filters on tab switch
  const switchTab = (tab) => {
    setActiveTab(tab);
    setStatusFilter(null);
    setSearchTerm('');
    setExpandedCountries(new Set(['_all']));
  };

  // ── AMENDMENTS filter + search ──
  const AMENDMENT_FILTER_MAP = {
    amendmentRequested: a => (a.displayStatus?.label || '').toLowerCase().includes('amendment requested'),
    waitingHrx:         a => (a.displayStatus?.label || '').toLowerCase().includes('waiting hrx'),
    pendingSow:         a => (a.displayStatus?.label || '').toLowerCase().includes('pending sow'),
    pendingEa:          a => (a.displayStatus?.label || '').toLowerCase().includes('pending ea'),
    paused:             a => (a.displayStatus?.label || '').toLowerCase().includes('paused'),
  };

  // ── REDLINES filter + search ──
  const REDLINE_FILTER_MAP = {
    redlineReview:    r => (r.displayStatus?.label || '').toLowerCase().includes('redline review'),
    redlineExecution: r => (r.displayStatus?.label || '').toLowerCase().includes('redline execution'),
  };

  // ── Filtered amendment groups ──
  const filteredAmendments = useMemo(() => {
    return amendmentsByCountry.map(group => {
      let items = group.items;
      if (statusFilter && AMENDMENT_FILTER_MAP[statusFilter]) {
        items = items.filter(AMENDMENT_FILTER_MAP[statusFilter]);
      }
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        items = items.filter(a =>
          a.employeeName?.toLowerCase().includes(q) ||
          a.country?.toLowerCase().includes(q) ||
          a.clientName?.toLowerCase().includes(q) ||
          a.type?.toLowerCase().includes(q) ||
          a.contractOid?.toLowerCase().includes(q) ||
          a.changes?.some(c => c.label?.toLowerCase().includes(q) || c.dataPoint?.toLowerCase().includes(q))
        );
      }
      return { ...group, items };
    }).filter(g => g.items.length > 0);
  }, [amendmentsByCountry, statusFilter, searchTerm]);

  // ── Filtered redline groups ──
  const filteredRedlines = useMemo(() => {
    return redlinesByCountry.map(group => {
      let items = group.items;
      if (statusFilter && REDLINE_FILTER_MAP[statusFilter]) {
        items = items.filter(REDLINE_FILTER_MAP[statusFilter]);
      }
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        items = items.filter(r =>
          r.orgName?.toLowerCase().includes(q) ||
          r.templateName?.toLowerCase().includes(q) ||
          r.countryCode?.toLowerCase().includes(q) ||
          (r.countries || []).some(c => c.toLowerCase().includes(q)) ||
          r.type?.toLowerCase().includes(q)
        );
      }
      return { ...group, items };
    }).filter(g => g.items.length > 0);
  }, [redlinesByCountry, statusFilter, searchTerm]);

  const groups = activeTab === 'amendments' ? filteredAmendments : filteredRedlines;
  const counts = activeTab === 'amendments' ? amendmentCounts : redlineCounts;
  const totalFiltered = groups.reduce((sum, g) => sum + g.items.length, 0);

  // Diagnostics
  const [diagResult, setDiagResult] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const runDiagnostic = async () => {
    setDiagLoading(true);
    try { setDiagResult(await fetchDeelHealth()); }
    catch (e) { setDiagResult({ error: e.message }); }
    finally { setDiagLoading(false); }
  };

  // Error state
  if (error && amendments.length === 0 && redlines.length === 0) {
    const isAuth = error.includes('401') || error.includes('400') || error.toLowerCase().includes('unauthorized');
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center' }}>
        <i className={isAuth ? 'bi-shield-lock' : 'bi-exclamation-triangle'} style={{ fontSize: 40, color: isAuth ? '#d42d35' : '#ed8d00', marginBottom: 12 }} />
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1b1b1b', marginBottom: 6 }}>
          {isAuth ? 'Deel API authentication failed' : 'Unable to load change request data'}
        </div>
        <div style={{ fontSize: 13, color: '#9e9e9e', marginBottom: 16, maxWidth: 480 }}>{error}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onRefresh} style={retryBtnStyle}><i className="bi-arrow-clockwise" style={{ marginRight: 6 }} />Retry</button>
          <button onClick={runDiagnostic} disabled={diagLoading} style={diagBtnStyle}>
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
    <div style={{ flex: 1, overflowY: 'auto', background: '#fafaf9', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div style={{ padding: '0 24px', background: 'white', borderBottom: '1px solid #f0efed', display: 'flex', gap: 0 }}>
        <TabButton
          label="Amendments"
          count={amendmentCounts.total}
          active={activeTab === 'amendments'}
          onClick={() => switchTab('amendments')}
          color="#ed8d00"
        />
        <TabButton
          label="Redlines"
          count={redlineCounts.total}
          active={activeTab === 'redlines'}
          onClick={() => switchTab('redlines')}
          color="#7c3aed"
        />
      </div>

      {/* Filter bar */}
      <div style={{ padding: '12px 24px', background: 'white', borderBottom: '1px solid #f0efed', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <StatusPill label="All" count={counts.total} active={!statusFilter} onClick={() => setStatusFilter(null)} color="#1b1b1b" />

        {activeTab === 'amendments' && (
          <>
            {counts.amendmentRequested > 0 && <StatusPill label="Amendment Requested" count={counts.amendmentRequested} active={statusFilter === 'amendmentRequested'} onClick={() => setStatusFilter(statusFilter === 'amendmentRequested' ? null : 'amendmentRequested')} color="#ed8d00" />}
            {counts.waitingHrx > 0 && <StatusPill label="Waiting HRX" count={counts.waitingHrx} active={statusFilter === 'waitingHrx'} onClick={() => setStatusFilter(statusFilter === 'waitingHrx' ? null : 'waitingHrx')} color="#ed8d00" />}
            {counts.pendingSow > 0 && <StatusPill label="Pending SOW" count={counts.pendingSow} active={statusFilter === 'pendingSow'} onClick={() => setStatusFilter(statusFilter === 'pendingSow' ? null : 'pendingSow')} color="#1d4ed8" />}
            {counts.pendingEa > 0 && <StatusPill label="Pending EA" count={counts.pendingEa} active={statusFilter === 'pendingEa'} onClick={() => setStatusFilter(statusFilter === 'pendingEa' ? null : 'pendingEa')} color="#1d4ed8" />}
            {counts.paused > 0 && <StatusPill label="Paused" count={counts.paused} active={statusFilter === 'paused'} onClick={() => setStatusFilter(statusFilter === 'paused' ? null : 'paused')} color="#616161" />}
          </>
        )}

        {activeTab === 'redlines' && (
          <>
            {counts.redlineReview > 0 && <StatusPill label="Redline Review" count={counts.redlineReview} active={statusFilter === 'redlineReview'} onClick={() => setStatusFilter(statusFilter === 'redlineReview' ? null : 'redlineReview')} color="#ed8d00" />}
            {counts.redlineExecution > 0 && <StatusPill label="Redline Execution" count={counts.redlineExecution} active={statusFilter === 'redlineExecution'} onClick={() => setStatusFilter(statusFilter === 'redlineExecution' ? null : 'redlineExecution')} color="#1d4ed8" />}
          </>
        )}

        <div style={{ flex: 1 }} />

        <div style={{ position: 'relative' }}>
          <i className="bi-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#9e9e9e' }} />
          <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder={activeTab === 'amendments' ? 'Search name, country...' : 'Search org, template...'}
            style={{ width: 200, height: 32, paddingLeft: 30, paddingRight: 10, borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, outline: 'none' }} />
        </div>

        <button onClick={expandAll} title="Expand all" style={iconBtnStyle}><i className="bi-arrows-expand" style={{ fontSize: 12 }} /></button>
        <button onClick={collapseAll} title="Collapse all" style={iconBtnStyle}><i className="bi-arrows-collapse" style={{ fontSize: 12 }} /></button>
        <button onClick={onRefresh} title="Refresh" style={{ ...iconBtnStyle, color: loading ? '#ed8d00' : '#9e9e9e' }}>
          <i className={loading ? 'bi-arrow-clockwise spin' : 'bi-arrow-clockwise'} style={{ fontSize: 12 }} />
        </button>

        <span style={{ fontSize: 11, color: '#9e9e9e' }}>{totalFiltered} {totalFiltered === 1 ? 'item' : 'items'}</span>
      </div>

      {/* Loading */}
      {loading && groups.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <i className="bi-arrow-clockwise spin" style={{ fontSize: 28, color: '#9e9e9e', display: 'block', marginBottom: 12 }} />
          <div style={{ fontSize: 14, color: '#9e9e9e' }}>Loading {activeTab}...</div>
        </div>
      )}

      {/* Empty */}
      {!loading && groups.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <i className="bi-pencil-square" style={{ fontSize: 40, color: '#c0c0c0', display: 'block', marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1b1b1b', marginBottom: 6 }}>
            {searchTerm || statusFilter ? 'No matches' : `No actionable ${activeTab}`}
          </div>
          <div style={{ fontSize: 13, color: '#9e9e9e' }}>
            {searchTerm || statusFilter ? 'Try adjusting the filters' : `All ${activeTab} are handled`}
          </div>
        </div>
      )}

      {/* Country groups */}
      {groups.map(group => {
        const isExpanded = expandedCountries.has(group.country) || expandedCountries.has('_all');
        const flag = getFlag(group.country);

        return (
          <div key={group.country} style={{ borderBottom: '1px solid #f0efed' }}>
            <div onClick={() => toggleCountry(group.country)}
              style={{ padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: isExpanded ? '#f9f8f6' : 'white', transition: 'background .15s', position: 'sticky', top: 0, zIndex: 1 }}>
              <i className={isExpanded ? 'bi-chevron-down' : 'bi-chevron-right'} style={{ fontSize: 10, color: '#9e9e9e', width: 14 }} />
              <span style={{ fontSize: 16 }}>{flag}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b' }}>{getCountryName(group.country)}</span>
              <span style={{ fontSize: 12, color: '#9e9e9e' }}>{group.items.length} {group.items.length === 1 ? 'item' : 'items'}</span>
              {group.warningCount > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 128, background: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: 700 }}>
                  {group.warningCount} pending
                </span>
              )}
            </div>

            {isExpanded && activeTab === 'amendments' && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f5f4f2' }}>
                    <th style={thStyle}>Employee</th>
                    <th style={{ ...thStyle, width: 100 }}>Type</th>
                    <th style={{ ...thStyle, width: 140 }}>Status</th>
                    <th style={{ ...thStyle, width: 160 }}>Changes</th>
                    <th style={{ ...thStyle, width: 100 }}>Effective</th>
                    <th style={{ ...thStyle, width: 80 }}>Age</th>
                    <th style={{ ...thStyle, width: 80 }}>Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item, idx) => (
                    <AmendmentRow key={`${item.id}-${idx}`} item={item} />
                  ))}
                </tbody>
              </table>
            )}

            {isExpanded && activeTab === 'redlines' && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f5f4f2' }}>
                    <th style={thStyle}>Organization</th>
                    <th style={{ ...thStyle, width: 100 }}>Type</th>
                    <th style={{ ...thStyle, width: 140 }}>Status</th>
                    <th style={{ ...thStyle, width: 140 }}>Template</th>
                    <th style={{ ...thStyle, width: 80 }}>Changes</th>
                    <th style={{ ...thStyle, width: 80 }}>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item, idx) => (
                    <RedlineRow key={`${item.id}-${idx}`} item={item} />
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

// ── Amendment Row ──

function AmendmentRow({ item }) {
  const [hov, setHov] = useState(false);
  const sev = item.displayStatus?.severity || 'active';
  const cfg = SEV_CONFIG[sev] || SEV_CONFIG.active;
  const isWarning = sev === 'warning';
  const rowBg = isWarning ? '#fffdf5' : 'white';

  const effectiveDate = item.effectiveDate
    ? new Date(item.effectiveDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '--';

  // Age since creation
  const age = item.createdAt
    ? Math.max(0, Math.floor((Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24)))
    : null;
  const ageDisplay = age !== null ? (age === 0 ? 'Today' : `${age}d`) : '--';
  const ageColor = age !== null ? (age > 14 ? '#d42d35' : age > 7 ? '#ed8d00' : '#616161') : '#9e9e9e';

  // Type label
  const typeLabel = item.type === 'OPS' ? 'Ops' : item.type === 'CUSTOM' ? 'Custom' : item.type === 'LEGAL' ? 'Legal' : item.type || '--';
  const typeColor = item.type === 'OPS' ? '#0369a1' : item.type === 'CUSTOM' ? '#7c3aed' : item.type === 'LEGAL' ? '#ed8d00' : '#616161';

  // Changes summary
  const changesSummary = item.changes?.length > 0
    ? item.changes.map(c => c.label || c.dataPoint).filter(Boolean).join(', ')
    : '--';

  const contractUrl = item.contractOid ? `${DEEL_CONTRACT_BASE}/${item.contractOid}` : null;

  return (
    <tr onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ borderBottom: '1px solid #f0efed', background: hov ? '#faf8ff' : rowBg, transition: 'background .1s',
        borderLeft: isWarning ? '3px solid #ed8d00' : '3px solid transparent' }}>

      {/* Employee */}
      <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#fff8e6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#ed8d00', flexShrink: 0 }}>
            {(item.employeeName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', lineHeight: 1.2 }}>{item.employeeName || '--'}</div>
            {item.clientName && <div style={{ fontSize: 10, color: '#b0a8a0' }}>{item.clientName}</div>}
          </div>
        </div>
      </td>

      {/* Type */}
      <td style={tdStyle}>
        <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 128, background: `${typeColor}12`, color: typeColor, fontSize: 10, fontWeight: 700 }}>
          {typeLabel}
        </span>
      </td>

      {/* Status */}
      <td style={tdStyle}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 128, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
          <i className={cfg.icon} style={{ fontSize: 9 }} />
          {item.displayStatus?.label || 'Amendment'}
        </span>
      </td>

      {/* Changes */}
      <td style={{ ...tdStyle, maxWidth: 180 }}>
        <span style={{ fontSize: 11, color: '#616161', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={changesSummary}>
          {item.changesCount > 0 ? (
            <>
              <span style={{ fontWeight: 600, color: '#1b1b1b', marginRight: 4 }}>{item.changesCount}</span>
              {changesSummary}
            </>
          ) : '--'}
        </span>
      </td>

      {/* Effective date */}
      <td style={{ ...tdStyle, fontSize: 12, color: '#616161', whiteSpace: 'nowrap' }}>
        {effectiveDate}
      </td>

      {/* Age */}
      <td style={{ ...tdStyle, fontSize: 12, fontWeight: 600, color: ageColor, whiteSpace: 'nowrap' }}>
        {ageDisplay}
      </td>

      {/* Contract link */}
      <td style={tdStyle}>
        {contractUrl ? (
          <a href={contractUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 6, background: hov ? '#e8f0fe' : '#f5f4f2', color: hov ? '#1f74b3' : '#9e9e9e', fontSize: 10, fontWeight: 600, textDecoration: 'none', transition: 'all .15s', whiteSpace: 'nowrap', border: hov ? '1px solid #c8d9f0' : '1px solid transparent' }}>
            <i className="bi-box-arrow-up-right" style={{ fontSize: 9 }} />Deel
          </a>
        ) : <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>}
      </td>
    </tr>
  );
}

// ── Redline Row ──

function RedlineRow({ item }) {
  const [hov, setHov] = useState(false);
  const sev = item.displayStatus?.severity || 'active';
  const cfg = SEV_CONFIG[sev] || SEV_CONFIG.active;
  const isWarning = sev === 'warning';
  const rowBg = isWarning ? '#fffdf5' : 'white';

  // Type label
  const typeLabel = item.type === 'templateRedline' ? 'Template' : item.type === 'contractRedline' ? 'Contract' : item.type || '--';
  const typeColor = item.type === 'templateRedline' ? '#7c3aed' : '#0369a1';

  // Age since creation
  const age = item.createdAt
    ? Math.max(0, Math.floor((Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24)))
    : null;
  const ageDisplay = age !== null ? (age === 0 ? 'Today' : `${age}d`) : '--';
  const ageColor = age !== null ? (age > 14 ? '#d42d35' : age > 7 ? '#ed8d00' : '#616161') : '#9e9e9e';

  return (
    <tr onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ borderBottom: '1px solid #f0efed', background: hov ? '#faf8ff' : rowBg, transition: 'background .1s',
        borderLeft: isWarning ? '3px solid #ed8d00' : '3px solid transparent' }}>

      {/* Organization */}
      <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#f3eff8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#7c3aed', flexShrink: 0 }}>
            {(item.orgName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', lineHeight: 1.2 }}>{item.orgName || '--'}</div>
            {item.countries?.length > 0 && (
              <div style={{ fontSize: 10, color: '#b0a8a0' }}>{item.countries.join(', ')}</div>
            )}
          </div>
        </div>
      </td>

      {/* Type */}
      <td style={tdStyle}>
        <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 128, background: `${typeColor}12`, color: typeColor, fontSize: 10, fontWeight: 700 }}>
          {typeLabel}
        </span>
      </td>

      {/* Status */}
      <td style={tdStyle}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 128, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
          <i className={cfg.icon} style={{ fontSize: 9 }} />
          {item.displayStatus?.label || 'Redline'}
        </span>
      </td>

      {/* Template */}
      <td style={{ ...tdStyle, maxWidth: 160 }}>
        <span style={{ fontSize: 11, color: '#616161', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.templateName}>
          {item.templateName || '--'}
        </span>
      </td>

      {/* Changes count */}
      <td style={tdStyle}>
        {item.changesCount > 0 ? (
          <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 128, background: '#f5f4f2', color: '#616161', fontSize: 11, fontWeight: 600 }}>
            {item.changesCount}
          </span>
        ) : <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>}
      </td>

      {/* Age */}
      <td style={{ ...tdStyle, fontSize: 12, fontWeight: 600, color: ageColor, whiteSpace: 'nowrap' }}>
        {ageDisplay}
      </td>
    </tr>
  );
}

// ── Tab Button ──

function TabButton({ label, count, active, onClick, color }) {
  return (
    <button onClick={onClick}
      style={{
        padding: '12px 20px', cursor: 'pointer', border: 'none',
        background: 'transparent', fontSize: 13, fontWeight: active ? 600 : 500,
        color: active ? '#1b1b1b' : '#9e9e9e', position: 'relative',
        borderBottom: active ? `2px solid ${color}` : '2px solid transparent',
        transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 6,
      }}>
      {label}
      {count > 0 && (
        <span style={{
          padding: '1px 7px', borderRadius: 128, fontSize: 10, fontWeight: 700,
          background: active ? `${color}15` : '#f2f2f2',
          color: active ? color : '#9e9e9e',
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

// ── StatusPill ──

function StatusPill({ label, count, active, onClick, color }) {
  return (
    <button onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 128, border: active ? `1px solid ${color}` : '1px solid #e8e8e8', background: active ? `${color}10` : 'white', color: active ? color : '#616161', fontSize: 12, fontWeight: active ? 600 : 500, cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap' }}>
      {label}
      {count > 0 && (
        <span style={{ padding: '1px 6px', borderRadius: 128, fontSize: 10, fontWeight: 700, background: active ? `${color}18` : '#f2f2f2', color: active ? color : '#9e9e9e' }}>
          {count}
        </span>
      )}
    </button>
  );
}

// ── Styles ──
const iconBtnStyle = { width: 32, height: 32, borderRadius: 8, border: '1px solid #e8e8e8', background: 'white', color: '#9e9e9e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const retryBtnStyle = { padding: '8px 20px', borderRadius: 128, border: '1px solid #e8e8e8', background: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#1b1b1b' };
const diagBtnStyle = { padding: '8px 20px', borderRadius: 128, border: '1px solid #e8e8e8', background: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer', color: '#616161' };
const thStyle = { padding: '8px 12px', fontSize: 10, fontWeight: 600, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #e8e8e8' };
const tdStyle = { padding: '8px 12px', textAlign: 'center', verticalAlign: 'middle' };
