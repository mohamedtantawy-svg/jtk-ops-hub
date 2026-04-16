'use client';

import { useEffect, useState } from 'react';

const wrap = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(160deg, #faf8f5 0%, #f0ede8 40%, #e8e3dc 100%)',
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

export default function AuthCallback() {
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // Collect all query params the proxy sends back
    const payload = {};
    for (const [key, value] of params.entries()) {
      payload[key] = value;
    }

    if (Object.keys(payload).length === 0) {
      setError('No authentication data received. Please try signing in again.');
      return;
    }

    // Check for error from proxy
    if (payload.error) {
      setError(payload.error_description || payload.error || 'Authentication failed.');
      return;
    }

    // Log what the proxy sent back (for debugging)
    console.log('[auth/callback] Proxy returned keys:', Object.keys(payload));

    // Exchange proxy callback data for an app session
    fetch('/api/v1/auth/google/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const debugInfo = data?.debug_keys ? ` [proxy keys: ${data.debug_keys.join(', ')}]` : '';
          throw new Error((data?.error || `Authentication failed (${res.status})`) + debugInfo);
        }
        return data;
      })
      .then((data) => {
        if (data?.token) {
          localStorage.setItem('ops_hub_token', data.token);
          // Mark the exact moment the token was stored so that the session
          // revalidation in App.jsx can skip the immediate fetchMe() call
          // for fresh logins — the token was JUST created, no need to verify.
          localStorage.setItem('ops_hub_token_ts', String(Date.now()));
          try { sessionStorage.setItem('ops_hub_fresh_login', '1'); } catch {}
        }
        if (data?.user?.email) {
          localStorage.setItem('ops_hub_logged_in_email', data.user.email);
        }
        if (data?.user) {
          try { localStorage.setItem('ops_hub_user', JSON.stringify(data.user)); } catch {}
        }
        // Redirect to app — App.jsx will pick up the session from localStorage
        window.location.href = '/';
      })
      .catch((err) => {
        setError(err.message || 'Authentication failed. Please try again.');
      });
  }, []);

  if (error) {
    return (
      <div style={wrap}>
        <div style={{
          background: '#fff', borderRadius: 24, padding: 40, maxWidth: 440, width: '100%',
          boxShadow: '0 4px 40px rgba(0,0,0,.06)', textAlign: 'center',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: '#fef2f2',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <i className="bi-exclamation-triangle-fill" style={{ color: '#dc2626', fontSize: 24 }} />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1b1b1b', margin: '0 0 8px' }}>
            Sign-in Failed
          </h2>
          <p style={{ fontSize: 14, color: '#616161', margin: '0 0 24px', lineHeight: 1.5 }}>
            {error}
          </p>
          <a
            href="/"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '12px 24px', background: '#1b1b1b', color: '#fff',
              borderRadius: 12, fontSize: 14, fontWeight: 600, textDecoration: 'none',
            }}
          >
            <i className="bi-arrow-left" style={{ fontSize: 14 }} />
            Back to Sign In
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={{ textAlign: 'center', color: '#9e9e9e' }}>
        <div style={{
          width: 32, height: 32, border: '3px solid #e0ddd8',
          borderTopColor: '#1b1b1b', borderRadius: '50%',
          animation: 'spin 0.6s linear infinite',
          margin: '0 auto 12px',
        }} />
        <div style={{ fontSize: 14, fontWeight: 500 }}>Completing sign-in...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
