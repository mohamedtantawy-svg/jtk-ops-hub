// ── useVirtualRows — table-friendly windowing hook ─────────────────────────
// Renders only the rows visible in the scroll container's viewport,
// padded by `overscan` rows above and below. The caller renders two
// spacer <tr>s (top + bottom) with computed heights so the scrollbar
// position + content sizing stay correct without paying the cost of
// laying out every row.
//
// Why a custom hook instead of react-window: react-window doesn't
// compose with native <table> markup (it expects div + position:absolute).
// The Queue tables rely on real <thead>/<tbody> for sticky headers,
// column alignment, and accessibility. This hook keeps the table
// intact — the only contract for callers is that every <tr> renders at
// approximately `rowHeight` pixels (lock with `height: rowHeight,
// whiteSpace: 'nowrap', overflow: 'hidden'`).
//
// Performance budget context: with Jira at 3,046 rows × 9 columns, the
// pre-virtualization render produced ~27,000 DOM nodes per repaint,
// which is what made tab-switch feel "very, very long". Virtualizing
// down to ~30 rows per viewport drops that to ~270 nodes — repaint
// time is bounded by the viewport, not the dataset.

import { useEffect, useState, useCallback } from 'react';

export function useVirtualRows({ rowCount, rowHeight = 44, overscan = 8, scrollerRef }) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  useEffect(() => {
    const el = scrollerRef?.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const sync = () => {
      setScrollTop(el.scrollTop);
      setViewportHeight(el.clientHeight || 600);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    sync();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(sync);
      ro.observe(el);
    }
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (ro) ro.disconnect();
    };
    // scrollerRef is a ref object — not part of the dep array intentionally;
    // the effect runs once on mount and tears down on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = Math.max(0, rowCount);
  const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIdx = Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  const topPad = Math.max(0, startIdx * rowHeight);
  const bottomPad = Math.max(0, (total - endIdx) * rowHeight);

  // Imperative scroll-to-top — used when callers swap the underlying
  // dataset (filter change, panel switch) so the scroll position doesn't
  // bleed across what's now a different list.
  const resetScroll = useCallback(() => {
    if (scrollerRef?.current) scrollerRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [scrollerRef]);

  return { startIdx, endIdx, topPad, bottomPad, resetScroll };
}
