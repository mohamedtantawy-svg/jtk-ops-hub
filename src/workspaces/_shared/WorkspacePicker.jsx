'use client';

import { useEffect, useState } from 'react';

import { WORKSPACES, PICKER_ORDER, SELECTED_WORKSPACE_KEY } from './workspaceRegistry';

// Pre-auth workspace picker. Renders before SSO so users can pick which
// workspace to enter — solves the case where one person is on multiple
// allowlists (e.g. a manager spanning HRX + Payroll). On click:
//   1. Save selected workspace id to localStorage.
//   2. Redirect to the Google OAuth URL (fetched from /api/v1/config — the
//      same endpoint HR's LoginScreen uses).
// After OAuth returns to `/`, WorkspaceRouter reads the saved selection and
// the new email together to route + validate access.

const wrap = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'linear-gradient(160deg, #faf8f5 0%, #f0ede8 40%, #e8e3dc 100%)',
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  color: '#1b1b1b',
};

const topBar = {
  padding: '20px 32px',
  display: 'flex',
  alignItems: 'center',
};

const brand = {
  fontFamily: 'Georgia, serif',
  fontWeight: 700,
  fontSize: 28,
  color: '#1b1b1b',
};

const brandSub = {
  fontSize: 14,
  fontWeight: 600,
  color: '#9e9e9e',
  marginLeft: 12,
};

const main = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '40px 20px',
};

const container = {
  width: '100%',
  maxWidth: 1080,
};

const headerWrap = {
  textAlign: 'center',
  marginBottom: 36,
};

const heading = {
  fontSize: 30,
  fontWeight: 700,
  color: '#1b1b1b',
  margin: 0,
};

const subheading = {
  fontSize: 15,
  color: '#6b6b6b',
  margin: '8px 0 0',
};

const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 20,
};

const cardBase = {
  background: '#fff',
  borderRadius: 20,
  padding: 28,
  boxShadow: '0 4px 24px rgba(0,0,0,.04), 0 1px 3px rgba(0,0,0,.03)',
  border: '1px solid #ece8e1',
  cursor: 'pointer',
  textAlign: 'left',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  position: 'relative',
  overflow: 'hidden',
  transition: 'transform .15s ease, box-shadow .15s ease, border-color .15s ease',
  width: '100%',
  fontFamily: 'inherit',
};

const cardBaseDisabled = {
  ...cardBase,
  cursor: 'not-allowed',
  opacity: 0.6,
};

const accentBar = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 4,
};

const iconCircle = {
  width: 48,
  height: 48,
  borderRadius: 14,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 22,
};

const cardTitle = {
  fontSize: 18,
  fontWeight: 700,
  color: '#1b1b1b',
  margin: 0,
};

const cardDesc = {
  fontSize: 13,
  color: '#6b6b6b',
  margin: 0,
  lineHeight: 1.5,
  flex: 1,
};

const cardCta = {
  fontSize: 13,
  fontWeight: 600,
  color: '#1b1b1b',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 4,
};

const previouslyPickedBadge = {
  display: 'inline-block',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  color: '#1b1b1b',
  background: '#fff3e0',
  border: '1px solid #ffdfb3',
  padding: '2px 8px',
  borderRadius: 999,
  marginLeft: 8,
};

const footer = {
  textAlign: 'center',
  padding: '16px 0 24px',
  fontSize: 12,
  color: '#bbb',
};

const errorBar = {
  maxWidth: 600,
  margin: '0 auto 20px',
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 12,
  padding: '10px 14px',
  fontSize: 13,
  color: '#dc2626',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

function tintBackground(hex) {
  // Lightweight 12%-opacity tint for the icon circle. Avoids shipping a
  // dependency just to manipulate colors.
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.12)`;
}

export default function WorkspacePicker({ initialSelected, accessDeniedFor }) {
  const [googleAuthUrl, setGoogleAuthUrl] = useState('');
  const [loadingWorkspace, setLoadingWorkspace] = useState(null);
  const [error, setError] = useState(accessDeniedFor ? `You don't have access to ${WORKSPACES[accessDeniedFor]?.label || 'that workspace'}. Pick a different one.` : '');

  useEffect(() => {
    fetch('/api/v1/config')
      .then(r => (r.ok ? r.json() : null))
      .then(cfg => { if (cfg?.googleAuthUrl) setGoogleAuthUrl(cfg.googleAuthUrl); })
      .catch(() => {});
  }, []);

  const handleCardClick = (workspaceId) => {
    if (loadingWorkspace) return;
    setError('');
    try { localStorage.setItem(SELECTED_WORKSPACE_KEY, workspaceId); } catch {}
    setLoadingWorkspace(workspaceId);
    if (googleAuthUrl) {
      window.location.href = googleAuthUrl;
    } else {
      // googleAuthUrl not loaded yet — surface a clear error rather than
      // silently doing nothing.
      setError('Sign-in is still loading. Try again in a moment.');
      setLoadingWorkspace(null);
    }
  };

  return (
    <div style={wrap}>
      <div style={topBar}>
        <span style={brand}>d.</span>
        <span style={brandSub}>Ops Hub</span>
      </div>

      <div style={main}>
        <div style={container}>
          <div style={headerWrap}>
            <h1 style={heading}>Welcome to Ops Hub</h1>
            <p style={subheading}>Pick your workspace to continue. You'll sign in with Google next.</p>
          </div>

          {error && (
            <div style={errorBar}>
              <i className="bi-exclamation-circle-fill" style={{ fontSize: 14, flexShrink: 0 }} />
              {error}
            </div>
          )}

          <div style={grid}>
            {PICKER_ORDER.map(id => {
              const ws = WORKSPACES[id];
              if (!ws) return null;
              const isLoading = loadingWorkspace === id;
              const isPreviouslyPicked = initialSelected === id;
              const disabled = !!loadingWorkspace && !isLoading;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleCardClick(id)}
                  onMouseEnter={e => {
                    if (disabled) return;
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,.08), 0 2px 6px rgba(0,0,0,.04)';
                    e.currentTarget.style.borderColor = ws.accent;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,.04), 0 1px 3px rgba(0,0,0,.03)';
                    e.currentTarget.style.borderColor = '#ece8e1';
                  }}
                  style={disabled ? cardBaseDisabled : cardBase}
                  aria-label={`Continue to ${ws.label}`}
                >
                  <div style={{ ...accentBar, background: ws.accent }} />
                  <div style={{ ...iconCircle, background: tintBackground(ws.accent), color: ws.accent }}>
                    <i className={ws.icon} />
                  </div>
                  <h2 style={cardTitle}>
                    {ws.label}
                    {isPreviouslyPicked && <span style={previouslyPickedBadge}>Last used</span>}
                  </h2>
                  <p style={cardDesc}>{ws.description}</p>
                  <div style={cardCta}>
                    {isLoading ? (
                      <>
                        <div style={{
                          width: 14, height: 14,
                          border: '2px solid rgba(0,0,0,.15)',
                          borderTopColor: ws.accent,
                          borderRadius: '50%',
                          animation: 'spin 0.6s linear infinite',
                        }} />
                        Redirecting…
                      </>
                    ) : (
                      <>
                        Continue with Google
                        <i className="bi-arrow-right" style={{ fontSize: 14 }} />
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={footer}>
        Deel · Ops Hub · Internal Use Only
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
