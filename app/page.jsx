'use client';

import { useState, useEffect } from 'react';
import App from '../src/App';
import ErrorBoundary from '../src/components/ui/ErrorBoundary';
import { GoogleOAuthProvider } from '@react-oauth/google';

export default function Page() {
  const [googleClientId, setGoogleClientId] = useState(
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''
  );
  const [configLoaded, setConfigLoaded] = useState(
    !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  );

  // Fetch Google Client ID at runtime — build-time env vars are empty in Docker standalone
  useEffect(() => {
    if (!configLoaded) {
      fetch('/api/v1/config')
        .then(r => r.ok ? r.json() : null)
        .then(cfg => {
          if (cfg?.googleClientId) setGoogleClientId(cfg.googleClientId);
        })
        .catch(() => {})
        .finally(() => setConfigLoaded(true));
    }
  }, []);

  // Wait for config before rendering to avoid App remount when provider wraps it
  if (!configLoaded) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(160deg, #faf8f5 0%, #f0ede8 40%, #e8e3dc 100%)',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}>
        <div style={{ textAlign: 'center', color: '#9e9e9e' }}>
          <div style={{
            width: 32, height: 32, border: '3px solid #e0ddd8',
            borderTopColor: '#1b1b1b', borderRadius: '50%',
            animation: 'spin 0.6s linear infinite',
            margin: '0 auto 12px',
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      {googleClientId ? (
        <GoogleOAuthProvider clientId={googleClientId}>
          <App />
        </GoogleOAuthProvider>
      ) : (
        <App />
      )}
    </ErrorBoundary>
  );
}
