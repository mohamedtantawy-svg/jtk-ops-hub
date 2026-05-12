'use client';

import dynamic from 'next/dynamic';
import ErrorBoundary from '../src/components/ui/ErrorBoundary';

// ── Why ssr:false on the App tree ─────────────────────────────────────────
// React 19 + Next.js 16 strict-hydrate every client component. Our App
// reads enough mutable browser state in its very first render — auth
// (localStorage `ops_hub_logged_in_email` + `ops_hub_user`), routing
// (`?view=` URL param), theme (localStorage `ops_hub_theme` in the side
// + top nav), and a long tail of cached hooks (useFeedback,
// useNotifications, useIntegrations, etc.) — that the SSR pass and the
// client first render produce structurally different DOM. React detects
// the divergence and throws #418 ("Hydration failed because the server
// rendered HTML didn't match the client"), then tears the tree down
// and re-renders the entire app client-side.
//
// 2026-05-11 prod console showed #418 firing 2–3 times per page nav,
// most loudly on Feedback / HR Hub. PR #543 fixed the App.jsx
// localStorage initialisers + the FeedbackView URL-param read, but the
// dark-mode initialisers in DeelSidebar/DeelTopNav and the auth-state
// initialisers (which can't be SSR-defaulted to null without flashing
// the login screen for every signed-in user) keep the mismatch alive.
//
// The whole App tree is already inside this `'use client'` page, so the
// SSR pass produces only a minimal shell that's immediately replaced on
// client mount — we get ~zero SEO / perceived-perf benefit from SSR'ing
// it, but pay the full hydration-storm cost. Skipping SSR with
// `dynamic({ ssr: false })` removes the divergence surface entirely.
// Trade-off: the initial HTML returns the `loading` placeholder below
// (instead of a hydrated shell) until the JS chunk loads — ~300–500 ms
// on a cold connection, basically invisible on warm. Net win: no
// hydration mismatch on any subsequent navigation, no per-nav re-render
// storm, and a meaningfully faster Feedback/HR-Hub first paint (the
// pre-warm defer in #542 + this change compound).
// ─────────────────────────────────────────────────────────────────────────

// WorkspaceRouter decides which workspace app to mount (HR Hub stays the
// default fallback; Command Center / Payroll / GIX live under
// src/workspaces/<team>/). Same ssr:false reasoning as before — all the
// downstream apps are heavy client components that read localStorage at
// first render, so SSR'ing this tree just causes hydration churn.
const WorkspaceRouter = dynamic(() => import('../src/workspaces/_shared/WorkspaceRouter'), {
  ssr: false,
  loading: () => (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg, #f5f5f7)',
      color: 'var(--text-muted, #6b6b6b)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: 14,
    }}>
      Loading Ops Hub…
    </div>
  ),
});

export default function Page() {
  return (
    <ErrorBoundary>
      <WorkspaceRouter />
    </ErrorBoundary>
  );
}
