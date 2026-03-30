import React, { useState, useEffect, useCallback } from 'react';

const TYPE_CONFIG = {
  alert:    { label: 'Alert',        icon: 'bi-exclamation-triangle-fill', color: '#d42d35', bg: '#ffe2de', border: '#FCA5A5' },
  announce: { label: 'Announcement', icon: 'bi-megaphone-fill',            color: '#ed8d00', bg: '#fff8e6', border: '#FCD34D' },
  update:   { label: 'Update',       icon: 'bi-arrow-up-circle-fill',      color: '#1f74b3', bg: '#e8f0fe', border: '#c7e2fe' },
  guidance: { label: 'Guidance',     icon: 'bi-book-half',                 color: '#c4b1f9', bg: '#f3eff8', border: '#c4b1f9' },
  kudos:    { label: 'Kudos',        icon: 'bi-trophy-fill',               color: '#29811e', bg: '#F0FDF4', border: '#c2eeb5' },
};

const PRIORITY_COLORS = {
  high:   '#d42d35',
  medium: '#ed8d00',
  low:    '#29811e',
};

function playNotificationChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    // First tone (lower)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, now); // C5
    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    // Second tone (higher)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(659.25, now + 0.15); // E5
    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.setValueAtTime(0.18, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.5);

    // Clean up context after sounds finish
    setTimeout(() => ctx.close(), 600);
  } catch (_) {
    // Audio not available — silently ignore
  }
}

function formatBody(body) {
  if (!body) return null;
  const lines = body.split('\n');
  return lines.map((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('\u2022')) {
      return (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, paddingLeft: 8 }}>
          <span style={{ color: '#6b7280', flexShrink: 0 }}>{'\u2022'}</span>
          <span>{trimmed.slice(1).trim()}</span>
        </div>
      );
    }
    if (trimmed === '') {
      return <div key={i} style={{ height: 8 }} />;
    }
    return (
      <div key={i} style={{ marginBottom: 4 }}>
        {line}
      </div>
    );
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (_) {
    return dateStr;
  }
}

export default function AnnouncementPopup({ comm, onAcknowledge }) {
  const config = TYPE_CONFIG[comm.type] || TYPE_CONFIG.announce;
  const priorityColor = PRIORITY_COLORS[comm.priority] || PRIORITY_COLORS.low;

  // Block Escape key dismissal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  // Play chime on mount
  useEffect(() => {
    playNotificationChime();
  }, []);

  const [acking, setAcking] = useState(false);
  const handleAcknowledge = useCallback(() => {
    setAcking(true);
    setTimeout(() => onAcknowledge(comm.id), 400);
  }, [onAcknowledge, comm.id]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(2px)',
        padding: 24,
      }}
      // Prevent click-outside dismissal — overlay click does nothing
      onClick={(e) => e.stopPropagation()}
    >
      {/* Card */}
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: 16,
          maxWidth: 560,
          width: '100%',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 48px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.08)',
          overflow: 'hidden',
          animation: 'popupFadeIn 0.25s ease-out',
        }}
      >
        {/* Scrollable content area */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 32,
          }}
        >
          {/* Type badge + priority row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                backgroundColor: config.bg,
                color: config.color,
                border: `1px solid ${config.border}`,
                borderRadius: 128,
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              <i className={`bi ${config.icon}`} style={{ fontSize: 14 }} />
              {config.label}
            </div>

            {/* Priority dot */}
            {comm.priority && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280' }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: priorityColor,
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                <span style={{ textTransform: 'capitalize' }}>{comm.priority} priority</span>
              </div>
            )}
          </div>

          {/* Title */}
          <h2
            style={{
              margin: '0 0 16px 0',
              fontSize: 22,
              fontWeight: 700,
              color: '#111827',
              lineHeight: 1.3,
            }}
          >
            {comm.title}
          </h2>

          {/* Meta: author, date, audience */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
              fontSize: 13,
              color: '#6b7280',
              marginBottom: 20,
              lineHeight: 1.4,
            }}
          >
            {comm.author?.name && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <i className="bi bi-person-fill" style={{ fontSize: 14 }} />
                {comm.author.name}
              </span>
            )}
            {comm.sentAt && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <i className="bi bi-clock" style={{ fontSize: 13 }} />
                {formatDate(comm.sentAt)}
              </span>
            )}
            {comm.target && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <i className="bi bi-people-fill" style={{ fontSize: 14 }} />
                {comm.target}
              </span>
            )}
          </div>

          {/* Image */}
          {comm.imageUrl && (
            <div style={{ marginBottom: 20 }}>
              <img
                src={comm.imageUrl}
                alt=""
                style={{
                  width: '100%',
                  borderRadius: 10,
                  display: 'block',
                  objectFit: 'cover',
                  maxHeight: 280,
                }}
              />
            </div>
          )}

          {/* Body */}
          <div
            style={{
              fontSize: 15,
              lineHeight: 1.65,
              color: '#374151',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {formatBody(comm.body)}
          </div>

          {/* Link button */}
          {comm.link && (
            <a
              href={comm.link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 16,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                color: config.color,
                backgroundColor: config.bg,
                border: `1px solid ${config.border}`,
                borderRadius: 128,
                textDecoration: 'none',
                cursor: 'pointer',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              <i className="bi bi-box-arrow-up-right" style={{ fontSize: 13 }} />
              Open Link
            </a>
          )}

          {/* Pinned indicator */}
          {comm.isPinned && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                marginTop: 16,
                fontSize: 12,
                color: '#9ca3af',
              }}
            >
              <i className="bi bi-pin-fill" style={{ fontSize: 12 }} />
              Pinned announcement
            </div>
          )}
        </div>

        {/* Acknowledge button — fixed at bottom */}
        <div
          style={{
            padding: '16px 32px 24px 32px',
            borderTop: '1px solid #f3f4f6',
            backgroundColor: '#fff',
          }}
        >
          <button
            onClick={handleAcknowledge}
            disabled={acking}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '14px 24px',
              backgroundColor: acking ? '#29811e' : '#111827',
              color: '#fff',
              border: 'none',
              borderRadius: 128,
              fontSize: 15,
              fontWeight: 600,
              cursor: acking ? 'default' : 'pointer',
              transition: 'all 0.25s',
              lineHeight: 1,
            }}
            onMouseEnter={(e) => { if (!acking) e.currentTarget.style.backgroundColor = '#1f2937'; }}
            onMouseLeave={(e) => { if (!acking) e.currentTarget.style.backgroundColor = '#111827'; }}
          >
            <i className={acking ? 'bi bi-check-lg' : 'bi bi-check-circle-fill'} style={{ fontSize: 16 }} />
            {acking ? 'Acknowledged!' : 'Acknowledge'}
          </button>
        </div>
      </div>

      {/* Keyframe animation (injected inline) */}
      <style>{`
        @keyframes popupFadeIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
