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

    // 2026-05-19 — windowed-vs-element scroll fallback. The Queue scroller
    // div uses `flex: 1, overflowY: auto` inside a flex parent that
    // sometimes isn't height-constrained (no `100vh` up the chain). When
    // that's the case the div's content overflows the viewport and the
    // WINDOW scrolls instead — el.scrollTop stays 0 forever, the
    // virtualizer renders only the first window of rows, and the user
    // sees a giant empty spacer below them. Detect at sync time which
    // scroller is actually doing the work and listen to that one.
    const isElScrollable = () => el.scrollHeight > el.clientHeight + 10;
    const elTopInDoc = () => {
      let top = 0;
      let node = el;
      while (node) { top += node.offsetTop || 0; node = node.offsetParent; }
      return top;
    };
    const onScroll = () => {
      if (isElScrollable()) {
        setScrollTop(el.scrollTop);
      } else {
        // Translate window scroll into el-relative scroll. Below the
        // el's top in the document → effective scrollTop. Above → 0.
        const effective = Math.max(0, (window.scrollY || 0) - elTopInDoc());
        setScrollTop(effective);
      }
    };
    const sync = () => {
      onScroll();
      // Viewport: if the el itself scrolls, its clientHeight is what
      // we render against. If the window scrolls, the window's
      // innerHeight is the visible band.
      setViewportHeight(isElScrollable() ? (el.clientHeight || 600) : (window.innerHeight || 600));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', sync, { passive: true });
    sync();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(sync);
      ro.observe(el);
    }
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', sync);
      if (ro) ro.disconnect();
    };
    // scrollerRef is a ref object — not part of the dep array intentionally;
    // the effect runs once on mount and tears down on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the underlying list shrinks (filter toggled, background polling
  // refresh returning fewer rows, etc.) the browser clamps `el.scrollTop`
  // to the new max but does NOT always fire a scroll event for the clamp.
  // Our React `scrollTop` state then stays stale, the virtualizer computes
  // a startIdx past the new `total`, slice(startIdx, endIdx) returns
  // nothing, and the user sees only the topPad spacer — i.e. an empty
  // page where rows should be ("Zendesk Q doesn't show the full list",
  // reported 2026-05-15). Re-read scrollTop whenever rowCount changes so
  // the React state matches what the browser actually shows.
  useEffect(() => {
    const el = scrollerRef?.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowCount]);

  const total = Math.max(0, rowCount);
  // Belt-and-suspenders clamp: even before the rowCount effect re-syncs
  // scrollTop on the next tick, render against an effective scrollTop that
  // never exceeds the actual content's max. Without this the very first
  // render after a shrink slices an empty window and the user briefly sees
  // a blank table — the recovery shouldn't depend on a follow-up re-render.
  const maxScrollTop = Math.max(0, total * rowHeight - viewportHeight);
  const effectiveScrollTop = Math.min(scrollTop, maxScrollTop);
  const startIdx = Math.max(0, Math.floor(effectiveScrollTop / rowHeight) - overscan);
  const endIdx = Math.min(total, Math.ceil((effectiveScrollTop + viewportHeight) / rowHeight) + overscan);
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
