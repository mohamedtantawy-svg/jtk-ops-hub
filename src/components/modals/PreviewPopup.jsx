import { COMMS_TYPES } from '../../data/comms';
import { renderRichText } from '../../utils/renderRichText';
import AnnouncementMedia from '../ui/AnnouncementMedia';

const PreviewPopup = ({ draft, onClose, onConfirmSend }) => {
  const typeInfo = COMMS_TYPES[draft.type] || COMMS_TYPES.announce;
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  // Render body text with bullet point + inline-link support so the preview
  // matches what recipients will actually see in the published popup.
  const renderBody = (text) => {
    if (!text) return null;
    const lines = text.split('\n');
    return lines.map((line, i) => {
      const trimmed = line.trim();
      if (/^[•\-\*]\s/.test(trimmed)) {
        return (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 3 }}>
            <span style={{ color: typeInfo.color, flexShrink: 0, lineHeight: '20px' }}>&bull;</span>
            <span style={{ lineHeight: '20px' }}>{renderRichText(trimmed.replace(/^[•\-\*]\s*/, ''), { color: typeInfo.color, keyPrefix: `pv-${i}` })}</span>
          </div>
        );
      }
      if (trimmed === '') return <div key={i} style={{ height: 8 }} />;
      return <div key={i} style={{ marginBottom: 3, lineHeight: '20px' }}>{renderRichText(line, { color: typeInfo.color, keyPrefix: `pv-${i}` })}</div>;
    });
  };

  const targetLabel = draft.target === 'all' ? 'All Teams' : draft.target;
  const priorityColors = {
    high: { bg: '#ffe2de', color: '#d42d35' },
    medium: { bg: '#fff8e6', color: '#ed8d00' },
    low: { bg: '#f0f0f0', color: 'var(--text-secondary)' },
  };
  const prio = priorityColors[draft.priority] || priorityColors.medium;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 800,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface)', borderRadius: 16, width: '100%', maxWidth: 600,
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden',
          animation: 'modalIn .18s cubic-bezier(.34,1.56,.64,1) forwards',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px', display: 'flex', alignItems: 'center',
          borderBottom: '1px solid #e8e8e8',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <i className="bi-eye-fill" style={{ fontSize: 16, color: 'var(--text-secondary)' }} />
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Preview</span>
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: '50%', background: '#f2f2f2',
              border: 'none', cursor: 'pointer', color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
            }}
          >
            <i className="bi-x-lg" />
          </button>
        </div>

        {/* Scrollable preview area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {/* Simulated popup card */}
          <div style={{
            border: `1.5px solid ${typeInfo.border}`, borderRadius: 12,
            overflow: 'hidden', background: 'var(--surface)',
          }}>
            {/* Colored top bar */}
            <div style={{
              height: 6, background: typeInfo.color,
            }} />

            <div style={{ padding: '20px' }}>
              {/* Type badge */}
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 128,
                background: typeInfo.bg, border: `1px solid ${typeInfo.border}`,
                marginBottom: 14,
              }}>
                <i className={typeInfo.icon} style={{ fontSize: 11, color: typeInfo.color }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: typeInfo.color, textTransform: 'uppercase', letterSpacing: '.03em' }}>
                  {typeInfo.label}
                </span>
              </div>

              {/* Title */}
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 12, lineHeight: 1.35 }}>
                {draft.title || 'Untitled'}
              </div>

              {/* Meta row */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                marginBottom: 16, fontSize: 12, color: 'var(--text-muted)',
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <i className="bi-person-fill" style={{ fontSize: 11 }} />
                  {draft.author?.name || 'Unknown'}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <i className="bi-calendar3" style={{ fontSize: 11 }} />
                  {today}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <i className="bi-people-fill" style={{ fontSize: 11 }} />
                  {targetLabel}
                </span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 128,
                  background: prio.bg, color: prio.color,
                  fontSize: 11, fontWeight: 600, textTransform: 'capitalize',
                }}>
                  {draft.priority}
                </span>
              </div>

              {/* Body */}
              <div style={{ fontSize: 13, color: '#333', lineHeight: 1.6, marginBottom: 16 }}>
                {renderBody(draft.body)}
              </div>

              {/* Media (image or video) */}
              {draft.imageUrl && (
                <div style={{ marginBottom: 16 }}>
                  <AnnouncementMedia
                    src={draft.imageUrl}
                    alt="Attachment"
                    style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)', maxHeight: 240, objectFit: 'cover' }}
                  />
                </div>
              )}

              {/* Link */}
              {draft.link && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px',
                  background: '#f7f7f7', borderRadius: 8, marginBottom: 16,
                  fontSize: 12, color: '#1f74b3', wordBreak: 'break-all',
                }}>
                  <i className="bi-link-45deg" style={{ fontSize: 14, flexShrink: 0 }} />
                  <span style={{ textDecoration: 'underline' }}>{draft.link}</span>
                </div>
              )}

              {/* Acknowledge button preview */}
              <div style={{
                borderTop: '1px solid #e8e8e8', paddingTop: 16,
                display: 'flex', justifyContent: 'center',
              }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '10px 28px', borderRadius: 128,
                  background: '#1b1b1b', color: 'white',
                  fontSize: 13, fontWeight: 600, opacity: 0.6,
                  cursor: 'default',
                }}>
                  <i className="bi-check2-circle" style={{ fontSize: 13 }} />
                  I Acknowledge
                </div>
              </div>
            </div>
          </div>

          {/* Note */}
          <div style={{
            marginTop: 16, padding: '12px 14px', borderRadius: 8,
            background: '#f7f7f7', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5,
            display: 'flex', gap: 8, alignItems: 'flex-start',
          }}>
            <i className="bi-info-circle" style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }} />
            <span>
              This is how recipients will see the popup announcement. It will require acknowledgment before they can dismiss it.
            </span>
          </div>
        </div>

        {/* Footer buttons */}
        <div style={{
          padding: '16px 24px 24px', display: 'flex', gap: 10, justifyContent: 'flex-end',
          borderTop: '1px solid #e8e8e8',
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'var(--surface)', border: '1px solid #dedede', color: 'var(--text)',
              borderRadius: 128, padding: '10px 24px', fontSize: 13,
              cursor: 'pointer', fontWeight: 500, transition: 'background .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#f7f7f7'}
            onMouseLeave={e => e.currentTarget.style.background = 'white'}
          >
            Go Back
          </button>
          <button
            onClick={onConfirmSend}
            style={{
              background: '#1b1b1b', color: 'white', border: 'none',
              borderRadius: 128, padding: '10px 28px', fontSize: 13,
              cursor: 'pointer', fontWeight: 600, display: 'flex',
              alignItems: 'center', gap: 6, transition: 'opacity .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '.85'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            <i className="bi-send-fill" style={{ fontSize: 11 }} />
            Confirm & Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default PreviewPopup;
