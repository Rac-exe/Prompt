import React from 'react';
import darkLogo from "@/assets/logos/dark-logo-svg.svg";
import lightLogo from "@/assets/logos/light-logo-svg.svg";
import { useIsDark } from "@/hooks/useIsDark";

export type OverlayMode = 'chat' | 'spaces';

interface HeaderProps {
  onClose: () => void;
  onNewSession: () => void;
  /** Which mode the overlay is currently showing. Drives the active-pill
   *  highlight inside the segmented control. */
  activeMode: OverlayMode;
  /** Called when the user clicks a different pill. No-op when the clicked
   *  pill already matches activeMode (parent still filters). */
  onModeChange: (mode: OverlayMode) => void;
  /** Live `index_status` of the currently attached Space's folder. Purely
   *  used to render a tiny dot next to the "Spaces" pill so the user can
   *  see at-a-glance whether the Space they're about to route into is
   *  ready. Null when no Space is attached — the pill renders without the
   *  dot in that case. */
  spaceStatus?: string | null;
}

// Minimal colour map for the status dot. Mirrors the `STATUS_META` palette
// in the main SpaceWorkspace + the overlay's existing space pill so the
// user sees the same visual language everywhere.
const STATUS_DOT: Record<string, string> = {
  ready: 'hsl(142 70% 45%)',
  indexing: 'hsl(38 92% 50%)',
  stale: 'hsl(38 92% 50%)',
  error: 'hsl(0 72% 51%)',
};

const Header: React.FC<HeaderProps> = ({ onClose, onNewSession, activeMode, onModeChange, spaceStatus }) => {
  const isDark = useIsDark();
  const statusColor = spaceStatus ? STATUS_DOT[spaceStatus] ?? null : null;

  return (
  <div
    style={{
      WebkitAppRegion: 'drag' as any,
      padding: '14px 18px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0,
      gap: 10,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      {/* Theme-aware logo — single img, JS-driven */}
      <img
        src={isDark ? lightLogo : darkLogo}
        alt="Prmpt"
        style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }}
      />
      <div style={{ minWidth: 0 }}>
        <span className="text-gradient-primary" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em' }}>
          Prmpt
        </span>
        <span
          style={{ fontSize: 10, fontWeight: 500, color: 'hsl(var(--muted-foreground))', marginLeft: 6, letterSpacing: '0.02em' }}
        >
          OVERLAY
        </span>
      </div>
    </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' as any }}>
      {/* Mode switcher — segmented control.
          Persists the user's last-active mode (see overlay App.tsx) so
          reopening the overlay lands them back where they left. Switching
          is always allowed — even mid-stream — because chunks route to
          their originating mode via streamingModeRef, not the active one. */}
      <div
        role="tablist"
        aria-label="Overlay mode"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: 2,
          background: 'hsl(var(--muted) / 0.35)',
          border: '1px solid hsl(var(--border) / 0.6)',
          borderRadius: 9,
        }}
      >
        <button
          role="tab"
          aria-selected={activeMode === 'chat'}
          onClick={() => activeMode !== 'chat' && onModeChange('chat')}
          title="Normal chat — no folder context"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 9px',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '-0.005em',
            borderRadius: 6,
            border: 'none',
            cursor: activeMode === 'chat' ? 'default' : 'pointer',
            background: activeMode === 'chat' ? 'hsl(var(--background))' : 'transparent',
            color: activeMode === 'chat' ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
            boxShadow: activeMode === 'chat' ? '0 1px 2px rgb(0 0 0 / 0.08)' : 'none',
            transition: 'background 140ms, color 140ms, box-shadow 140ms',
          }}
        >
          <svg style={{ width: 11, height: 11, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          Chat
        </button>
        <button
          role="tab"
          aria-selected={activeMode === 'spaces'}
          onClick={() => activeMode !== 'spaces' && onModeChange('spaces')}
          title="Spaces — optimize with your codebase context"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 9px',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '-0.005em',
            borderRadius: 6,
            border: 'none',
            cursor: activeMode === 'spaces' ? 'default' : 'pointer',
            background: activeMode === 'spaces' ? 'hsl(var(--background))' : 'transparent',
            color: activeMode === 'spaces' ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
            boxShadow: activeMode === 'spaces' ? '0 1px 2px rgb(0 0 0 / 0.08)' : 'none',
            transition: 'background 140ms, color 140ms, box-shadow 140ms',
          }}
        >
          <svg style={{ width: 11, height: 11, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
          Spaces
          {statusColor && activeMode === 'spaces' && (
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: statusColor,
                flexShrink: 0,
                marginLeft: 1,
                boxShadow: `0 0 0 2px ${statusColor}33`,
                animation: spaceStatus === 'indexing' ? 'overlay-status-pulse 1.4s ease-in-out infinite' : undefined,
              }}
            />
          )}
        </button>
      </div>

      {/* New Session — always clears the currently-active mode's bundle
          only; the other mode's conversation is preserved for when the
          user flips back to it. */}
      <button
        className="btn-ghost"
        title={`New session (${activeMode === 'chat' ? 'Chat' : 'Spaces'})`}
        onClick={onNewSession}
        style={{ width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      </button>
      {/* Close */}
      <button
        className="btn-ghost"
        onClick={onClose}
        style={{ width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
  );
};

export default React.memo(Header);
