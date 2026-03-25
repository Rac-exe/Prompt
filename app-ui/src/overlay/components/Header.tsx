import React from 'react';
import darkLogo from "@/assets/logos/dark-logo-svg.svg";
import lightLogo from "@/assets/logos/light-logo-svg.svg";
import { useIsDark } from "@/hooks/useIsDark";

interface HeaderProps {
  onClose: () => void;
  onNewSession: () => void;
}

const Header: React.FC<HeaderProps> = ({ onClose, onNewSession }) => {
  const isDark = useIsDark();
  return (
  <div
    style={{
      WebkitAppRegion: 'drag' as any,
      padding: '14px 18px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {/* Theme-aware logo — single img, JS-driven */}
      <img
        src={isDark ? lightLogo : darkLogo}
        alt="Prmpt"
        style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }}
      />
      <div>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'hsl(var(--foreground))', letterSpacing: '-0.01em' }}>
          Prmpt
        </span>
        <span
          style={{ fontSize: 10, fontWeight: 500, color: 'hsl(var(--muted-foreground))', marginLeft: 6, letterSpacing: '0.02em' }}
        >
          OVERLAY
        </span>
      </div>
    </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: 4, WebkitAppRegion: 'no-drag' as any }}>
      {/* New Session */}
      <button
        className="btn-ghost"
        title="New Session"
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
