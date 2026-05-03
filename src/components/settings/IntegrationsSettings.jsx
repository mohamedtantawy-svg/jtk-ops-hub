// ── IntegrationsSettings ─────────────────────────────────────────────────────
// Shows the status of all external API integrations (Deel Admin, Jira, Slack)
// and provides test/connection controls.
import { useState, useEffect, useCallback } from 'react';
import { useIntegrations } from '../../hooks/useIntegrations';
import {
  fetchDeelPeople, fetchDeelOrg,
  searchJiraIssues, fetchJiraProjects,
  fetchSlackChannels, fetchSlackUsers,
} from '../../services/integrationsApi';

const INTEGRATIONS = [
  {
    key: 'deel',
    label: 'Deel Admin',
    icon: 'bi-building',
    color: '#15357a',
    bg: '#e8edf6',
    description: 'People, contracts, time-off requests, payslips, organization data',
    envVars: ['DEEL_API_KEY'],
    testFn: async () => {
      const res = await fetchDeelOrg();
      return { ok: true, detail: res?.data?.name || 'Connected' };
    },
  },
  {
    key: 'jira',
    label: 'Jira',
    icon: 'bi-kanban',
    color: '#0052CC',
    bg: '#e6efff',
    description: 'Issues, search (JQL), projects, comments, transitions',
    envVars: ['JIRA_BASE_URL', 'JIRA_USER_EMAIL', 'JIRA_API_TOKEN'],
    testFn: async () => {
      const res = await fetchJiraProjects({ maxResults: 1 });
      const count = res?.total ?? res?.values?.length ?? 0;
      return { ok: true, detail: `${count} project(s) accessible` };
    },
  },
  {
    key: 'slack',
    label: 'Slack',
    icon: 'bi-chat-square-dots',
    color: '#E01E5A',
    bg: '#fce8ef',
    description: 'Channels, messages, users, send messages, thread replies',
    envVars: ['SLACK_BOT_TOKEN'],
    testFn: async () => {
      const res = await fetchSlackChannels();
      const count = res?.channels?.length ?? 0;
      return { ok: true, detail: `${count} channel(s) visible` };
    },
  },
];

const StatusDot = ({ status }) => {
  const colors = { connected: '#16a34a', disconnected: '#d1d5db', testing: '#f59e0b', error: '#ef4444' };
  const labels = { connected: 'Connected', disconnected: 'Not configured', testing: 'Testing...', error: 'Error' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: colors[status] || colors.disconnected,
        ...(status === 'testing' ? { animation: 'pulse 1.5s infinite' } : {}),
      }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: status === 'connected' ? '#16a34a' : status === 'error' ? '#ef4444' : '#9e9e9e' }}>
        {labels[status] || 'Unknown'}
      </span>
    </div>
  );
};

export default function IntegrationsSettings({ addToast }) {
  const { status, loading, refresh } = useIntegrations();
  const [testResults, setTestResults] = useState({});
  const [testing, setTesting] = useState({});

  const testConnection = useCallback(async (integration) => {
    setTesting(prev => ({ ...prev, [integration.key]: true }));
    setTestResults(prev => ({ ...prev, [integration.key]: null }));
    try {
      const result = await integration.testFn();
      setTestResults(prev => ({ ...prev, [integration.key]: result }));
      if (addToast) addToast('success', `${integration.label} connected`, result.detail);
    } catch (err) {
      const msg = err.message || 'Connection failed';
      setTestResults(prev => ({ ...prev, [integration.key]: { ok: false, detail: msg } }));
      if (addToast) addToast('error', `${integration.label} failed`, msg);
    } finally {
      setTesting(prev => ({ ...prev, [integration.key]: false }));
    }
  }, [addToast]);

  const getStatus = (key) => {
    if (testing[key]) return 'testing';
    if (testResults[key]?.ok === true) return 'connected';
    if (testResults[key]?.ok === false) return 'error';
    if (status?.[key]?.configured) return 'connected';
    return 'disconnected';
  };

  const configuredCount = status ? Object.values(status).filter(s => s.configured).length : 0;
  const totalCount = INTEGRATIONS.length;

  return (
    <div style={{ padding: 28, height: '100%', overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <i className="bi-cloud-arrow-down-fill" style={{ fontSize: 18, color: '#1b1b1b' }} />
          <span style={{ fontSize: 18, fontWeight: 700, color: '#1b1b1b' }}>Live Integrations</span>
          <div style={{
            padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
            background: configuredCount === totalCount ? '#dcfce7' : '#fef3c7',
            color: configuredCount === totalCount ? '#16a34a' : '#d97706',
          }}>
            {configuredCount}/{totalCount} active
          </div>
        </div>
        <div style={{ fontSize: 13, color: '#9e9e9e', marginLeft: 28 }}>
          Connect Ops Hub to external services for live data. API keys are configured as environment variables on Nexus.
        </div>
      </div>

      {/* Integration cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {INTEGRATIONS.map(integration => {
          const configured = status?.[integration.key]?.configured;
          const currentStatus = getStatus(integration.key);
          const result = testResults[integration.key];

          return (
            <div key={integration.key} style={{
              border: '1px solid', borderRadius: 16, padding: 20,
              borderColor: currentStatus === 'connected' ? '#bbf7d0' : currentStatus === 'error' ? '#fecaca' : '#e8e8e8',
              background: currentStatus === 'connected' ? '#f0fdf4' : currentStatus === 'error' ? '#fef2f2' : 'white',
              transition: 'all 0.2s ease',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                {/* Icon */}
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: integration.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <i className={integration.icon} style={{ fontSize: 20, color: integration.color }} />
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#1b1b1b' }}>{integration.label}</span>
                    <StatusDot status={currentStatus} />
                  </div>
                  <div style={{ fontSize: 12.5, color: '#616161', marginBottom: 10 }}>
                    {integration.description}
                  </div>

                  {/* Env var hints */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {integration.envVars.map(v => (
                      <code key={v} style={{
                        fontSize: 10.5, padding: '2px 8px', borderRadius: 6,
                        background: configured ? '#dcfce7' : '#f5f5f5',
                        color: configured ? '#16a34a' : '#9e9e9e',
                        fontFamily: 'SF Mono, monospace',
                      }}>
                        {v} {configured ? '✓' : '✗'}
                      </code>
                    ))}
                  </div>

                  {/* Test result */}
                  {result && (
                    <div style={{
                      fontSize: 11.5, padding: '6px 10px', borderRadius: 8, marginBottom: 10,
                      background: result.ok ? '#dcfce7' : '#fef2f2',
                      color: result.ok ? '#16a34a' : '#ef4444',
                    }}>
                      {result.ok ? '✓' : '✗'} {result.detail}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => testConnection(integration)}
                      disabled={testing[integration.key]}
                      style={{
                        height: 32, padding: '0 14px', borderRadius: 128,
                        border: '1px solid #e8e8e8', background: 'var(--surface)',
                        color: '#1b1b1b', fontSize: 12, fontWeight: 600,
                        cursor: testing[integration.key] ? 'wait' : 'pointer',
                        opacity: testing[integration.key] ? 0.6 : 1,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      <i className={testing[integration.key] ? 'bi-arrow-repeat' : 'bi-plug'} style={{
                        fontSize: 12,
                        ...(testing[integration.key] ? { animation: 'spin 1s linear infinite' } : {}),
                      }} />
                      {testing[integration.key] ? 'Testing...' : 'Test Connection'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Endpoints */}
              {configured && status[integration.key]?.endpoints && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #e8e8e8' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#9e9e9e', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Available Endpoints
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {status[integration.key].endpoints.map(ep => (
                      <code key={ep} style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 6,
                        background: '#f5f5f5', color: '#616161',
                        fontFamily: 'SF Mono, monospace',
                      }}>
                        {ep}
                      </code>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Help text */}
      <div style={{
        marginTop: 20, padding: '14px 18px', borderRadius: 12,
        background: '#f7f5f2', fontSize: 12, color: '#616161', lineHeight: 1.6,
      }}>
        <i className="bi-info-circle" style={{ marginRight: 6 }} />
        <strong>Setup:</strong> To configure integrations, add the required environment variables on Nexus
        (Project → Settings → Environment Variables). After adding keys, redeploy the app for changes to take effect.
        <br /><br />
        <strong>Available integrations:</strong>
        <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
          <li><strong>Deel Admin</strong> — requires a Deel API token from the Developer Portal</li>
          <li><strong>Jira</strong> — requires Atlassian API token + base URL + email</li>
          <li><strong>Slack</strong> — requires a Bot User OAuth Token (xoxb-...) with channels:history, chat:write, users:read scopes</li>
        </ul>
      </div>

      {/* Refresh button */}
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => { refresh(); if (addToast) addToast('info', 'Refreshed', 'Integration status updated'); }}
          style={{
            height: 32, padding: '0 16px', borderRadius: 128,
            border: '1px solid #e8e8e8', background: 'var(--surface)',
            color: '#616161', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <i className="bi-arrow-clockwise" style={{ fontSize: 12 }} />
          Refresh Status
        </button>
      </div>
    </div>
  );
}
