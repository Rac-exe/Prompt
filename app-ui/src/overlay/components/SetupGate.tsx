import React from 'react';

interface SetupGateProps {
  onOpenApp: () => void;
}

/** Shown instead of the composer until an OpenRouter API key is saved. */
const SetupGate: React.FC<SetupGateProps> = ({ onOpenApp }) => (
  <div
    className="view active"
    style={{
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '48px 32px',
      textAlign: 'center',
      gap: 20,
    }}
  >
    <div className="auth-icon-ring">
      <svg style={{ width: 28, height: 28, color: 'hsl(var(--muted-foreground))' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
        />
      </svg>
    </div>
    <div>
      <h3
        style={{
          fontSize: 17,
          fontWeight: 700,
          color: 'hsl(var(--foreground))',
          marginBottom: 6,
          letterSpacing: '-0.02em',
        }}
      >
        Connect your AI provider
      </h3>
      <p
        style={{
          fontSize: 13,
          color: 'hsl(var(--muted-foreground))',
          lineHeight: 1.5,
          maxWidth: 260,
          margin: '0 auto',
        }}
      >
        Add your OpenRouter API key in the Prmpt app (Settings &gt; AI provider) to start optimizing prompts.
      </p>
    </div>
    <button
      className="btn-primary"
      onClick={onOpenApp}
      style={{
        WebkitAppRegion: 'no-drag' as any,
        height: 40,
        padding: '0 24px',
        borderRadius: 12,
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
      </svg>
      Open Prmpt
    </button>
  </div>
);

export default React.memo(SetupGate);
