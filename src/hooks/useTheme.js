// ── useTheme — reactive current theme ('dark' | 'light') ───────────────────
// The app applies its theme as a `data-theme` attribute on <html> (App.jsx
// hydrates it from localStorage on mount; the user-menu toggle writes it
// straight to the DOM). There is no React theme context, so a component that
// needs to branch its rendering on the theme — e.g. to avoid flooding a wide
// surface with a light-mode literal background — can't just read a prop.
//
// This hook reads the attribute and re-renders the caller whenever it changes
// by observing the attribute with a MutationObserver. Returns 'light' on the
// server / before mount so SSR + the first client paint agree.

import { useEffect, useState } from 'react';

function readTheme() {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState(readTheme);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined;
    const el = document.documentElement;
    const obs = new MutationObserver(() => setTheme(readTheme()));
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    // Catch a change that happened between the initial render and the
    // observer attaching (e.g. App.jsx's mount effect setting the attribute).
    setTheme(readTheme());
    return () => obs.disconnect();
  }, []);

  return theme;
}
