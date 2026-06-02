'use client';

// ── Command Center · placeholder report page ────────────────────────────────
// A deliberate, executive-looking "being wired" state for report tabs that are
// still being built out, so the department app is fully navigable. Each tab is
// replaced by its real sections as the build progresses (see COMMAND_CENTER_PLAN.md).

import React from 'react';
import { Card, CC_ACCENT } from '../ccUi';

export default function ComingSoonPage({ title, icon = 'bi-hourglass-split', description, sections = [] }) {
  return (
    <div>
      <Card style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: 'var(--surface-2)', color: CC_ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
          <i className={`bi ${icon}`} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.6 }}>{description}</div>
          {sections.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
              {sections.map(s => (
                <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)', background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '5px 10px', borderRadius: 999 }}>
                  <i className="bi bi-hourglass-split" style={{ opacity: 0.6 }} /> {s}
                </span>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
