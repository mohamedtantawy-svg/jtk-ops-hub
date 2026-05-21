import { useState, useEffect } from 'react';

// ── Styles ────────────────────────────────────────────────────────────────────
const wrap = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'linear-gradient(160deg, #faf8f5 0%, #f0ede8 40%, #e8e3dc 100%)',
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};
const main = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '40px 20px',
};
const card = {
  background: 'var(--surface)',
  borderRadius: 24,
  boxShadow: '0 4px 40px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.04)',
  width: '100%',
  maxWidth: 440,
  padding: 40,
  position: 'relative',
  overflow: 'hidden',
};
const errorStyle = {
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 12,
  padding: '10px 14px',
  fontSize: 13,
  color: '#dc2626',
  marginBottom: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};
const googleBtnStyle = {
  width: '100%',
  height: 50,
  background: 'var(--surface)',
  color: 'var(--text)',
  border: '1.5px solid #e0ddd8',
  borderRadius: 14,
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'all .2s',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
};

const LoginScreen = ({ onLogin }) => {
  const [error, setError] = useState('');
  const [googleAuthUrl, setGoogleAuthUrl] = useState('');
  const [loading, setLoading] = useState(false);

  // Fetch Google auth URL at runtime
  useEffect(() => {
    fetch('/api/v1/config')
      .then(r => r.ok ? r.json() : null)
      .then(cfg => { if (cfg?.googleAuthUrl) setGoogleAuthUrl(cfg.googleAuthUrl); })
      .catch(() => {});
  }, []);

  const handleGoogleClick = () => {
    if (googleAuthUrl) {
      setLoading(true);
      window.location.href = googleAuthUrl;
    }
  };

  return (
    <div style={wrap}>
      {/* Top bar */}
      <div style={{ padding: '20px 32px', display: 'flex', alignItems: 'center' }}>
        <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 28, color: 'var(--text)' }}>d.</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)', marginLeft: 12 }}>Ops Hub</span>
      </div>

      <div style={main}>
        <div style={card}>
          {/* Decorative accent bar */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: 'linear-gradient(90deg, #1b1b1b 0%, #c4b1f9 50%, #1f74b3 100%)' }} />

          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, background: '#1b1b1b',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <i className="bi-shield-lock-fill" style={{ color: '#fff', fontSize: 24 }} />
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>
              Sign in to Ops Hub
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              HR Operations Command Center
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div style={errorStyle}>
              <i className="bi-exclamation-circle-fill" style={{ fontSize: 14, flexShrink: 0 }} />
              {error}
            </div>
          )}

          {/* Google Sign-In */}
          {googleAuthUrl ? (
            <button
              type="button"
              onClick={handleGoogleClick}
              disabled={loading}
              style={{
                ...googleBtnStyle,
                opacity: loading ? 0.7 : 1,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={e => { if (!loading) { e.currentTarget.style.background = '#f7f5f2'; e.currentTarget.style.borderColor = '#1b1b1b'; } }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#e0ddd8'; }}
            >
              {loading ? (
                <>
                  <div style={{
                    width: 18, height: 18, border: '2px solid rgba(0,0,0,.15)',
                    borderTopColor: '#1b1b1b', borderRadius: '50%',
                    animation: 'spin 0.6s linear infinite',
                  }} />
                  Redirecting...
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  </svg>
                  Sign in with Google
                </>
              )}
            </button>
          ) : (
            <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 13, color: 'var(--text-muted)' }}>
              Loading sign-in...
            </div>
          )}

          {/* Help text */}
          <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: 'var(--text-muted)' }}>
            Use your @deel.com Google account to sign in.
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', padding: '16px 0 24px', fontSize: 11, color: '#bbb' }}>
        Deel &middot; HR Operations Command Center &middot; Internal Use Only
      </div>

      {/* Spinner animation */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default LoginScreen;
