import { useState, useEffect, useRef } from 'react';
import { FLAGS } from '../data/constants';

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
  background: '#fff',
  borderRadius: 24,
  boxShadow: '0 4px 40px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.04)',
  width: '100%',
  maxWidth: 440,
  padding: 40,
  position: 'relative',
  overflow: 'hidden',
};
const inputStyle = {
  width: '100%',
  height: 48,
  border: '1.5px solid #e0ddd8',
  borderRadius: 14,
  padding: '0 16px',
  fontSize: 15,
  color: '#1b1b1b',
  outline: 'none',
  fontFamily: 'inherit',
  transition: 'border-color .2s, box-shadow .2s',
  boxSizing: 'border-box',
  background: '#faf8f5',
};
const btnPrimary = {
  width: '100%',
  height: 50,
  background: '#1b1b1b',
  color: '#fff',
  border: 'none',
  borderRadius: 14,
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'all .2s',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};
const labelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: '#1b1b1b',
  marginBottom: 6,
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
const profileCard = {
  background: '#f7f5f2',
  borderRadius: 16,
  padding: '16px 18px',
  marginBottom: 20,
  display: 'flex',
  alignItems: 'center',
  gap: 14,
};
const googleBtnStyle = {
  width: '100%',
  height: 50,
  background: '#fff',
  color: '#1b1b1b',
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

const LoginScreen = ({ userAccessMap, accessTypes, onLogin }) => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [matchedUser, setMatchedUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [googleAuthUrl, setGoogleAuthUrl] = useState('');
  const inputRef = useRef(null);

  // Fetch Google auth URL at runtime
  useEffect(() => {
    fetch('/api/v1/config')
      .then(r => r.ok ? r.json() : null)
      .then(cfg => { if (cfg?.googleAuthUrl) setGoogleAuthUrl(cfg.googleAuthUrl); })
      .catch(() => {});
  }, []);

  // Auto-focus email input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Live lookup as user types
  useEffect(() => {
    const trimmed = email.trim().toLowerCase();
    if (trimmed && userAccessMap[trimmed]) {
      const u = userAccessMap[trimmed];
      const at = accessTypes.find(t => t.id === u.accessTypeId);
      setMatchedUser({ ...u, email: trimmed, accessTypeName: at?.name || 'Agent' });
      setError('');
    } else {
      setMatchedUser(null);
    }
  }, [email, userAccessMap, accessTypes]);

  const handleGoogleClick = () => {
    if (googleAuthUrl) {
      window.location.href = googleAuthUrl;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();

    if (!trimmed) {
      setError('Please enter your email address');
      return;
    }
    if (!trimmed.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await onLogin(trimmed, rememberMe);
    } catch (err) {
      let msg = err?.body?.error || err?.message || 'Login failed. Please try again.';
      if (msg === 'Failed to fetch' || msg === 'Load failed') {
        msg = 'Unable to reach the server. Please check your connection and try again.';
      }
      setError(msg);
      setLoading(false);
    }
  };

  const initials = matchedUser?.name
    ? matchedUser.name.split(' ').map(w => w.charAt(0).toUpperCase()).slice(0, 2).join('')
    : '';

  return (
    <div style={wrap}>
      {/* Top bar */}
      <div style={{ padding: '20px 32px', display: 'flex', alignItems: 'center' }}>
        <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 28, color: '#1b1b1b' }}>d.</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#9e9e9e', marginLeft: 12 }}>Ops Hub</span>
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
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1b1b1b', margin: '0 0 4px' }}>
              Sign in to Ops Hub
            </h1>
            <p style={{ fontSize: 13, color: '#9e9e9e', margin: 0 }}>
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

          {/* Matched user preview */}
          {matchedUser && (
            <div style={profileCard} className="fade-in">
              <div style={{
                width: 42, height: 42, borderRadius: '50%',
                background: matchedUser.status === 'offboarding' ? '#ed8d00' : '#c4b1f9',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 14, fontWeight: 700, flexShrink: 0,
              }}>
                {initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1b1b1b' }}>
                  {FLAGS?.[matchedUser.country] || ''} {matchedUser.name}
                </div>
                <div style={{ fontSize: 12, color: '#7a7059', marginTop: 1 }}>
                  {matchedUser.title || matchedUser.accessTypeName}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 6,
                    background: '#f0ede8', color: '#7a7059',
                  }}>
                    {matchedUser.accessTypeName}
                  </span>
                  {matchedUser.region && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 6,
                      background: '#e8f0fe', color: '#1f74b3',
                    }}>
                      {matchedUser.region}
                    </span>
                  )}
                  {matchedUser.team && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 6,
                      background: '#e6f4e5', color: '#29811e',
                    }}>
                      {matchedUser.team}
                    </span>
                  )}
                  {matchedUser.status === 'offboarding' && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 6,
                      background: '#fff3e0', color: '#ed8d00',
                    }}>
                      Offboarding
                    </span>
                  )}
                </div>
              </div>
              <i className="bi-check-circle-fill" style={{ color: '#29811e', fontSize: 18, flexShrink: 0 }} />
            </div>
          )}

          {/* Google Sign-In */}
          {googleAuthUrl && (
            <div style={{ marginBottom: 20 }}>
              <button
                type="button"
                onClick={handleGoogleClick}
                style={googleBtnStyle}
                onMouseEnter={e => { e.currentTarget.style.background = '#f7f5f2'; e.currentTarget.style.borderColor = '#1b1b1b'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#e0ddd8'; }}
              >
                <svg width="18" height="18" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
                Sign in with Google
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 0' }}>
                <div style={{ flex: 1, height: 1, background: '#e0ddd8' }} />
                <span style={{ fontSize: 12, color: '#9e9e9e', fontWeight: 500 }}>or sign in with email</span>
                <div style={{ flex: 1, height: 1, background: '#e0ddd8' }} />
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Work Email</label>
              <div style={{ position: 'relative' }}>
                <i className="bi-envelope" style={{
                  position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 14, color: '#9e9e9e',
                }} />
                <input
                  ref={inputRef}
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(''); }}
                  placeholder="you@deel.com"
                  style={{ ...inputStyle, paddingLeft: 42 }}
                  onFocus={e => { e.target.style.borderColor = '#1b1b1b'; e.target.style.boxShadow = '0 0 0 3px rgba(27,27,27,.08)'; e.target.style.background = '#fff'; }}
                  onBlur={e => { e.target.style.borderColor = '#e0ddd8'; e.target.style.boxShadow = 'none'; e.target.style.background = '#faf8f5'; }}
                  autoComplete="email"
                  spellCheck="false"
                />
              </div>
            </div>

            {/* Remember me */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#616161', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  style={{ accentColor: '#1b1b1b' }}
                />
                Remember me
              </label>
            </div>

            {/* Sign in button */}
            <button
              type="submit"
              disabled={loading}
              style={{
                ...btnPrimary,
                opacity: loading ? 0.7 : 1,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#333'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#1b1b1b'; }}
            >
              {loading ? (
                <>
                  <div style={{
                    width: 18, height: 18, border: '2px solid rgba(255,255,255,.3)',
                    borderTopColor: '#fff', borderRadius: '50%',
                    animation: 'spin 0.6s linear infinite',
                  }} />
                  Signing in...
                </>
              ) : (
                <>
                  <i className="bi-box-arrow-in-right" style={{ fontSize: 16 }} />
                  Sign In
                </>
              )}
            </button>
          </form>

          {/* Help text */}
          <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: '#9e9e9e' }}>
            Don't have access? Contact your administrator.
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
