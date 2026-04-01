import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Logo } from "@/components/ui/Logo";
import {
  Lightning, Sparkle, ChatText, Books, Microphone,
  At, Brain, CaretRight, CursorClick, ArrowRight,
  Minus, Square, X,
} from '@phosphor-icons/react';

/* ─────────────────────────────────────────────────────────────
   Feature data
   ───────────────────────────────────────────────────────────── */
const FEATURES = [
  {
    icon: At,
    glow: 'from-amber-500/30 to-orange-500/20',
    accent: 'text-amber-400',
    accentBg: 'bg-amber-500/10 border-amber-500/20',
    badge: 'Signature Feature',
    title: '@prompt Anywhere',
    subtitle: 'Global prompt optimization',
    description:
      'Type @prompt in any text field across your system. An intelligent overlay appears instantly — your text is optimized in real-time and replaced with a single click.',
    visual: 'at-prompt',
  },
  {
    icon: Sparkle,
    glow: 'from-blue-500/30 to-indigo-500/20',
    accent: 'text-blue-400',
    accentBg: 'bg-blue-500/10 border-blue-500/20',
    badge: 'Core Engine',
    title: 'AI Optimization',
    subtitle: 'From rough to refined',
    description:
      'Paste any rough prompt and watch it transform. Our AI restructures, clarifies, and amplifies your intent into precision-engineered output.',
    visual: 'optimize',
  },
  {
    icon: Brain,
    glow: 'from-violet-500/30 to-purple-500/20',
    accent: 'text-violet-400',
    accentBg: 'bg-violet-500/10 border-violet-500/20',
    badge: 'Personalized',
    title: 'Memory & Context',
    subtitle: 'It learns your style',
    description:
      'The app learns your writing style, preferred tone, and domain context over time. Every optimization feels tailor-made because it is.',
    visual: 'memory',
  },
  {
    icon: ChatText,
    glow: 'from-emerald-500/30 to-teal-500/20',
    accent: 'text-emerald-400',
    accentBg: 'bg-emerald-500/10 border-emerald-500/20',
    badge: 'Smart Chat',
    title: 'Prompt Studio',
    subtitle: 'Conversational refinement',
    description:
      'Chat naturally with the optimizer. It remembers context, iterates on feedback, and gets smarter the more you use it.',
    visual: 'chat',
  },
  {
    icon: Books,
    glow: 'from-rose-500/30 to-pink-500/20',
    accent: 'text-rose-400',
    accentBg: 'bg-rose-500/10 border-rose-500/20',
    badge: 'Organize',
    title: 'Prompt Library',
    subtitle: 'Save & organize everything',
    description:
      'Save your best prompts, organize them into collections, and access them instantly. Build your personal prompt toolkit.',
    visual: 'library',
  },
  {
    icon: Microphone,
    glow: 'from-cyan-500/30 to-sky-500/20',
    accent: 'text-cyan-400',
    accentBg: 'bg-cyan-500/10 border-cyan-500/20',
    badge: 'Hands-Free',
    title: 'Voice Input',
    subtitle: 'Speak your prompts',
    description:
      'Dictate your prompts hands-free. Real-time transcription captures your thoughts and feeds them directly into the optimizer.',
    visual: 'voice',
  },
] as const;

const AUTO_ADVANCE_MS = 6000;
const TRANSITION_MS = 500;

/* ─────────────────────────────────────────────────────────────
   Visual illustrations
   ───────────────────────────────────────────────────────────── */
function FeatureVisual({ type }: { type: string }) {
  switch (type) {
    case 'at-prompt':
      return (
        <div className="w-full">
          {/* Mock text editor */}
          <div className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5 space-y-3 relative overflow-hidden">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-red-500/50" />
              <div className="w-2 h-2 rounded-full bg-amber-500/50" />
              <div className="w-2 h-2 rounded-full bg-emerald-500/50" />
              <span className="ml-auto text-[9px] text-muted-foreground/25 font-mono">editor.app</span>
            </div>
            <div className="font-mono text-xs text-foreground/60 leading-relaxed">
              <span className="text-muted-foreground/40">Hey team, here's the brief: </span>
              <span className="text-amber-400 font-semibold bg-amber-500/10 px-1 rounded">@prompt</span>
              <span className="animate-pulse text-amber-400">|</span>
            </div>
            {/* Overlay popup */}
            <div className="mt-2 rounded-xl border border-amber-500/25 bg-card/90 backdrop-blur-xl shadow-elevated p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-amber-500/15 flex items-center justify-center">
                  <Lightning size={12} weight="light" className="text-amber-400" />
                </div>
                <span className="text-[11px] font-semibold text-foreground/80">Prmpt</span>
                <span className="ml-auto text-[8px] text-muted-foreground/30 font-mono bg-secondary/60 px-1.5 py-0.5 rounded">@prompt</span>
              </div>
              <div className="rounded-lg border border-border/20 bg-surface/40 p-2.5">
                <p className="text-[10px] text-foreground/70 leading-relaxed">
                  "Act as a senior content strategist. Draft a concise, data-driven campaign brief targeting enterprise decision-makers…"
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-400 bg-amber-500/12 border border-amber-500/20 px-3 py-1.5 rounded-lg">
                  <CursorClick size={12} weight="light" />
                  Replace
                </button>
                <span className="text-[8px] text-muted-foreground/30">One click to insert</span>
              </div>
            </div>
          </div>
        </div>
      );
    case 'optimize':
      return (
        <div className="w-full">
          <div className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5 space-y-3">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-red-500/50" />
              <div className="w-2 h-2 rounded-full bg-amber-500/50" />
              <div className="w-2 h-2 rounded-full bg-emerald-500/50" />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[9px] font-mono text-muted-foreground/30 w-7 text-right shrink-0">IN</span>
              <p className="text-xs text-muted-foreground/40 line-through font-mono">
                make me a good prompt about marketing
              </p>
            </div>
            <div className="flex items-center gap-3 py-1">
              <span className="w-7 shrink-0" />
              <div className="flex items-center gap-2">
                <div className="w-8 h-px bg-gradient-to-r from-blue-500/60 to-indigo-500/60 animate-pulse" />
                <Sparkle size={12} weight="light" className="text-blue-400 animate-pulse" />
                <div className="w-8 h-px bg-gradient-to-r from-indigo-500/60 to-blue-500/60 animate-pulse" />
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-[9px] font-mono text-blue-400/60 w-7 text-right mt-0.5 shrink-0">OUT</span>
              <p className="text-xs text-foreground/80 font-mono leading-relaxed">
                "Act as a senior digital marketing strategist. Create a data-driven campaign brief for a B2B SaaS product launch targeting enterprise CTOs…"
              </p>
            </div>
          </div>
        </div>
      );
    case 'memory':
      return (
        <div className="w-full">
          <div className="rounded-2xl border border-violet-500/15 bg-card/40 backdrop-blur-sm p-5 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Brain size={14} weight="light" className="text-violet-400/80" />
              <span className="text-[11px] font-medium text-foreground/70">Your Preferences</span>
              <span className="ml-auto text-[8px] text-emerald-400/80 bg-emerald/8 px-1.5 py-0.5 rounded-full font-medium">Active</span>
            </div>
            {[
              { label: 'Writing Style', value: 'Professional & concise', icon: '✍️' },
              { label: 'Default Tone', value: 'Confident, data-driven', icon: '🎯' },
              { label: 'Industry', value: 'B2B SaaS / Technology', icon: '💼' },
              { label: 'Format', value: 'Structured with headers', icon: '📋' },
            ].map((pref) => (
              <div key={pref.label} className="flex items-center gap-3 rounded-lg border border-border/20 bg-surface/30 p-2.5">
                <span className="text-xs">{pref.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">{pref.label}</p>
                  <p className="text-[11px] text-foreground/70 font-medium truncate">{pref.value}</p>
                </div>
                <div className="w-1 h-1 rounded-full bg-violet-400/50" />
              </div>
            ))}
          </div>
        </div>
      );
    case 'chat':
      return (
        <div className="w-full space-y-3">
          <div className="flex justify-end">
            <div className="max-w-[78%] rounded-2xl rounded-tr-md bg-emerald/10 border border-emerald/15 px-4 py-2.5">
              <p className="text-xs text-foreground/80">Can you make this more persuasive?</p>
            </div>
          </div>
          <div className="flex justify-start">
            <div className="max-w-[82%] rounded-2xl rounded-tl-md bg-card/50 border border-border/30 px-4 py-2.5">
              <p className="text-xs text-foreground/70 leading-relaxed">
                Absolutely! I've added power verbs, social proof hooks, and a clear CTA. The tone is now confident yet conversational…
              </p>
              <div className="flex items-center gap-1 mt-2">
                <div className="w-1 h-1 rounded-full bg-emerald-400/70 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1 h-1 rounded-full bg-emerald-400/70 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1 h-1 rounded-full bg-emerald-400/70 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <div className="max-w-[70%] rounded-2xl rounded-tr-md bg-emerald/10 border border-emerald/15 px-4 py-2.5">
              <p className="text-xs text-foreground/80">Perfect, now shorten it to 2 sentences</p>
            </div>
          </div>
        </div>
      );
    case 'library':
      return (
        <div className="w-full grid grid-cols-2 gap-2.5">
          {[
            { name: 'Marketing', count: 12, color: 'border-rose-500/20 bg-rose-500/5' },
            { name: 'Code Review', count: 8, color: 'border-blue-500/20 bg-blue-500/5' },
            { name: 'Creative', count: 15, color: 'border-pink-500/20 bg-pink-500/5' },
            { name: 'Research', count: 6, color: 'border-amber-500/20 bg-amber-500/5' },
          ].map((col) => (
            <div key={col.name} className={`rounded-xl border ${col.color} p-3.5 space-y-2`}>
              <div className="flex items-center justify-between">
                <Books size={14} weight="light" className="text-muted-foreground/50" />
                <span className="text-[9px] text-muted-foreground/40">{col.count} prompts</span>
              </div>
              <p className="text-xs font-medium text-foreground/70">{col.name}</p>
              <div className="space-y-1">
                <div className="h-0.5 rounded-full bg-border/30 w-full" />
                <div className="h-0.5 rounded-full bg-border/30 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      );
    case 'voice':
      return (
        <div className="w-full flex flex-col items-center gap-5 py-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-cyan-500/15 animate-ping" style={{ animationDuration: '2s' }} />
            <div className="absolute -inset-3 rounded-full bg-cyan-500/8 animate-ping" style={{ animationDuration: '2.5s', animationDelay: '0.3s' }} />
            <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-cyan-500 to-sky-600 flex items-center justify-center shadow-lg shadow-cyan-500/25">
              <Microphone size={24} weight="light" className="text-white" />
            </div>
          </div>
          <div className="flex items-end gap-0.5 h-7">
            {Array.from({ length: 24 }).map((_, i) => (
              <div
                key={i}
                className="w-0.5 rounded-full bg-cyan-400/50"
                style={{
                  height: `${10 + Math.sin(i * 0.7) * 10 + Math.random() * 6}px`,
                  animation: 'pulse 1.5s ease-in-out infinite',
                  animationDelay: `${i * 70}ms`,
                }}
              />
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground/40 font-mono tracking-wide">
            "Optimize my email campaign prompt…"
          </p>
        </div>
      );
    default:
      return null;
  }
}

/* ─────────────────────────────────────────────────────────────
   OnboardingPage
   ───────────────────────────────────────────────────────────── */
interface OnboardingPageProps {
  onComplete: () => void;
  userName?: string;
}

export function OnboardingPage({ onComplete, userName }: OnboardingPageProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [mounted, setMounted] = useState(false);
  const isPausedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLast = activeIndex === FEATURES.length - 1;
  const feature = FEATURES[activeIndex];
  const Icon = feature.icon;

  // Mount animation
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  // Step label: "01", "02", etc.
  const stepLabel = useMemo(() => String(activeIndex + 1).padStart(2, '0'), [activeIndex]);
  const totalLabel = useMemo(() => String(FEATURES.length).padStart(2, '0'), []);

  /* ── Transition wrapper ────────────────────────────────── */
  const transitionTo = useCallback((idx: number) => {
    if (isTransitioning || idx === activeIndex) return;
    setIsTransitioning(true);
    // After exit animation, swap content
    setTimeout(() => {
      setActiveIndex(idx);
      // After content swap, start enter animation
      setTimeout(() => setIsTransitioning(false), 30);
    }, TRANSITION_MS / 2);
  }, [isTransitioning, activeIndex]);

  /* ── Auto-advance timer ────────────────────────────────── */
  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!isPausedRef.current) {
        const next = activeIndex < FEATURES.length - 1 ? activeIndex + 1 : 0;
        transitionTo(next);
      }
    }, AUTO_ADVANCE_MS);
  }, [activeIndex, transitionTo]);

  useEffect(() => {
    if (!isTransitioning) scheduleNext();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [activeIndex, isTransitioning, scheduleNext]);

  /* ── Navigation helpers ────────────────────────────────── */
  const goNext = useCallback(() => {
    if (isLast) { onComplete(); return; }
    transitionTo(activeIndex + 1);
  }, [isLast, onComplete, activeIndex, transitionTo]);

  const goPrev = useCallback(() => {
    if (activeIndex > 0) transitionTo(activeIndex - 1);
  }, [activeIndex, transitionTo]);

  /* ── Keyboard navigation ───────────────────────────────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      if (e.key === 'Escape') { onComplete(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev, onComplete]);

  /* ── Progress bar animation ────────────────────────────── */
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    setProgress(0);
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const elapsed = now - start;
      setProgress(Math.min(elapsed / AUTO_ADVANCE_MS, 1));
      if (elapsed < AUTO_ADVANCE_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeIndex]);

  // Overall progress across all slides
  const overallProgress = (activeIndex + progress) / FEATURES.length;

  /* ── Transition classes ─────────────────────────────────── */
  const contentClass = isTransitioning
    ? 'opacity-0 translate-y-3 scale-[0.98]'
    : 'opacity-100 translate-y-0 scale-100';
  const visualClass = isTransitioning
    ? 'opacity-0 scale-95 translate-y-2'
    : 'opacity-100 scale-100 translate-y-0';

  /* ─── Render ───────────────────────────────────────────── */
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-background overflow-hidden select-none transition-opacity duration-700 ${mounted ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* ── Subtle grid pattern (matches login page) ── */}
      <div
        className="absolute inset-0 opacity-[0.02] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px),
                            linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
          backgroundSize: '56px 56px',
        }}
      />

      {/* ── Window title bar (draggable) ── */}
      <div
        className="absolute top-0 left-0 right-0 h-9 z-30 flex items-center justify-end select-none"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div
          className="flex items-center h-full"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={() => window.electronAPI?.windowControls?.minimize()}
            aria-label="Minimise"
            className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150"
          >
            <Minus size={14} weight="light" />
          </button>
          <button
            onClick={() => window.electronAPI?.windowControls?.maximize()}
            aria-label="Maximise"
            className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150"
          >
            <Square size={12} weight="light" />
          </button>
          <button
            onClick={() => window.electronAPI?.windowControls?.close()}
            aria-label="Close"
            className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-white hover:bg-red-500/80 transition-colors duration-150"
          >
            <X size={14} weight="light" />
          </button>
        </div>
      </div>

      {/* ── Top progress bar ── */}
      <div className="absolute top-9 left-0 right-0 h-[2px] bg-border/30 z-20">
        <div
          className="h-full bg-emerald transition-none rounded-r-full"
          style={{ width: `${overallProgress * 100}%` }}
        />
      </div>

      {/* ── Top bar ── */}
      <div className="relative z-10 flex items-center justify-between px-8 pt-14 pb-4">
        <div className="flex items-center gap-3">
          <Logo size="w-8 h-8" />
          <span className="font-bold text-foreground text-sm tracking-tight">Prmpt</span>
        </div>
        <button
          onClick={onComplete}
          className="flex items-center gap-1.5 text-xs text-muted-foreground/40 hover:text-muted-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-secondary"
        >
          Skip
          <ArrowRight size={12} weight="light" />
        </button>
      </div>

      {/* ── Main content — side by side ── */}
      <div className="relative z-10 flex-1 flex items-center px-8 lg:px-16 pb-6">
        <div className="w-full max-w-6xl mx-auto flex items-center gap-12 lg:gap-20">

          {/* ── Left: Text content ── */}
          <div className="flex-1 min-w-0 max-w-md">
            <div className={`transition-all duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${contentClass}`}>
              {/* Step counter */}
              <div className="flex items-center gap-3 mb-8">
                <span className="text-[11px] font-mono text-muted-foreground/30 tabular-nums">
                  {stepLabel}
                </span>
                <div className="flex-1 h-px bg-border/30 max-w-[40px]" />
                <span className="text-[11px] font-mono text-muted-foreground/20 tabular-nums">
                  {totalLabel}
                </span>
              </div>

              {/* Badge */}
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${feature.accentBg} mb-5`}>
                <Icon size={12} weight="light" className={feature.accent} />
                <span className={`text-[10px] font-semibold tracking-wide uppercase ${feature.accent}`}>
                  {feature.badge}
                </span>
              </div>

              {/* Title */}
              <h1 className="text-3xl lg:text-4xl font-bold text-foreground leading-[1.15] tracking-tight mb-3">
                {feature.title}
              </h1>

              {/* Subtitle */}
              <p className="text-sm text-muted-foreground/50 font-medium mb-5">
                {feature.subtitle}
              </p>

              {/* Description */}
              <p className="text-sm text-muted-foreground/60 leading-relaxed mb-10">
                {feature.description}
              </p>

              {/* Navigation */}
              <div className="flex items-center gap-3">
                {activeIndex > 0 && (
                  <button
                    onClick={goPrev}
                    className="flex items-center gap-1.5 text-sm font-medium py-2.5 px-5 rounded-xl border border-border/50 text-foreground/70 hover:text-foreground hover:bg-secondary hover:border-border transition-all duration-200"
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={goNext}
                  className={`flex items-center gap-2.5 text-sm font-semibold py-2.5 px-6 rounded-xl transition-all duration-200 ${
                    isLast
                      ? 'bg-emerald text-white hover:bg-emerald/90 glow-emerald-sm'
                      : 'bg-secondary hover:bg-secondary/80 text-foreground'
                  }`}
                >
                  {isLast ? 'Get Started' : 'Next'}
                  {isLast ? <Lightning size={14} weight="light" /> : <CaretRight size={14} weight="light" />}
                </button>
              </div>
            </div>
          </div>

          {/* ── Right: Visual illustration ── */}
          <div
            className="flex-1 min-w-0 max-w-lg relative"
            onMouseEnter={() => { isPausedRef.current = true; }}
            onMouseLeave={() => { isPausedRef.current = false; }}
          >
            {/* Ambient glow behind the card */}
            <div className={`absolute inset-0 -inset-x-10 -inset-y-10 rounded-full bg-gradient-radial ${feature.glow} blur-[80px] opacity-60 pointer-events-none transition-all duration-1000`} />

            {/* Visual frame */}
            <div className={`relative transition-all duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${visualClass}`}>
              <FeatureVisual type={feature.visual} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom: Step indicators ── */}
      <div className="relative z-10 flex items-center justify-center gap-6 px-8 pb-6">
        {/* Step dots */}
        <div className="flex items-center gap-2">
          {FEATURES.map((_, i) => {
            const isActive = i === activeIndex;
            return (
              <button
                key={i}
                onClick={() => transitionTo(i)}
                className="relative group py-2"
                aria-label={`Feature ${i + 1}`}
              >
                <div
                  className={`rounded-full transition-all duration-400 ${
                    isActive
                      ? 'w-6 h-1.5 bg-emerald'
                      : i < activeIndex
                        ? 'w-1.5 h-1.5 bg-emerald/35'
                        : 'w-1.5 h-1.5 bg-border group-hover:bg-muted-foreground/30'
                  }`}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Keyboard hint ── */}
      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex items-center gap-3 text-[9px] text-muted-foreground/20">
        <span>← → navigate</span>
        <span>·</span>
        <span>ESC skip</span>
      </div>
    </div>
  );
}
