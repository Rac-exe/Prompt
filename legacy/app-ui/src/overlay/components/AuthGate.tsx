import React from 'react';

interface AuthGateProps {
  onOpenApp: () => void;
}

const AuthGate: React.FC<AuthGateProps> = ({ onOpenApp }) => (
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
          d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
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
        Login Required
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
        Sign in to your account to use the prompt optimizer.
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
      Open App to Login
    </button>
  </div>
);

export default React.memo(AuthGate);
