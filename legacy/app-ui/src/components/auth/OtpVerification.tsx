import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Loader2, Mail, ShieldCheck } from 'lucide-react';

interface OtpVerificationProps {
  email: string;
  purpose: 'signup' | 'reset';
  isLoading: boolean;
  error?: string;
  onVerify: (otp: string) => void;
  onResend: () => void;
  onBack: () => void;
}

const OTP_LENGTH = 6;

export function OtpVerification({
  email,
  purpose,
  isLoading,
  error,
  onVerify,
  onResend,
  onBack,
}: OtpVerificationProps) {
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [resendCooldown, setResendCooldown] = useState(30);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const next = [...digits];

    if (value.length > 1) {
      const pasted = value.slice(0, OTP_LENGTH).split('');
      for (let i = 0; i < pasted.length && index + i < OTP_LENGTH; i++) {
        next[index + i] = pasted[i];
      }
      setDigits(next);
      const focusIdx = Math.min(index + pasted.length, OTP_LENGTH - 1);
      inputRefs.current[focusIdx]?.focus();

      if (next.every((d) => d !== '')) {
        onVerify(next.join(''));
      }
      return;
    }

    next[index] = value;
    setDigits(next);

    if (value && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    if (next.every((d) => d !== '')) {
      onVerify(next.join(''));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleResend = () => {
    setResendCooldown(30);
    setDigits(Array(OTP_LENGTH).fill(''));
    onResend();
    inputRefs.current[0]?.focus();
  };

  const title = purpose === 'signup' ? 'Verify your email' : 'Enter reset code';
  const subtitle = purpose === 'signup'
    ? 'We sent a 6-digit code to verify your email'
    : 'We sent a 6-digit code to reset your password';

  return (
    <div className="w-full max-w-[380px] space-y-7 animate-fade-in">
      <button
        onClick={onBack}
        disabled={isLoading}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      <div className="flex flex-col items-center text-center space-y-3">
        <div className="w-14 h-14 rounded-full bg-emerald/10 flex items-center justify-center">
          {purpose === 'signup' ? (
            <Mail className="w-7 h-7 text-emerald" />
          ) : (
            <ShieldCheck className="w-7 h-7 text-emerald" />
          )}
        </div>
        <div className="space-y-1.5">
          <h2 className="text-2xl font-bold text-foreground tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
          <p className="text-sm text-foreground font-medium">{email}</p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-destructive/8 border border-destructive/20 animate-slide-up">
          <div className="w-4 h-4 rounded-full bg-destructive/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <div className="w-1.5 h-1.5 rounded-full bg-destructive" />
          </div>
          <p className="text-sm text-destructive leading-snug">{error}</p>
        </div>
      )}

      <div className="flex justify-center gap-2.5">
        {digits.map((digit, i) => (
          <Input
            key={i}
            ref={(el) => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={OTP_LENGTH}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            disabled={isLoading}
            className="w-12 h-14 text-center text-xl font-bold bg-surface border-border focus-visible:border-emerald/60 focus-visible:ring-emerald/20 text-foreground transition-button"
          />
        ))}
      </div>

      <Button
        onClick={() => onVerify(digits.join(''))}
        disabled={isLoading || digits.some((d) => !d)}
        className="w-full h-10 border border-input text-foreground hover:bg-muted font-semibold transition-button"
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          'Verify Code'
        )}
      </Button>

      <div className="text-center">
        <span className="text-sm text-muted-foreground">Didn't receive the code? </span>
        {resendCooldown > 0 ? (
          <span className="text-sm text-muted-foreground/60">Resend in {resendCooldown}s</span>
        ) : (
          <button
            onClick={handleResend}
            disabled={isLoading}
            className="text-sm text-emerald hover:text-emerald/80 font-medium transition-colors disabled:opacity-50"
          >
            Resend code
          </button>
        )}
      </div>
    </div>
  );
}
