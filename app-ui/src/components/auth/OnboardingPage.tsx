import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Logo } from "@/components/ui/Logo";
import {
  Lightning, ChatText, Books, Microphone,
  At, Brain, CaretRight, ArrowRight,
  Minus, Square, X, Sun, Moon,
  Palette, Plus, Atom, FolderSimple,
} from '@phosphor-icons/react';
import { DEFAULT_SETTINGS, STORAGE_KEY, applySettings } from '@/lib/settings';
import type { SettingsData } from '@/lib/settings';
import { motion, AnimatePresence } from 'motion/react';
import darkLogoSvg from '@/assets/logos/dark-logo-svg.svg';
import { AIProviderForm } from '@/components/settings/AIProviderForm';

/* ─────────────────────────────────────────────────────────────
   Feature data
   ───────────────────────────────────────────────────────────── */
const FEATURES = [
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
] as const;

const TRANSITION_MS = 500;

/* ─────────────────────────────────────────────────────────────
   Color palette — matches the website showcase demos exactly
   ───────────────────────────────────────────────────────────── */
const C = {
  bg: '#FFF4ED',
  surface: '#FFF7F3',
  card: '#FFF9F6',
  sidebarBg: '#FFEDE3',
  border: '#F2D9CE',
  borderMedium: '#E8C8B7',
  fg: '#1E2A3B',
  fgMuted: '#4E5D6A',
  fgDim: '#8B96A0',
  primary: '#222429',
  primaryFg: '#FFFFFF',
  secondary: '#FDF2EC',
  accent: '#222429',
  inputBg: '#FFF7F3',
} as const;

/* ─────────────────────────────────────────────────────────────
   Mini UI primitives — exact replicas of MiniPrompt.tsx
   ───────────────────────────────────────────────────────────── */
function DemoPrmptLogo({ size = 32 }: { size?: number }) {
  return <img src={darkLogoSvg} alt="Prmpt" style={{ width: size, height: size, objectFit: 'contain' }} />;
}

function DemoLoadingDots() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 4px' }}>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
          style={{ width: 5, height: 5, borderRadius: '50%', background: C.fgDim }}
        />
      ))}
    </div>
  );
}

function DemoAnimatedCursor({ x, y, clicking = false, visible = true }: { x: number; y: number; clicking?: boolean; visible?: boolean }) {
  return (
    <motion.div
      animate={{ left: x, top: y, scale: clicking ? 0.82 : 1, opacity: visible ? 1 : 0 }}
      transition={{ type: 'spring', damping: 14, stiffness: 80, mass: 0.8, opacity: { duration: 0.3 } }}
      style={{ position: 'absolute', zIndex: 50, pointerEvents: 'none', left: x, top: y, width: 24, height: 24 }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.25))' }}>
        <path d="M5 3l14 8.5-6.5 1.5-3 6z" fill="#fff" stroke="#1E2A3B" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      {clicking && (
        <motion.div
          initial={{ scale: 0, opacity: 0.5 }}
          animate={{ scale: 3, opacity: 0 }}
          transition={{ duration: 0.5 }}
          style={{ position: 'absolute', top: 2, left: 2, width: 12, height: 12, borderRadius: '50%', background: 'rgba(34,36,41,0.15)' }}
        />
      )}
    </motion.div>
  );
}

function DemoMiniTitleBar() {
  return (
    <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 4px', background: C.bg, flexShrink: 0 }}>
      <div style={{ display: 'flex' }}>
        {['—', '□', '×'].map((b, i) => (
          <div key={i} style={{ width: 28, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: C.fgDim }}>{b}</div>
        ))}
      </div>
    </div>
  );
}

function DemoMiniInputBar({ text = '', placeholder = 'How can I help you today?', showCursor = false, focused = false }: { text?: string; placeholder?: string; showCursor?: boolean; focused?: boolean }) {
  const hasText = text.length > 0;
  return (
    <div style={{ margin: '0 14px 10px', background: C.card, border: `1px solid ${focused || hasText ? C.borderMedium : C.border}`, borderRadius: 14, overflow: 'hidden', transition: 'border-color 0.2s', boxShadow: focused ? '0 0 0 2px rgba(34,36,41,0.06)' : 'none' }}>
      <div style={{ padding: '10px 14px 4px', fontSize: 13, color: hasText ? C.fg : C.fgDim, minHeight: 32, lineHeight: 1.5, fontFamily: "'Geist', -apple-system, sans-serif" }}>
        {text || placeholder}
        {showCursor && (
          <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.6, repeat: Infinity }}
            style={{ display: 'inline-block', width: 1.5, height: 15, background: C.accent, marginLeft: 1, verticalAlign: 'middle' }} />
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 8px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.fgDim }}>
            <Plus size={13} weight="bold" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 26, padding: '0 8px', borderRadius: 6, fontSize: 11, color: C.fgMuted, fontWeight: 500 }}>
            <Atom size={11} weight="fill" />
            <span>Pro Mode</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.fgDim }}>
            <svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor"><path d="M128,176a48.05,48.05,0,0,0,48-48V64a48,48,0,0,0-96,0v64A48.05,48.05,0,0,0,128,176ZM96,64a32,32,0,0,1,64,0v64a32,32,0,0,1-64,0Zm40,143.6V232a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64,64,0,0,0,128,0,8,8,0,0,1,16,0A80.11,80.11,0,0,1,136,207.6Z" /></svg>
          </div>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: hasText ? C.accent : C.border, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={hasText ? C.primaryFg : C.fgDim} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoMiniMessage({ role, children, showActions = false }: { role: 'user' | 'assistant'; children: React.ReactNode; showActions?: boolean }) {
  const isUser = role === 'user';
  return (
    <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: C.fgDim, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 2px', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
        {isUser ? (
          <>You<div style={{ width: 14, height: 14, borderRadius: '50%', background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: C.primaryFg, fontWeight: 600 }}>T</div></>
        ) : (
          <><DemoPrmptLogo size={14} />Prmpt</>
        )}
      </div>
      <div style={{ padding: '8px 12px', borderRadius: 10, fontSize: 12, lineHeight: 1.6, color: isUser ? C.primaryFg : C.fg, background: isUser ? C.accent : C.card, border: `1px solid ${isUser ? C.accent : C.border}`, whiteSpace: 'pre-wrap', fontFamily: "'Geist', -apple-system, sans-serif", maxWidth: isUser ? '85%' : '100%', ...(!isUser ? { maxHeight: 120, overflowY: 'auto' as const, scrollbarWidth: 'none' as const } : {}) }}>{children}</div>
      {showActions && (
        <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
          <DemoActionBtn>📋 Copy</DemoActionBtn>
          <DemoActionBtn>💾 Save</DemoActionBtn>
        </div>
      )}
    </div>
  );
}

function DemoActionBtn({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <div style={{ padding: '3px 8px', borderRadius: 6, border: `1px solid ${highlight ? C.accent : C.border}`, background: highlight ? C.accent : C.card, fontSize: 9, color: highlight ? C.primaryFg : C.fgMuted, fontWeight: highlight ? 600 : 500, display: 'flex', alignItems: 'center', gap: 3 }}>{children}</div>
  );
}

function DemoMiniSidebar({ chats = ['Music Store Website with 3D', 'MLOps Pipeline and Deplo...', 'Tech Twitter Growth Strate...'] }: { chats?: string[] }) {
  return (
    <div style={{ width: 150, background: C.sidebarBg, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', padding: '10px 8px', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, padding: '0 4px' }}>
        <DemoPrmptLogo size={24} />
        <span style={{ fontSize: 12, fontWeight: 700, color: C.fg, letterSpacing: '-0.01em' }}>Prmpt</span>
        <span style={{ fontSize: 8, fontWeight: 600, color: C.fgDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 1 }}>STUDIO</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.03)', fontSize: 11, color: C.fg, fontWeight: 500 }}>
        <Plus size={13} weight="bold" style={{ width: 14 }} />New Chat
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 6, fontSize: 11, color: C.fg, fontWeight: 500 }}>
        <svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" style={{ flexShrink: 0 }}><path d="M231.65,194.55,198.46,36.75a16,16,0,0,0-19-12.39L132.65,34.42a16.08,16.08,0,0,0-12.3,19l33.19,157.8A16,16,0,0,0,169.16,224a16.25,16.25,0,0,0,3.38-.36l46.81-10.06A16.09,16.09,0,0,0,231.65,194.55ZM136,50.15l46.8-10,3.33,15.87L139.33,66Zm6.62,31.47,46.82-10.05,3.34,15.9L146,97.52Zm13.3,63.32-46.82,10.06-13.3-63.32,46.82-10.06ZM216,197.85l-46.8,10-3.33-15.87L212.67,182ZM104,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V48A16,16,0,0,0,104,32ZM56,48h48V208H56Z" /></svg>
        Prompt Library
      </div>
      <div style={{ fontSize: 8, fontWeight: 700, color: C.fgDim, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '12px 6px 5px' }}>RECENT</div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {chats.map((chat, i) => (
          <div key={i} style={{ padding: '5px 8px', borderRadius: 5, fontSize: 10, color: C.fgMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: i === 0 ? 'rgba(0,0,0,0.03)' : 'transparent', fontWeight: i === 0 ? 500 : 400 }}>{chat}</div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 6px 2px', borderTop: `1px solid ${C.border}`, marginTop: 6 }}>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: C.primaryFg }}>T</div>
        <span style={{ fontSize: 10, fontWeight: 500, color: C.fg }}>TryPrmpt</span>
      </div>
    </div>
  );
}

function DemoMiniAppShell({ children, chats }: { children: React.ReactNode; chats?: string[] }) {
  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', background: C.bg, borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}`, fontFamily: "'Geist', -apple-system, sans-serif", boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
      <DemoMiniSidebar chats={chats} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <DemoMiniTitleBar />
        {children}
      </div>
    </div>
  );
}

function DemoMiniOverlayPanel({ children, glowIntensity = 0.15 }: { children: React.ReactNode; glowIntensity?: number }) {
  return (
    <div style={{ width: 260, height: '100%', maxHeight: 420, borderRadius: 16, padding: 1.5, background: `linear-gradient(135deg, rgba(34,36,41,${glowIntensity}), ${C.border} 50%, rgba(34,36,41,${glowIntensity * 0.5}))`, boxShadow: `0 12px 40px rgba(0,0,0,0.12), 0 0 24px rgba(34,36,41,${glowIntensity * 0.15})` }}>
      <div style={{ background: C.bg, borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <DemoPrmptLogo size={18} />
            <span style={{ fontSize: 11, fontWeight: 700, color: C.fg }}>Prmpt</span>
            <span style={{ fontSize: 7, fontWeight: 600, color: C.fgDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>OVERLAY</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {['↗', '✕'].map((b, i) => (
              <div key={i} style={{ width: 20, height: 20, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: C.fgDim }}>{b}</div>
            ))}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Demo: @prompt Anywhere — exact port of OverlayAccessDemo
   ───────────────────────────────────────────────────────────── */
const OVERLAY_Q_DATA = [
  { title: 'What features should the app include?', options: ['User input for prompts', 'Output formatting options', 'Integration with other tools'], selected: [0, 1, 2] },
  { title: 'Who is the target audience?', options: ['Developers', 'Content creators', 'Everyone'], selected: [0] },
  { title: 'What platform should the app be developed for?', options: ['Desktop app', 'Web app', 'CLI tool'], selected: [0] },
];
const OVERLAY_PREFS = {
  'Features': ['User input for prompts', 'Output formatting options', 'Integration with other tools'],
  'Target audience': ['Developers'],
  'Platform': ['Desktop app'],
};
const OVERLAY_USER_PROMPT = 'make me a prompt optimizer app';
const OVERLAY_AI_RESPONSE = `TASK:\nBuild a desktop application that automates prompt optimization for developers, accepting raw prompt ideas and outputting refined, structured prompts with formatting options and tool integrations.\n\nCORE FEATURES:\n- Input interface: Text area accepting raw/rough prompt ideas\n- Optimization engine: Applies prompt engineering best practices\n- Output formatting: Plain text, Markdown, HTML/JSON options\n- Tool integrations: API connections to at least 2 AI providers\n\nCONSTRAINTS:\n- Must work offline with local optimization fallback\n- API keys stored securely, never in plain text\n- Support both light and dark themes\n- Keyboard shortcuts for power users (Cmd+Enter to optimize)`;
const CURSOR_PASTED = `CONTEXT: Building a desktop application for prompt optimization and structure...\n\nTASK:\nBuild a desktop application that automates prompt optimization for developers, accepting raw prompt ideas and outputting refined, structured prompts with formatting options and tool integrations.\n\nCORE FEATURES:\n- Input interface: Text area accepting raw/rough prompt ideas\n- Optimization engine: Applies prompt engineering best practices\n- Output formatting options:\n  - Plain text\n  - Markdown with sections...`;
function getCursorShortcutsList() {
  const mod = (window.electronAPI as any)?.platform === 'darwin' ? 'Cmd' : 'Ctrl';
  return [
    { label: 'New Agent', keys: `${mod} + Shift + L` },
    { label: 'Show Terminal', keys: `${mod} + J` },
    { label: 'Search Files', keys: `${mod} + P` },
    { label: 'Open Browser', keys: `${mod} + Shift + B` },
    { label: 'Maximize Chat', keys: `${mod} + Alt + E` },
    { label: 'Add Folder', keys: `${mod} + Alt + A` },
  ];
}

function AtPromptDemo({ onDone }: { onDone?: () => void }) {
  type Phase = 'idle' | 'cursor-typing' | 'cursor-dropdown' | 'overlay-in' | 'overlay-typing' | 'overlay-sent' | 'overlay-loading' | 'overlay-questions' | 'overlay-optimize' | 'overlay-prefs-loading' | 'overlay-prefs' | 'overlay-loading2' | 'overlay-streaming' | 'overlay-done' | 'replace-click' | 'replacing' | 'replaced' | 'reset';
  const [phase, setPhase] = useState<Phase>('idle');
  const [atPromptChars, setAtPromptChars] = useState(0);
  const [overlayInputChars, setOverlayInputChars] = useState(0);
  const [responseChars, setResponseChars] = useState(0);
  const [replacedChars, setReplacedChars] = useState(0);
  const [visibleQs, setVisibleQs] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [cursorPos, setCursorPos] = useState({ x: 400, y: 200 });
  const [cursorClicking, setCursorClicking] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(false);
  const replaceBtnRef = useRef<HTMLDivElement>(null);

  const getCursorPosForEl = useCallback((el: HTMLElement | null) => {
    if (!el) return null;
    const root = el.closest('[data-demo-root]');
    if (!root) return null;
    const rr = root.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    return { x: er.left - rr.left + er.width / 2, y: er.top - rr.top + er.height / 2 };
  }, []);

  const reset = useCallback(() => {
    setPhase('idle'); setAtPromptChars(0); setOverlayInputChars(0); setResponseChars(0);
    setReplacedChars(0); setVisibleQs(0); setCursorVisible(false); setCursorClicking(false);
  }, []);

  useEffect(() => {
    if (scrollRef.current && ['overlay-streaming', 'overlay-questions', 'overlay-prefs', 'overlay-done'].includes(phase)) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [responseChars, phase, visibleQs]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const t = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)); };
    switch (phase) {
      case 'idle': t(() => setPhase('cursor-typing'), 1200); break;
      case 'cursor-typing':
        if (atPromptChars < '@prompt'.length) t(() => setAtPromptChars(c => c + 1), 130);
        else t(() => setPhase('cursor-dropdown'), 500);
        break;
      case 'cursor-dropdown': t(() => setPhase('overlay-in'), 1000); break;
      case 'overlay-in': t(() => setPhase('overlay-typing'), 800); break;
      case 'overlay-typing':
        if (overlayInputChars < OVERLAY_USER_PROMPT.length) {
          const ch = OVERLAY_USER_PROMPT[overlayInputChars];
          t(() => setOverlayInputChars(c => c + 1), ch === ' ' ? 35 : 20 + Math.random() * 22);
        } else t(() => setPhase('overlay-sent'), 500);
        break;
      case 'overlay-sent': t(() => setPhase('overlay-loading'), 200); break;
      case 'overlay-loading': t(() => setPhase('overlay-questions'), 900); break;
      case 'overlay-questions':
        if (visibleQs < OVERLAY_Q_DATA.length) t(() => setVisibleQs(v => v + 1), 400);
        else t(() => setPhase('overlay-optimize'), 1200);
        break;
      case 'overlay-optimize': t(() => setPhase('overlay-prefs-loading'), 1000); break;
      case 'overlay-prefs-loading': t(() => setPhase('overlay-prefs'), 800); break;
      case 'overlay-prefs': t(() => setPhase('overlay-loading2'), 2000); break;
      case 'overlay-loading2': t(() => setPhase('overlay-streaming'), 900); break;
      case 'overlay-streaming':
        if (responseChars < OVERLAY_AI_RESPONSE.length) {
          const ch = OVERLAY_AI_RESPONSE[responseChars];
          t(() => setResponseChars(c => c + 1), ch === '\n' ? 40 : ch === ' ' ? 8 : 5 + Math.random() * 8);
          if (responseChars % 50 === 0) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
        } else t(() => setPhase('overlay-done'), 1000);
        break;
      case 'overlay-done':
        t(() => { setCursorVisible(true); const pos = getCursorPosForEl(replaceBtnRef.current); if (pos) setCursorPos(pos); }, 500);
        t(() => setPhase('replace-click'), 1400);
        break;
      case 'replace-click':
        setCursorClicking(true);
        t(() => setCursorClicking(false), 300);
        t(() => { setCursorVisible(false); setPhase('replacing'); }, 600);
        break;
      case 'replacing':
        if (replacedChars < CURSOR_PASTED.length) t(() => setReplacedChars(c => Math.min(c + 4, CURSOR_PASTED.length)), 6);
        else t(() => setPhase('replaced'), 500);
        break;
      case 'replaced': t(() => setPhase('reset'), 3000); t(() => onDone?.(), 1500); break;
      case 'reset': reset(); break;
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, atPromptChars, overlayInputChars, responseChars, replacedChars, visibleQs, reset]);

  const showOverlay = !['idle', 'cursor-typing', 'cursor-dropdown', 'replacing', 'replaced', 'reset'].includes(phase);
  const overlaySent = !['idle', 'cursor-typing', 'cursor-dropdown', 'overlay-in', 'overlay-typing'].includes(phase);
  const showQs = ['overlay-questions', 'overlay-optimize'].includes(phase);
  const showPrefs = ['overlay-prefs', 'overlay-loading2', 'overlay-streaming', 'overlay-done', 'replace-click'].includes(phase);
  const showResponse = responseChars > 0;
  const showActions = ['overlay-done', 'replace-click'].includes(phase);
  const isReplacePhase = phase === 'replacing' || phase === 'replaced';

  const cursorInputText = (() => {
    if (phase === 'cursor-typing') return '@prompt'.slice(0, atPromptChars);
    if (phase === 'cursor-dropdown') return '@prompt';
    if (isReplacePhase) return CURSOR_PASTED.slice(0, replacedChars);
    if (showOverlay) return '@prompt';
    return '';
  })();

  return (
    <div data-demo-root style={{ width: '100%', height: '100%', padding: 16, display: 'flex', gap: 8, position: 'relative', overflow: 'hidden' }}>
      <DemoAnimatedCursor x={cursorPos.x} y={cursorPos.y} clicking={cursorClicking} visible={cursorVisible} />
      {/* Cursor IDE */}
      <div style={{ flex: 1, background: '#1e1e2e', borderRadius: 10, overflow: 'hidden', border: '1px solid #313244', display: 'flex', flexDirection: 'column', fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace", transition: 'opacity 0.3s', opacity: showOverlay && !isReplacePhase ? 0.45 : 1, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 10px', background: '#181825', borderBottom: '1px solid #313244' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {['#ff5f57', '#febc2e', '#28c840'].map((col, i) => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: col, opacity: 0.8 }} />)}
            <span style={{ fontSize: 8, color: '#6c7086', marginLeft: 4 }}>TryPrmpt - Cursor</span>
          </div>
          <span style={{ fontSize: 7, color: '#45475a', padding: '1px 4px', border: '1px solid #313244', borderRadius: 2 }}>New Agent ✕</span>
        </div>
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ width: 30, background: '#11111b', borderRight: '1px solid #313244', padding: '6px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            {['📁', '🔍', '⑂', '⊞'].map((ic, i) => <div key={i} style={{ fontSize: 9, color: '#6c7086', opacity: 0.7 }}>{ic}</div>)}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, background: '#1e1e2e' }}>
            <div style={{ width: 32, height: 32, borderRadius: 6, background: '#313244', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6c7086" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /></svg>
            </div>
            {getCursorShortcutsList().map((sc, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 8, color: '#6c7086' }}>
                <span style={{ width: 70, textAlign: 'right' }}>{sc.label}</span>
                <span style={{ fontSize: 7, color: '#45475a' }}>{sc.keys}</span>
              </div>
            ))}
          </div>
          <div style={{ width: 140, background: '#1e1e2e', borderLeft: '1px solid #313244', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '6px 8px', borderBottom: '1px solid #313244' }}>
              <div style={{ padding: '5px 8px', borderRadius: 6, background: isReplacePhase ? 'rgba(137,180,250,0.06)' : '#181825', border: `1px solid ${isReplacePhase ? 'rgba(137,180,250,0.3)' : '#313244'}`, fontSize: 9, color: isReplacePhase ? '#cdd6f4' : (cursorInputText ? '#a6e3a1' : '#585b70'), lineHeight: 1.5, minHeight: isReplacePhase ? 60 : 20, maxHeight: isReplacePhase ? 80 : 20, overflow: 'hidden', transition: 'all 0.3s', boxShadow: isReplacePhase ? '0 0 10px rgba(137,180,250,0.1)' : 'none' }}>
                {cursorInputText || '@prompt'}
                {phase === 'cursor-typing' && (
                  <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.5, repeat: Infinity }}
                    style={{ display: 'inline-block', width: 1, height: 11, background: '#cdd6f4', marginLeft: 1, verticalAlign: 'middle' }} />
                )}
              </div>
              {phase === 'cursor-dropdown' && (
                <motion.div initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }}
                  style={{ padding: '3px 8px', fontSize: 8, color: '#6c7086', marginTop: 2 }}>+ Add new doc</motion.div>
              )}
              {isReplacePhase && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  style={{ fontSize: 7, color: '#a6e3a1', marginTop: 3, fontWeight: 500 }}>✓ Optimized prompt inserted by Prmpt</motion.div>
              )}
            </div>
            <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4, fontSize: 7, color: '#6c7086' }}>
              <span style={{ padding: '1px 4px', borderRadius: 3, background: '#313244', color: '#89b4fa', fontSize: 7 }}>Agent</span>
              <span>Opus 4.6</span>
              <span style={{ color: '#45475a' }}>High</span>
            </div>
          </div>
        </div>
      </div>
      {/* Overlay panel */}
      <AnimatePresence>
        {showOverlay && (
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', damping: 22, stiffness: 250 }}
            style={{ position: 'absolute', left: '50%', top: 24, bottom: 24, transform: 'translateX(-50%)', zIndex: 10, width: 'min(300px, 80%)' }}
          >
            <DemoMiniOverlayPanel glowIntensity={showActions ? 0.25 : 0.12}>
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div ref={scrollRef} style={{ flex: 1, padding: '8px 10px', overflow: 'auto', scrollbarWidth: 'none' } as React.CSSProperties}>
                  {!overlaySent && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
                      <DemoPrmptLogo size={44} />
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.fg }}>Welcome to Prmpt!!</div>
                      <div style={{ fontSize: 10, color: C.fgDim, textAlign: 'center' }}>Transform rough ideas into precisely<br />engineered prompts.</div>
                    </div>
                  )}
                  {overlaySent && !showPrefs && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      <DemoMiniMessage role="user">{OVERLAY_USER_PROMPT}</DemoMiniMessage>
                    </motion.div>
                  )}
                  {phase === 'overlay-loading' && <DemoLoadingDots />}
                  {showQs && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      {Array.from({ length: visibleQs }).map((_, qi) => {
                        const q = OVERLAY_Q_DATA[qi];
                        return (
                          <motion.div key={qi} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 9, fontWeight: 600, color: C.fg, marginBottom: 4 }}>{q.title}</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {q.options.map((opt, oi) => {
                                const sel = q.selected.includes(oi);
                                return (
                                  <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 5, border: `1px solid ${sel ? C.accent : C.border}`, background: sel ? C.accent : C.bg, fontSize: 9, color: sel ? C.primaryFg : C.fgMuted, fontWeight: 500 }}>
                                    <div style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0, border: `1.5px solid ${sel ? C.primaryFg : C.fgDim}`, background: sel ? C.primaryFg : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      {sel && <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>}
                                    </div>
                                    {opt}
                                  </div>
                                );
                              })}
                            </div>
                          </motion.div>
                        );
                      })}
                      {visibleQs >= OVERLAY_Q_DATA.length && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
                          <span style={{ fontSize: 8, color: C.fgDim }}>Skip — just optimize →</span>
                          <div style={{ padding: '4px 10px', borderRadius: 6, background: C.accent, color: C.primaryFg, fontSize: 9, fontWeight: 600 }}>✦ Optimize</div>
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                  {phase === 'overlay-prefs-loading' && <DemoLoadingDots />}
                  {showPrefs && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <div style={{ padding: '6px 10px', borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, maxWidth: '95%' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: C.fg, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          ✦ Your preferences <span style={{ fontSize: 7, color: C.fgDim, background: C.secondary, padding: '0 4px', borderRadius: 3 }}>SINGLE</span>
                        </div>
                        {Object.entries(OVERLAY_PREFS).map(([k, vs]) => (
                          <div key={k} style={{ marginBottom: 3 }}>
                            <div style={{ fontSize: 7, color: C.fgDim }}>{k}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                              {vs.map((v) => <span key={v} style={{ fontSize: 7, padding: '1px 4px', borderRadius: 3, border: `1px solid ${C.border}`, background: C.bg, color: C.fg }}>{v}</span>)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                  {showPrefs && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginBottom: 6 }}>
                      <DemoMiniMessage role="user">{OVERLAY_USER_PROMPT}</DemoMiniMessage>
                    </motion.div>
                  )}
                  {phase === 'overlay-loading2' && <DemoLoadingDots />}
                  {showResponse && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 8, fontWeight: 600, color: C.fgDim, textTransform: 'uppercase', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <DemoPrmptLogo size={12} /> Prmpt
                        </div>
                        <div style={{ position: 'relative' }}>
                          <div style={{ padding: '6px 10px', borderRadius: 8, fontSize: 9, lineHeight: 1.6, color: C.fg, background: C.card, border: `1px solid ${C.border}`, whiteSpace: 'pre-wrap', maxHeight: 110, overflow: 'auto', scrollbarWidth: 'none' } as React.CSSProperties}>
                            {OVERLAY_AI_RESPONSE.slice(0, responseChars)}
                            {phase === 'overlay-streaming' && (
                              <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.5, repeat: Infinity }}
                                style={{ display: 'inline-block', width: 1, height: 11, background: C.accent, marginLeft: 1, verticalAlign: 'middle' }} />
                            )}
                          </div>
                          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 20, background: `linear-gradient(transparent, ${C.card})`, borderRadius: '0 0 8px 8px', pointerEvents: 'none' }} />
                        </div>
                        {showActions && (
                          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                            <OvlBtn>📋 Copy</OvlBtn>
                            <div ref={replaceBtnRef}><OvlBtn highlight>↩ Replace</OvlBtn></div>
                            <OvlBtn>🔄 Regenerate</OvlBtn>
                          </motion.div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </div>
                <div style={{ padding: '0 10px 3px', flexShrink: 0 }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 5, border: `1px dashed ${C.border}`, fontSize: 8, color: C.fgDim }}>+ Attach Chat Context</div>
                </div>
                <DemoMiniInputBar
                  text={phase === 'overlay-typing' ? OVERLAY_USER_PROMPT.slice(0, overlayInputChars) : ''}
                  placeholder="How can I help you today?"
                  showCursor={phase === 'overlay-typing'}
                  focused={phase === 'overlay-typing' || phase === 'overlay-in'}
                />
              </div>
            </DemoMiniOverlayPanel>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function OvlBtn({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <div style={{ padding: '3px 7px', borderRadius: 5, border: `1px solid ${highlight ? C.accent : C.border}`, background: highlight ? C.accent : C.card, color: highlight ? C.primaryFg : C.fgMuted, fontSize: 8, fontWeight: highlight ? 600 : 500, display: 'flex', alignItems: 'center', gap: 3 }}>{children}</div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Demo: Memory & Context — exact port of PersonalizedMemoryDemo
   ───────────────────────────────────────────────────────────── */
const MEM_ABOUT_YOU = [
  { key: 'audience', confidence: 80, value: 'technical audience' },
  { key: 'experience', confidence: 75, value: '8+ years', citations: 8 },
  { key: 'experience_years', confidence: 70, value: '8 years' },
  { key: 'role', confidence: 80, value: 'experienced software engineer', citations: 12 },
  { key: 'target_audience', confidence: 70, value: 'Beginner+ level', citations: 2 },
  { key: 'writing_style', confidence: 65, value: 'medium-form, 800-1200 words', citations: 6 },
];
const MEM_RECURRING = [
  { key: 'application_type', confidence: 90, value: 'Hotel management system' },
  { key: 'audience', confidence: 80, value: 'Developers new to AI' },
  { key: 'authentication_method', confidence: 70, value: 'JWT or session-based' },
  { key: 'backend_technology', confidence: 85, value: 'Go with Gin or Echo framework' },
  { key: 'brand', confidence: 90, value: 'KFC' },
  { key: 'code_examples', confidence: 70, value: 'includes Python snippets' },
];
const CUSTOM_INSTRUCTION = 'keep the vibe of the prompt chill and keep it simple';

function MemoryDemo({ onDone }: { onDone?: () => void }) {
  type Phase = 'idle' | 'show-settings' | 'show-memory' | 'show-toggle' | 'show-facts' | 'scroll-facts' | 'show-recurring' | 'scroll-recurring' | 'click-customize' | 'show-customize' | 'type-instruction' | 'done' | 'reset';
  const [phase, setPhase] = useState<Phase>('idle');
  const [visibleFacts, setVisibleFacts] = useState(0);
  const [visibleThemes, setVisibleThemes] = useState(0);
  const [instructionChars, setInstructionChars] = useState(0);
  const [cursorPos, setCursorPos] = useState({ x: 300, y: 100 });
  const [cursorClicking, setCursorClicking] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const customizeTabRef = useRef<HTMLDivElement>(null);

  const getCursorPos = useCallback((el: HTMLElement | null) => {
    if (!el) return null;
    const root = el.closest('[data-demo-root]');
    if (!root) return null;
    const rr = root.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    return { x: er.left - rr.left + er.width / 2, y: er.top - rr.top + er.height / 2 };
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); });
  }, []);

  const reset = useCallback(() => {
    setPhase('idle'); setVisibleFacts(0); setVisibleThemes(0); setInstructionChars(0);
    setCursorVisible(false); setCursorClicking(false);
  }, []);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const t = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)); };
    switch (phase) {
      case 'idle': t(() => setPhase('show-settings'), 800); break;
      case 'show-settings': t(() => setPhase('show-memory'), 600); break;
      case 'show-memory': t(() => setPhase('show-toggle'), 800); break;
      case 'show-toggle': t(() => setPhase('show-facts'), 1000); break;
      case 'show-facts':
        if (visibleFacts < MEM_ABOUT_YOU.length) { t(() => { setVisibleFacts(v => v + 1); scrollToBottom(); }, 250); }
        else t(() => setPhase('scroll-facts'), 800);
        break;
      case 'scroll-facts': t(() => setPhase('show-recurring'), 1000); break;
      case 'show-recurring':
        if (visibleThemes < MEM_RECURRING.length) { t(() => { setVisibleThemes(v => v + 1); scrollToBottom(); }, 250); }
        else t(() => setPhase('scroll-recurring'), 800);
        break;
      case 'scroll-recurring':
        t(() => { setCursorVisible(true); const pos = getCursorPos(customizeTabRef.current); if (pos) setCursorPos(pos); }, 600);
        t(() => setPhase('click-customize'), 1400);
        break;
      case 'click-customize':
        setCursorClicking(true);
        t(() => setCursorClicking(false), 300);
        t(() => { setCursorVisible(false); setPhase('show-customize'); }, 600);
        break;
      case 'show-customize': t(() => setPhase('type-instruction'), 800); break;
      case 'type-instruction':
        if (instructionChars < CUSTOM_INSTRUCTION.length) {
          const ch = CUSTOM_INSTRUCTION[instructionChars];
          t(() => setInstructionChars(c => c + 1), ch === ' ' ? 50 : 30 + Math.random() * 30);
        } else t(() => setPhase('done'), 1500);
        break;
      case 'done': t(() => setPhase('reset'), 2500); onDone?.(); break;
      case 'reset': reset(); break;
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, visibleFacts, visibleThemes, instructionChars, reset]);

  const showMemory = ['show-memory', 'show-toggle', 'show-facts', 'scroll-facts', 'show-recurring', 'scroll-recurring'].includes(phase);
  const showCustomize = ['show-customize', 'type-instruction', 'done'].includes(phase);
  const activeTab = showCustomize ? 'customize' : 'memory';

  return (
    <div data-demo-root style={{ width: '100%', height: '100%', padding: 16, position: 'relative' }}>
      <DemoAnimatedCursor x={cursorPos.x} y={cursorPos.y} clicking={cursorClicking} visible={cursorVisible} />
      <div style={{ display: 'flex', width: '100%', height: '100%', background: C.bg, borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}`, fontFamily: "'Geist', -apple-system, sans-serif", boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        {/* Sidebar */}
        <div style={{ width: 130, background: C.sidebarBg, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', padding: '8px 6px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10, padding: '0 4px' }}>
            <DemoPrmptLogo size={20} />
            <span style={{ fontSize: 10, fontWeight: 700, color: C.fg }}>Prmpt</span>
            <span style={{ fontSize: 6, fontWeight: 600, color: C.fgDim, textTransform: 'uppercase' }}>STUDIO</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 6px', borderRadius: 4, fontSize: 9, color: C.fg, fontWeight: 500 }}>
            <Plus size={11} weight="bold" style={{ width: 12 }} />New Chat
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 6px', borderRadius: 4, fontSize: 9, color: C.fg, fontWeight: 500 }}>
            <svg width="11" height="11" viewBox="0 0 256 256" fill="currentColor" style={{ flexShrink: 0 }}><path d="M231.65,194.55,198.46,36.75a16,16,0,0,0-19-12.39L132.65,34.42a16.08,16.08,0,0,0-12.3,19l33.19,157.8A16,16,0,0,0,169.16,224a16.25,16.25,0,0,0,3.38-.36l46.81-10.06A16.09,16.09,0,0,0,231.65,194.55ZM104,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V48A16,16,0,0,0,104,32ZM56,48h48V208H56Z" /></svg>
            Prompt Library
          </div>
          <div style={{ fontSize: 7, fontWeight: 700, color: C.fgDim, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 5px 3px' }}>RECENT</div>
          {['Body Parts Discussion', 'monkeytype clone', 'mastering quant. apti...', 'blog post app creation'].map((c, i) => (
            <div key={i} style={{ padding: '3px 6px', borderRadius: 4, fontSize: 8, color: C.fgMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c}</div>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 4px 0', borderTop: `1px solid ${C.border}` }}>
            <div style={{ width: 16, height: 16, borderRadius: '50%', background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 600, color: C.primaryFg }}>T</div>
            <span style={{ fontSize: 8, fontWeight: 500, color: C.fg }}>aarush dhingra</span>
          </div>
        </div>
        {/* Main */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ height: 22, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 4px', background: C.bg, flexShrink: 0 }}>
            {['—', '□', '×'].map((b, i) => <div key={i} style={{ width: 20, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: C.fgDim }}>{b}</div>)}
          </div>
          <div style={{ padding: '8px 16px 0', flexShrink: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.fg, marginBottom: 8 }}>Settings</div>
            <div style={{ display: 'flex', gap: 12, borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>
              <div ref={customizeTabRef}>
                <div style={{ fontSize: 9, fontWeight: activeTab === 'customize' ? 600 : 500, color: activeTab === 'customize' ? C.fg : C.fgDim, borderBottom: activeTab === 'customize' ? `2px solid ${C.accent}` : '2px solid transparent', paddingBottom: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Palette size={11} />Customize
                </div>
              </div>
              <div style={{ fontSize: 9, fontWeight: activeTab === 'memory' ? 600 : 500, color: activeTab === 'memory' ? C.fg : C.fgDim, borderBottom: activeTab === 'memory' ? `2px solid ${C.accent}` : '2px solid transparent', paddingBottom: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                <Brain size={11} />Memory
              </div>
            </div>
          </div>
          <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '10px 16px', scrollbarWidth: 'none' } as React.CSSProperties}>
            <AnimatePresence mode="wait">
              {showMemory && (
                <motion.div key="memory" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
                  <div style={{ padding: '8px 10px', borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: C.fg }}>Learn from my usage</div>
                        <div style={{ fontSize: 8, color: C.fgDim, marginTop: 1 }}>The app automatically learns facts from your prompts.</div>
                      </div>
                      <motion.div
                        animate={phase !== 'show-memory' ? { background: '#34d399' } : { background: C.fgDim }}
                        style={{ width: 28, height: 16, borderRadius: 8, padding: 2, display: 'flex', alignItems: 'center', justifyContent: phase !== 'show-memory' ? 'flex-end' : 'flex-start' }}
                      >
                        <motion.div layout style={{ width: 12, height: 12, borderRadius: '50%', background: '#fff' }} />
                      </motion.div>
                    </div>
                    <div style={{ fontSize: 8, color: C.fgDim, marginTop: 4 }}>
                      The app learns from your usage to personalize prompt optimization. <strong style={{ color: C.fg }}>60 facts stored.</strong>
                    </div>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.fg, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                      👤 About You <span style={{ fontSize: 8, color: C.fgDim, fontWeight: 400 }}>{visibleFacts} facts</span>
                    </div>
                    {MEM_ABOUT_YOU.slice(0, visibleFacts).map((fact, i) => (
                      <motion.div key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 6, padding: '0 2px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
                          <span style={{ fontSize: 9, fontWeight: 600, color: C.fgMuted }}>{fact.key}</span>
                          <ConfidenceBadge value={fact.confidence} />
                          {fact.citations && <span style={{ fontSize: 7, color: C.fgDim }}>⊕ {fact.citations}</span>}
                        </div>
                        <div style={{ fontSize: 10, color: C.fg }}>{fact.value}</div>
                      </motion.div>
                    ))}
                  </div>
                  {visibleFacts >= MEM_ABOUT_YOU.length && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.fg, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                        📋 Recurring Themes <span style={{ fontSize: 8, color: C.fgDim, fontWeight: 400 }}>{visibleThemes} facts</span>
                      </div>
                      {MEM_RECURRING.slice(0, visibleThemes).map((fact, i) => (
                        <motion.div key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 6, padding: '0 2px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
                            <span style={{ fontSize: 9, fontWeight: 600, color: C.fgMuted }}>{fact.key}</span>
                            <ConfidenceBadge value={fact.confidence} />
                          </div>
                          <div style={{ fontSize: 10, color: C.fg }}>{fact.value}</div>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </motion.div>
              )}
              {showCustomize && (
                <motion.div key="customize" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.fg, marginBottom: 2 }}>Custom Instructions</div>
                    <div style={{ fontSize: 8, color: C.fgDim, marginBottom: 6 }}>Added to every optimization as secondary context</div>
                    <div style={{ padding: '8px 10px', borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, fontSize: 10, color: C.fg, minHeight: 50, lineHeight: 1.6 }}>
                      {CUSTOM_INSTRUCTION.slice(0, instructionChars)}
                      {phase === 'type-instruction' && (
                        <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.5, repeat: Infinity }}
                          style={{ display: 'inline-block', width: 1, height: 12, background: C.accent, marginLeft: 1, verticalAlign: 'middle' }} />
                      )}
                      <div style={{ fontSize: 8, color: C.fgDim, marginTop: 6, textAlign: 'right' }}>{instructionChars} / 1000</div>
                    </div>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.fg, marginBottom: 6 }}>Appearance</div>
                    <div style={{ padding: '8px 10px', borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: C.fg }}>Light Mode</div>
                        <div style={{ fontSize: 8, color: C.fgDim }}>Toggle the application color scheme</div>
                      </div>
                      <div style={{ width: 28, height: 16, borderRadius: 8, background: C.fgDim, padding: 2, display: 'flex', alignItems: 'center' }}>
                        <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#fff' }} />
                      </div>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.fg, marginBottom: 6 }}>Typography</div>
                    {[['Font Size', 'Medium (16px)'], ['Font Family', 'Default (Inter)']].map(([label, value]) => (
                      <div key={label} style={{ padding: '6px 10px', borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <div style={{ fontSize: 10, fontWeight: 500, color: C.fg }}>{label}</div>
                        <div style={{ fontSize: 9, color: C.fgDim, padding: '2px 6px', borderRadius: 4, background: C.secondary, border: `1px solid ${C.border}` }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const color = value >= 80 ? '#34d399' : value >= 70 ? '#86efac' : '#fbbf24';
  return (
    <span style={{ fontSize: 7, padding: '1px 5px', borderRadius: 3, background: `${color}22`, color, fontWeight: 600, border: `1px solid ${color}44` }}>{value}% confident</span>
  );
}

/* ─────────────────────────────────────────────────────────────
   Demo: Prompt Studio — exact port of ClarifyingDemo
   ───────────────────────────────────────────────────────────── */
const CLARIFY_USER_TEXT = 'make me a desktop app that manages internet speed, bandwidth etc for testings app';
const CLARIFY_QUESTIONS = [
  { title: 'What tech stack do you want to use?', options: ['Electron', 'JavaFX', 'C#', 'Python + Tkinter'], selected: [0] },
  { title: 'What features do you want?', options: ['Speed test', 'Bandwidth monitoring', 'Usage statistics', 'Alerts for limits'], selected: [0, 1, 2] },
  { title: 'Who is the target audience?', options: ['General users', 'Network admins', 'Gamers', 'Businesses'], selected: [0, 1] },
  { title: 'UI complexity level?', options: ['Simple', 'Moderate', 'Advanced', 'Other'], selected: [1] },
];
const CLARIFY_PREFS = {
  'Tech stack': ['Electron'],
  'Features': ['Speed test', 'Bandwidth monitoring', 'Usage statistics'],
  'Audience': ['General users', 'Network admins'],
  'UI level': ['Moderate'],
};
const CLARIFY_AI_RESPONSE = `Here's your optimized prompt:\n\nPROJECT: Electron Desktop Network Monitor (React + TypeScript)\n\nCORE MODULES:\n1. Speed Test Engine — download/upload/ping measurements using speedtest-net with historical comparison graphs and scheduled auto-tests\n2. Bandwidth Monitor — real-time per-interface tracking via systeminformation with color-coded usage bars, alerts when thresholds exceeded\n3. Usage Statistics — historical data stored in SQLite with Recharts area/line graphs, daily/weekly/monthly views, CSV export\n\nUI ARCHITECTURE:\n• Sidebar navigation with collapsible sections (Dashboard, Speed Test, Bandwidth, Statistics, Settings)\n• System tray integration with quick-glance popup showing current speeds\n• Toast notifications for threshold alerts\n\nTECHNICAL REQUIREMENTS:\n• Electron 28+ with contextBridge for secure IPC\n• React 18 with TypeScript strict mode\n• TailwindCSS for styling with custom design tokens`;

function ChatDemo({ onDone }: { onDone?: () => void }) {
  type Phase = 'idle' | 'typing' | 'sending' | 'loading1' | 'show-questions' | 'selecting' | 'pause-between-q' | 'show-optimize' | 'click-optimize' | 'loading2' | 'preferences' | 'loading3' | 'streaming' | 'done' | 'reset';
  const [phase, setPhase] = useState<Phase>('idle');
  const [typedChars, setTypedChars] = useState(0);
  const [visibleQuestions, setVisibleQuestions] = useState(0);
  const [currentQ, setCurrentQ] = useState(0);
  const [currentOpt, setCurrentOpt] = useState(0);
  const [selections, setSelections] = useState<number[][]>(CLARIFY_QUESTIONS.map(() => []));
  const [streamedChars, setStreamedChars] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [cursorPos, setCursorPos] = useState({ x: 300, y: 200 });
  const [cursorClicking, setCursorClicking] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(false);
  const optionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const optimizeBtnRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); });
  }, []);

  const getCursorPosForElement = useCallback((el: HTMLElement | null | undefined) => {
    if (!el || !scrollRef.current) return null;
    const container = scrollRef.current.closest('[style]')?.parentElement?.parentElement?.parentElement;
    if (!container) return null;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    return { x: elRect.left - containerRect.left + elRect.width / 2, y: elRect.top - containerRect.top + elRect.height / 2 };
  }, []);

  const reset = useCallback(() => {
    setPhase('idle'); setTypedChars(0); setVisibleQuestions(0); setCurrentQ(0); setCurrentOpt(0);
    setSelections(CLARIFY_QUESTIONS.map(() => [])); setStreamedChars(0);
    setCursorVisible(false); setCursorClicking(false); optionRefs.current.clear();
  }, []);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const t = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)); };
    switch (phase) {
      case 'idle': t(() => setPhase('typing'), 1000); break;
      case 'typing':
        if (typedChars < CLARIFY_USER_TEXT.length) {
          const ch = CLARIFY_USER_TEXT[typedChars];
          t(() => setTypedChars(c => c + 1), ch === ' ' ? 35 : 18 + Math.random() * 22);
        } else t(() => setPhase('sending'), 500);
        break;
      case 'sending': t(() => setPhase('loading1'), 150); break;
      case 'loading1': t(() => setPhase('show-questions'), 900); break;
      case 'show-questions':
        if (visibleQuestions < CLARIFY_QUESTIONS.length) {
          t(() => { setVisibleQuestions(v => v + 1); scrollToBottom(); }, 400);
        } else {
          t(() => { scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }, 200);
          t(() => { setCursorVisible(true); setPhase('selecting'); }, 1000);
        }
        break;
      case 'selecting': {
        if (currentQ >= CLARIFY_QUESTIONS.length) { t(() => setPhase('show-optimize'), 500); break; }
        const q = CLARIFY_QUESTIONS[currentQ];
        if (currentOpt >= q.selected.length) { t(() => setPhase('pause-between-q'), 300); break; }
        const optIdx = q.selected[currentOpt];
        const key = `${currentQ}-${optIdx}`;
        t(() => {
          const el = optionRefs.current.get(key);
          if (el && scrollRef.current) {
            const container = scrollRef.current;
            const elTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
            container.scrollTop += elTop - container.clientHeight / 2 + el.clientHeight / 2;
          }
        }, 100);
        t(() => { const el = optionRefs.current.get(key); const pos = getCursorPosForElement(el); if (pos) setCursorPos(pos); }, 450);
        t(() => {
          setCursorClicking(true);
          t(() => setCursorClicking(false), 250);
          setSelections(prev => { const next = prev.map(a => [...a]); next[currentQ] = [...next[currentQ], optIdx]; return next; });
        }, 1000);
        t(() => setCurrentOpt(c => c + 1), 1250);
        break;
      }
      case 'pause-between-q': t(() => { setCurrentQ(c => c + 1); setCurrentOpt(0); scrollToBottom(); setPhase('selecting'); }, 500); break;
      case 'show-optimize':
        scrollToBottom();
        t(() => { const pos = getCursorPosForElement(optimizeBtnRef.current); if (pos) setCursorPos(pos); }, 600);
        t(() => setPhase('click-optimize'), 1300);
        break;
      case 'click-optimize':
        setCursorClicking(true);
        t(() => setCursorClicking(false), 300);
        t(() => { setCursorVisible(false); setPhase('loading2'); }, 600);
        break;
      case 'loading2': scrollToBottom(); t(() => setPhase('preferences'), 900); break;
      case 'preferences': scrollToBottom(); t(() => setPhase('loading3'), 2200); break;
      case 'loading3': scrollToBottom(); t(() => setPhase('streaming'), 900); break;
      case 'streaming':
        if (streamedChars < CLARIFY_AI_RESPONSE.length) {
          const ch = CLARIFY_AI_RESPONSE[streamedChars];
          const delay = ch === '\n' ? 50 : ch === ' ' ? 10 : 6 + Math.random() * 8;
          t(() => { setStreamedChars(c => c + 1); if (streamedChars % 40 === 0) scrollToBottom(); }, delay);
        } else { scrollToBottom(); t(() => setPhase('done'), 2500); }
        break;
      case 'done': t(() => setPhase('reset'), 2000); onDone?.(); break;
      case 'reset': reset(); break;
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, typedChars, visibleQuestions, currentQ, currentOpt, streamedChars, reset]);

  const showInput = phase === 'idle' || phase === 'typing';
  const showChat = !showInput;
  const showQs = !['idle', 'typing', 'sending', 'loading1', 'loading2', 'preferences', 'loading3', 'streaming', 'done', 'reset'].includes(phase);
  const showPrefs = ['preferences', 'loading3', 'streaming', 'done'].includes(phase);
  const showResponse = streamedChars > 0;

  return (
    <div style={{ width: '100%', height: '100%', padding: 16, position: 'relative' }}>
      <DemoAnimatedCursor x={cursorPos.x} y={cursorPos.y} clicking={cursorClicking} visible={cursorVisible} />
      <DemoMiniAppShell>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <AnimatePresence mode="wait">
            {!showChat ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20 }}
              >
                <DemoPrmptLogo size={48} />
                <div style={{ fontSize: 16, fontWeight: 700, color: C.fg }}>Welcome to Prmpt!!</div>
                <div style={{ fontSize: 11, color: C.fgMuted, textAlign: 'center' }}>Transform rough ideas into precisely engineered prompts.</div>
              </motion.div>
            ) : (
              <motion.div key="chat" ref={scrollRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                style={{ flex: 1, overflow: 'auto', padding: '10px 14px 4px', scrollbarWidth: 'none' } as React.CSSProperties}
              >
                {!showPrefs && <DemoMiniMessage role="user">{CLARIFY_USER_TEXT}</DemoMiniMessage>}
                {phase === 'loading1' && <DemoLoadingDots />}
                {showQs && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: C.fgDim, textTransform: 'uppercase', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <DemoPrmptLogo size={14} /> Prmpt
                      </div>
                      <div style={{ padding: '6px 10px', borderRadius: 8, fontSize: 11, color: C.fg, background: C.card, border: `1px solid ${C.border}` }}>
                        <strong>👋 Let's dial this in</strong>
                        <span style={{ fontSize: 9, color: C.fgDim, display: 'block', marginTop: 2 }}>Pick all that apply — select multiple if you want</span>
                      </div>
                    </div>
                    {Array.from({ length: visibleQuestions }).map((_, qi) => {
                      const q = CLARIFY_QUESTIONS[qi];
                      const sel = selections[qi] || [];
                      return (
                        <motion.div key={qi} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', damping: 20, stiffness: 300 }} style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: C.fg, marginBottom: 5 }}>{q.title}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                            {q.options.map((opt, oi) => {
                              const isSelected = sel.includes(oi);
                              return (
                                <motion.div
                                  key={oi}
                                  ref={(el) => { if (el) optionRefs.current.set(`${qi}-${oi}`, el); }}
                                  animate={isSelected ? { background: C.accent, borderColor: C.accent, color: C.primaryFg } : {}}
                                  transition={{ duration: 0.2 }}
                                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px', borderRadius: 5, border: `1px solid ${isSelected ? C.accent : C.border}`, background: isSelected ? C.accent : C.bg, fontSize: 9, fontWeight: 500, color: isSelected ? C.primaryFg : C.fgMuted }}
                                >
                                  <div style={{ width: 11, height: 11, borderRadius: 2, flexShrink: 0, border: `1.5px solid ${isSelected ? C.primaryFg : C.fgDim}`, background: isSelected ? C.primaryFg : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {isSelected && <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>}
                                  </div>
                                  {opt}
                                </motion.div>
                              );
                            })}
                          </div>
                        </motion.div>
                      );
                    })}
                    {visibleQuestions >= CLARIFY_QUESTIONS.length && currentQ >= CLARIFY_QUESTIONS.length && (
                      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 2, marginBottom: 8 }}>
                        <div style={{ fontSize: 9, color: C.fgDim, fontWeight: 500 }}>Skip — just optimize →</div>
                        <motion.div ref={optimizeBtnRef} animate={phase === 'click-optimize' ? { scale: 0.92 } : {}}
                          style={{ padding: '6px 14px', borderRadius: 7, background: C.accent, color: C.primaryFg, fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}
                        >✦ Optimize</motion.div>
                      </motion.div>
                    )}
                  </motion.div>
                )}
                {phase === 'loading2' && <DemoLoadingDots />}
                {showPrefs && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <div style={{ padding: '8px 12px', borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, maxWidth: '90%' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.fg, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                        ✦ Your preferences
                        <span style={{ fontSize: 7, color: C.fgDim, fontWeight: 500, background: C.secondary, padding: '1px 5px', borderRadius: 3, textTransform: 'uppercase' }}>Single</span>
                      </div>
                      {Object.entries(CLARIFY_PREFS).map(([label, vals]) => (
                        <div key={label} style={{ marginBottom: 4 }}>
                          <div style={{ fontSize: 8, color: C.fgDim, fontWeight: 500, marginBottom: 2 }}>{label}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {vals.map((v) => <span key={v} style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bg, color: C.fg, fontWeight: 500 }}>{v}</span>)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
                {showPrefs && (
                  <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 8 }}>
                    <DemoMiniMessage role="user">{CLARIFY_USER_TEXT}</DemoMiniMessage>
                  </motion.div>
                )}
                {phase === 'loading3' && <DemoLoadingDots />}
                {showResponse && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: C.fgDim, textTransform: 'uppercase', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <DemoPrmptLogo size={14} /> Prmpt
                      </div>
                      <div style={{ position: 'relative' }}>
                        <ClarifyResponseBubble text={CLARIFY_AI_RESPONSE.slice(0, streamedChars)} streaming={phase === 'streaming'} />
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 32, background: `linear-gradient(transparent, ${C.card})`, borderRadius: '0 0 10px 10px', pointerEvents: 'none' }} />
                      </div>
                      {phase === 'done' && (
                        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
                          <DemoActionBtn>📋 Copy</DemoActionBtn>
                          <DemoActionBtn>💾 Save</DemoActionBtn>
                          <DemoActionBtn>🔄 Regenerate</DemoActionBtn>
                          <div style={{ marginLeft: 'auto', fontSize: 8, color: C.fgDim, fontStyle: 'italic' }}>{CLARIFY_AI_RESPONSE.length} chars generated</div>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          <DemoMiniInputBar text={showInput ? CLARIFY_USER_TEXT.slice(0, typedChars) : ''} showCursor={phase === 'typing'} focused={phase === 'typing'} />
        </div>
      </DemoMiniAppShell>
    </div>
  );
}

function ClarifyResponseBubble({ text, streaming }: { text: string; streaming: boolean }) {
  const innerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (innerRef.current) innerRef.current.scrollTop = innerRef.current.scrollHeight; }, [text]);
  return (
    <div ref={innerRef} style={{ padding: '8px 12px', borderRadius: 10, fontSize: 11, lineHeight: 1.7, color: C.fg, background: C.card, border: `1px solid ${C.border}`, whiteSpace: 'pre-wrap', maxHeight: 130, overflowY: 'auto', scrollbarWidth: 'none' } as React.CSSProperties}>
      {text}
      {streaming && (
        <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.5, repeat: Infinity }}
          style={{ display: 'inline-block', width: 1.5, height: 13, background: C.accent, marginLeft: 1, verticalAlign: 'middle' }} />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Demo: Prompt Library — exact port of PromptLibraryDemo
   ───────────────────────────────────────────────────────────── */
const LIB_PROMPT_PREVIEW = 'You are a senior Electron developer with 5+ years of experience building cross-platform desktop applications and expertise in network monitoring systems. CONTEXT:...';
const LIB_FULL_PROMPT = [
  'You are a senior Electron developer with 5+ years of',
  'experience building cross-platform desktop applications',
  'and expertise in network monitoring systems.',
  '',
  'CONTEXT:',
  'Building a desktop application for testing and monitoring',
  'internet performance. The app targets both general users',
  'and network administrators who need to track speed,',
  'bandwidth usage, and connection statistics.',
  '',
  'TASK:',
  'Create a complete Electron desktop application that',
  'performs speed tests, monitors bandwidth in real-time,',
  'and displays usage statistics.',
  '',
  'REQUIREMENTS:',
  '- Framework: Electron 27+ with Node.js 18+',
  '- Frontend: React 18+ with TypeScript',
  '- Backend: Node.js with native system monitoring',
  '- Supported Platforms: Windows, macOS, Linux',
  '- Core Features:',
  '  • Speed test (download/upload/ping)',
  '  • Real-time bandwidth monitoring',
  '  • Historical usage statistics with charts',
];

function LibraryDemo({ onDone }: { onDone?: () => void }) {
  type Phase = 'chat-idle' | 'chat-actions' | 'click-save' | 'save-modal' | 'typing-title' | 'select-collection' | 'click-save-btn' | 'saved-toast' | 'goto-library' | 'library-view' | 'library-prompts' | 'click-prompt' | 'prompt-modal' | 'prompt-scroll' | 'done' | 'reset';
  const [phase, setPhase] = useState<Phase>('chat-idle');
  const [cursorPos, setCursorPos] = useState({ x: 300, y: 200 });
  const [cursorClicking, setCursorClicking] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(false);
  const [titleChars, setTitleChars] = useState(0);
  const [modalScrollTop, setModalScrollTop] = useState(0);
  const saveBtnRef = useRef<HTMLDivElement>(null);
  const libNavRef = useRef<HTMLDivElement>(null);
  const promptCardRef = useRef<HTMLDivElement>(null);
  const TITLE_TEXT = 'Speed modifying app';

  const getCursorPosForElement = useCallback((el: HTMLElement | null | undefined) => {
    if (!el) return null;
    const container = el.closest('[data-demo-root]');
    if (!container) return null;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    return { x: eRect.left - cRect.left + eRect.width / 2, y: eRect.top - cRect.top + eRect.height / 2 };
  }, []);

  const reset = useCallback(() => { setPhase('chat-idle'); setCursorVisible(false); setCursorClicking(false); setTitleChars(0); setModalScrollTop(0); }, []);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const t = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)); };
    switch (phase) {
      case 'chat-idle': t(() => setPhase('chat-actions'), 1500); break;
      case 'chat-actions':
        t(() => { setCursorVisible(true); const pos = getCursorPosForElement(saveBtnRef.current); if (pos) setCursorPos(pos); }, 400);
        t(() => setPhase('click-save'), 1200);
        break;
      case 'click-save':
        setCursorClicking(true);
        t(() => setCursorClicking(false), 300);
        t(() => setPhase('save-modal'), 600);
        break;
      case 'save-modal': setCursorVisible(false); t(() => setPhase('typing-title'), 800); break;
      case 'typing-title':
        if (titleChars < TITLE_TEXT.length) {
          const ch = TITLE_TEXT[titleChars];
          t(() => setTitleChars(c => c + 1), ch === ' ' ? 60 : 35 + Math.random() * 30);
        } else t(() => setPhase('select-collection'), 600);
        break;
      case 'select-collection': t(() => setPhase('click-save-btn'), 800); break;
      case 'click-save-btn': t(() => setPhase('saved-toast'), 500); break;
      case 'saved-toast': t(() => setPhase('goto-library'), 1200); break;
      case 'goto-library':
        t(() => { setCursorVisible(true); const pos = getCursorPosForElement(libNavRef.current); if (pos) setCursorPos(pos); }, 300);
        t(() => { setCursorClicking(true); t(() => setCursorClicking(false), 300); }, 1000);
        t(() => setPhase('library-view'), 1400);
        break;
      case 'library-view': setCursorVisible(false); t(() => setPhase('library-prompts'), 600); break;
      case 'library-prompts':
        t(() => { setCursorVisible(true); const pos = getCursorPosForElement(promptCardRef.current); if (pos) setCursorPos(pos); }, 800);
        t(() => setPhase('click-prompt'), 1600);
        break;
      case 'click-prompt':
        setCursorClicking(true);
        t(() => setCursorClicking(false), 300);
        t(() => { setCursorVisible(false); setPhase('prompt-modal'); }, 600);
        break;
      case 'prompt-modal': t(() => setPhase('prompt-scroll'), 1200); break;
      case 'prompt-scroll':
        if (modalScrollTop < 120) { t(() => setModalScrollTop(s => s + 2), 30); }
        else t(() => setPhase('done'), 2000);
        break;
      case 'done': t(() => setPhase('reset'), 2000); onDone?.(); break;
      case 'reset': reset(); break;
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, titleChars, modalScrollTop, reset]);

  const showChat = ['chat-idle', 'chat-actions', 'click-save'].includes(phase);
  const showSaveModal = ['save-modal', 'typing-title', 'select-collection', 'click-save-btn'].includes(phase);
  const showToast = phase === 'saved-toast' || phase === 'goto-library';
  const showLibrary = ['library-view', 'library-prompts', 'click-prompt'].includes(phase);
  const showPromptModal = ['prompt-modal', 'prompt-scroll', 'done'].includes(phase);

  return (
    <div data-demo-root style={{ width: '100%', height: '100%', padding: 16, position: 'relative' }}>
      <DemoAnimatedCursor x={cursorPos.x} y={cursorPos.y} clicking={cursorClicking} visible={cursorVisible} />
      <div style={{ display: 'flex', width: '100%', height: '100%', background: C.bg, borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}`, fontFamily: "'Geist', -apple-system, sans-serif", boxShadow: '0 4px 24px rgba(0,0,0,0.08)', position: 'relative' }}>
        {/* Sidebar */}
        <div style={{ width: 140, background: C.sidebarBg, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', padding: '10px 8px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 12, padding: '0 4px' }}>
            <DemoPrmptLogo size={22} />
            <span style={{ fontSize: 11, fontWeight: 700, color: C.fg }}>Prmpt</span>
            <span style={{ fontSize: 7, fontWeight: 600, color: C.fgDim, textTransform: 'uppercase' }}>STUDIO</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px', borderRadius: 5, background: showChat ? 'rgba(0,0,0,0.04)' : 'transparent', fontSize: 10, color: C.fg, fontWeight: showChat ? 600 : 500 }}>
            <span style={{ fontSize: 10, width: 12, textAlign: 'center' }}>+</span>New Chat
          </div>
          <div ref={libNavRef}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px', borderRadius: 5, background: (showLibrary || showPromptModal) ? 'rgba(0,0,0,0.04)' : 'transparent', fontSize: 10, color: C.fg, fontWeight: (showLibrary || showPromptModal) ? 600 : 500 }}>
              <span style={{ fontSize: 10, width: 12, textAlign: 'center' }}>📖</span>Prompt Library
            </div>
          </div>
          <div style={{ fontSize: 7, fontWeight: 700, color: C.fgDim, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '10px 6px 4px' }}>RECENT</div>
          <div style={{ padding: '4px 8px', borderRadius: 4, fontSize: 9, color: C.primaryFg, background: C.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
            Internet Speed Manageme...
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 4px 0', borderTop: `1px solid ${C.border}` }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 600, color: C.primaryFg }}>T</div>
            <span style={{ fontSize: 9, fontWeight: 500, color: C.fg }}>TryPrmpt</span>
          </div>
        </div>
        {/* Main content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
          <div style={{ height: 24, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 4px', background: C.bg, flexShrink: 0 }}>
            {['—', '□', '×'].map((b, i) => <div key={i} style={{ width: 22, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: C.fgDim }}>{b}</div>)}
          </div>
          <AnimatePresence mode="wait">
            {showChat && (
              <motion.div key="chat" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }}
                style={{ flex: 1, overflow: 'auto', padding: '8px 12px', scrollbarWidth: 'none' } as React.CSSProperties}
              >
                <DemoMiniMessage role="user">make me a desktop app that manages internet speed</DemoMiniMessage>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 8, fontWeight: 600, color: C.fgDim, textTransform: 'uppercase', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <DemoPrmptLogo size={12} /> Prmpt
                  </div>
                  <div style={{ padding: '6px 10px', borderRadius: 8, fontSize: 10, lineHeight: 1.6, color: C.fg, background: C.card, border: `1px solid ${C.border}`, maxHeight: 80, overflow: 'hidden', position: 'relative' }}>
                    {LIB_FULL_PROMPT.slice(0, 8).join('\n')}
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 20, background: `linear-gradient(transparent, ${C.card})` }} />
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    <DemoActionBtn>📋 Copy</DemoActionBtn>
                    <div ref={saveBtnRef}>
                      <motion.div
                        animate={phase === 'click-save' ? { background: C.accent, color: C.primaryFg, borderColor: C.accent, scale: 1.02 } : {}}
                        transition={{ duration: 0.2 }}
                        style={{ padding: '3px 7px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.card, fontSize: 9, color: C.fgMuted, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}
                      >💾 Save</motion.div>
                    </div>
                    <DemoActionBtn>🔄 Regenerate</DemoActionBtn>
                  </div>
                </div>
              </motion.div>
            )}
            {(showLibrary || showPromptModal) && (
              <motion.div key="library" initial={{ opacity: 0, x: 15 }} animate={{ opacity: 1, x: 0 }}
                style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
              >
                <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                  <div style={{ width: 100, borderRight: `1px solid ${C.border}`, padding: '10px 6px', flexShrink: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.fg }}>Prompt Library</div>
                    <div style={{ fontSize: 8, color: C.fgDim, marginBottom: 8 }}>1 saved prompt</div>
                    {[['+ ', 'New Collection'], ['🔗', 'Open Shared Link']].map(([icon, label]) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 6px', borderRadius: 4, fontSize: 9, color: C.fgMuted, fontWeight: 500, marginBottom: 2 }}>
                        <span style={{ display: 'flex', alignItems: 'center', width: 12 }}><span style={{ fontSize: 9 }}>{icon}</span></span>{label}
                      </div>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 6px', borderRadius: 4, fontSize: 9, color: C.fg, fontWeight: 500, background: 'rgba(0,0,0,0.03)', marginBottom: 2 }}>
                      <FolderSimple size={11} weight="fill" style={{ flexShrink: 0 }} />Projects
                    </div>
                  </div>
                  <div style={{ flex: 1, padding: '10px 10px', overflow: 'auto' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.fg }}>All Prompts</div>
                    <div style={{ fontSize: 8, color: C.fgDim, marginBottom: 6 }}>1 prompt</div>
                    <div style={{ padding: '4px 8px', borderRadius: 6, marginBottom: 6, background: C.card, border: `1px solid ${C.border}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                        <span style={{ fontSize: 10 }}>🔍</span>
                        <span style={{ fontSize: 9, color: C.fgDim }}>Search by title or content...</span>
                      </div>
                    </div>
                    <motion.div ref={promptCardRef} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                      style={{ padding: '8px 10px', borderRadius: 8, background: C.card, border: `1px solid ${C.border}` }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.fg, marginBottom: 3 }}>Speed modifying app</div>
                      <div style={{ fontSize: 9, color: C.fgMuted, lineHeight: 1.5, maxHeight: 32, overflow: 'hidden' }}>{LIB_PROMPT_PREVIEW}</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, fontSize: 8, color: C.fgDim }}>
                        <span>📅 4/9/2026</span>
                        <span>💬 Internet Speed Management App</span>
                      </div>
                    </motion.div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Save modal */}
          <AnimatePresence>
            {showSaveModal && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30, borderRadius: 10 }}
              >
                <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                  style={{ width: '80%', maxWidth: 260, background: C.bg, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 16px 48px rgba(0,0,0,0.18)', overflow: 'hidden' }}
                >
                  <div style={{ padding: '10px 14px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.fg }}>Save Prompt</span>
                    <span style={{ fontSize: 11, color: C.fgDim }}>✕</span>
                  </div>
                  <div style={{ padding: '0 14px 12px' }}>
                    <div style={{ fontSize: 9, fontWeight: 600, color: C.fgMuted, marginBottom: 3 }}>Prompt Title</div>
                    <div style={{ padding: '6px 8px', borderRadius: 6, background: C.card, border: `1px solid ${C.border}`, fontSize: 10, color: C.fg, marginBottom: 8, minHeight: 22 }}>
                      {TITLE_TEXT.slice(0, titleChars)}
                      {phase === 'typing-title' && (
                        <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.5, repeat: Infinity }}
                          style={{ display: 'inline-block', width: 1, height: 12, background: C.accent, marginLeft: 1, verticalAlign: 'middle' }} />
                      )}
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: C.fgMuted, marginBottom: 3 }}>Preview</div>
                    <div style={{ padding: '6px 8px', borderRadius: 6, background: C.secondary, border: `1px solid ${C.border}`, fontSize: 8, color: C.fgDim, lineHeight: 1.5, maxHeight: 40, overflow: 'hidden', marginBottom: 8 }}>{LIB_PROMPT_PREVIEW}</div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: C.fgMuted, marginBottom: 3 }}>Choose collection</div>
                    <div style={{ padding: '5px 8px', borderRadius: 6, background: C.card, border: `1px solid ${C.border}`, fontSize: 9, color: phase === 'select-collection' || phase === 'click-save-btn' ? C.fg : C.fgDim, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{phase === 'select-collection' || phase === 'click-save-btn' ? 'Projects' : 'Select a collection'}</span>
                      <span>▾</span>
                    </div>
                    {phase === 'select-collection' && (
                      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                        style={{ padding: 4, borderRadius: 6, background: C.card, border: `1px solid ${C.border}`, marginBottom: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                      >
                        <div style={{ padding: '5px 8px', borderRadius: 4, fontSize: 9, color: C.fg, background: C.secondary, fontWeight: 500 }}>Projects</div>
                      </motion.div>
                    )}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <div style={{ flex: 1, padding: 6, borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 9, fontWeight: 500, color: C.fgMuted, textAlign: 'center', background: C.card }}>Cancel</div>
                      <motion.div animate={phase === 'click-save-btn' ? { scale: 0.95 } : {}}
                        style={{ flex: 1, padding: 6, borderRadius: 6, background: C.accent, color: C.primaryFg, fontSize: 9, fontWeight: 600, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                      >✓ Save</motion.div>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Toast */}
          <AnimatePresence>
            {showToast && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                style={{ position: 'absolute', bottom: 50, right: 12, zIndex: 30, padding: '6px 12px', borderRadius: 8, background: C.accent, color: C.primaryFg, fontSize: 9, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: 4 }}
              >✓ Saved!</motion.div>
            )}
          </AnimatePresence>
          {/* Prompt preview modal */}
          <AnimatePresence>
            {showPromptModal && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30, borderRadius: 10 }}
              >
                <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                  style={{ width: '85%', maxWidth: 300, maxHeight: '80%', background: C.bg, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 16px 48px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                >
                  <div style={{ padding: '10px 12px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.fg }}>📄 Speed modifying app</div>
                      <div style={{ fontSize: 8, color: C.fgDim, marginTop: 2 }}>From: Internet Speed Management App · Created: 4/9/2026</div>
                    </div>
                    <span style={{ fontSize: 11, color: C.fgDim }}>✕</span>
                  </div>
                  <div style={{ flex: 1, margin: '0 12px', padding: '8px 10px', borderRadius: 8, background: C.secondary, border: `1px solid ${C.border}`, fontSize: 9, lineHeight: 1.7, color: C.fg, overflow: 'hidden' }}>
                    <div style={{ transform: `translateY(-${modalScrollTop}px)`, transition: 'transform 0.1s linear' }}>
                      {LIB_FULL_PROMPT.map((line, i) => (
                        <div key={i} style={{ fontWeight: line.endsWith(':') ? 700 : 400, minHeight: line ? undefined : 8 }}>{line}</div>
                      ))}
                    </div>
                  </div>
                  <div style={{ padding: '8px 12px', display: 'flex', gap: 6, flexShrink: 0 }}>
                    <div style={{ flex: 1, padding: 6, borderRadius: 6, background: C.accent, color: C.primaryFg, fontSize: 9, fontWeight: 600, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>📋 Copy to Clipboard</div>
                    <div style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 9, fontWeight: 500, color: C.fgMuted, background: C.card }}>Close</div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Demo: Voice Input — exact port of VoiceTranscriptionDemo
   ───────────────────────────────────────────────────────────── */
const VOICE_WORDS = ['I', 'need', 'to', 'fix', 'a', 'bug', 'where', 'the', 'login', 'form', 'crashes', 'when', 'user', 'enters', 'special', 'characters', 'in', 'the', 'password', 'field', 'and', 'the', 'error', 'handler', "doesn't", 'catch', 'it'];
const VOICE_FULL = "I need to fix a bug where the login form crashes when user enters special characters in the password field and the error handler doesn't catch it";
const VOICE_AI_RESPONSE = `Here's your optimized prompt:\n\nROLE: You are a senior frontend developer debugging a React authentication form.\n\nBUG REPORT:\n- Component: LoginForm (login-form.tsx)\n- Issue: Application crashes on special character input in password field\n- Affected characters: <, >, &, ", ', \\, /, and unicode sequences\n- Root cause: Missing input sanitization before validation regex\n\nTASK:\nDebug and fix the password field crash by:\n1. Add input sanitization layer before regex validation\n2. Implement proper error boundary around the LoginForm component\n3. Add try-catch in the onChange handler for password field\n4. Escape special characters before passing to validation\n5. Add unit tests for edge cases (SQL injection strings, XSS vectors, unicode)\n\nEXPECTED BEHAVIOR:\n- Form should accept any valid password characters\n- Error messages should display inline, never crash the app\n- Validation should run after sanitization`;

function VoiceDemo({ onDone }: { onDone?: () => void }) {
  type Phase = 'idle' | 'click-mic' | 'listening' | 'transcribing' | 'transcription-done' | 'sending' | 'loading' | 'streaming' | 'done' | 'reset';
  const [phase, setPhase] = useState<Phase>('idle');
  const [visibleWords, setVisibleWords] = useState(0);
  const [streamedChars, setStreamedChars] = useState(0);
  const [cursorPos, setCursorPos] = useState({ x: 400, y: 300 });
  const [cursorClicking, setCursorClicking] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(false);
  const [waveAmplitudes, setWaveAmplitudes] = useState<number[]>(Array(12).fill(0));
  const scrollRef = useRef<HTMLDivElement>(null);
  const micBtnRef = useRef<HTMLDivElement>(null);

  const getCursorPos = useCallback((el: HTMLElement | null) => {
    if (!el) return null;
    const root = el.closest('[data-demo-root]');
    if (!root) return null;
    const rr = root.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    return { x: er.left - rr.left + er.width / 2, y: er.top - rr.top + er.height / 2 };
  }, []);

  useEffect(() => {
    if (scrollRef.current && ['streaming', 'done'].includes(phase)) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [streamedChars, phase]);

  useEffect(() => {
    if (phase !== 'listening' && phase !== 'transcribing') return;
    const id = setInterval(() => { setWaveAmplitudes(Array(12).fill(0).map(() => 4 + Math.random() * 16)); }, 120);
    return () => clearInterval(id);
  }, [phase]);

  const reset = useCallback(() => {
    setPhase('idle'); setVisibleWords(0); setStreamedChars(0);
    setCursorVisible(false); setCursorClicking(false); setWaveAmplitudes(Array(12).fill(0));
  }, []);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const t = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)); };
    switch (phase) {
      case 'idle':
        t(() => { setCursorVisible(true); const pos = getCursorPos(micBtnRef.current); if (pos) setCursorPos(pos); }, 800);
        t(() => setPhase('click-mic'), 1600);
        break;
      case 'click-mic':
        setCursorClicking(true);
        t(() => setCursorClicking(false), 300);
        t(() => { setCursorVisible(false); setPhase('listening'); }, 500);
        break;
      case 'listening': t(() => setPhase('transcribing'), 800); break;
      case 'transcribing':
        if (visibleWords < VOICE_WORDS.length) { t(() => setVisibleWords(v => v + 1), 120 + Math.random() * 80); }
        else t(() => setPhase('transcription-done'), 600);
        break;
      case 'transcription-done': t(() => setPhase('sending'), 800); break;
      case 'sending': t(() => setPhase('loading'), 200); break;
      case 'loading': t(() => setPhase('streaming'), 900); break;
      case 'streaming':
        if (streamedChars < VOICE_AI_RESPONSE.length) {
          const ch = VOICE_AI_RESPONSE[streamedChars];
          t(() => setStreamedChars(c => c + 1), ch === '\n' ? 40 : ch === ' ' ? 8 : 5 + Math.random() * 8);
          if (streamedChars % 50 === 0) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
        } else t(() => setPhase('done'), 2500);
        break;
      case 'done': t(() => setPhase('reset'), 2000); onDone?.(); break;
      case 'reset': reset(); break;
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, visibleWords, streamedChars, reset]);

  const showChat = !['idle', 'click-mic'].includes(phase);
  const isListening = phase === 'listening' || phase === 'transcribing';
  const showTranscription = visibleWords > 0;
  const showUserMsg = ['sending', 'loading', 'streaming', 'done'].includes(phase);
  const showResponse = streamedChars > 0;
  const transcribedText = VOICE_WORDS.slice(0, visibleWords).join(' ');

  return (
    <div data-demo-root style={{ width: '100%', height: '100%', padding: 16, position: 'relative' }}>
      <DemoAnimatedCursor x={cursorPos.x} y={cursorPos.y} clicking={cursorClicking} visible={cursorVisible} />
      <DemoMiniAppShell>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <AnimatePresence mode="wait">
            {!showChat ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20 }}
              >
                <DemoPrmptLogo size={48} />
                <div style={{ fontSize: 16, fontWeight: 700, color: C.fg }}>Welcome to Prmpt!!</div>
                <div style={{ fontSize: 11, color: C.fgMuted, textAlign: 'center' }}>Transform rough ideas into precisely engineered prompts.</div>
              </motion.div>
            ) : (
              <motion.div key="chat" ref={scrollRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                style={{ flex: 1, overflow: 'auto', padding: '10px 14px 4px', scrollbarWidth: 'none' } as React.CSSProperties}
              >
                {isListening && (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '16px 12px', marginBottom: 10 }}
                  >
                    <motion.div
                      animate={{ boxShadow: ['0 0 0px rgba(220,38,38,0)', '0 0 16px rgba(220,38,38,0.3)', '0 0 0px rgba(220,38,38,0)'] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(220,38,38,0.1)', border: '2px solid rgba(220,38,38,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#dc2626' }} />
                    </motion.div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#dc2626' }}>Listening...</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 24 }}>
                      {waveAmplitudes.map((amp, i) => (
                        <motion.div key={i} animate={{ height: amp }} transition={{ duration: 0.1 }}
                          style={{ width: 3, borderRadius: 2, background: `rgba(220,38,38,${0.3 + (amp / 20) * 0.5})` }} />
                      ))}
                    </div>
                  </motion.div>
                )}
                {showTranscription && !showUserMsg && (
                  <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                    style={{ padding: '8px 12px', borderRadius: 10, marginBottom: 10, background: 'rgba(220,38,38,0.04)', border: '1px solid rgba(220,38,38,0.15)', fontSize: 12, color: C.fg, lineHeight: 1.6 }}
                  >
                    <div style={{ fontSize: 8, fontWeight: 600, color: '#dc2626', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <motion.div animate={{ opacity: [1, 0.3] }} transition={{ duration: 0.8, repeat: Infinity }}
                        style={{ width: 5, height: 5, borderRadius: '50%', background: '#dc2626' }} />
                      TRANSCRIBING
                    </div>
                    {transcribedText}
                    <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.5, repeat: Infinity }}
                      style={{ display: 'inline-block', width: 1.5, height: 14, background: '#dc2626', marginLeft: 2, verticalAlign: 'middle' }} />
                  </motion.div>
                )}
                {showUserMsg && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                    <DemoMiniMessage role="user">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                        <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: 'rgba(220,38,38,0.08)', color: '#dc2626', fontWeight: 600, border: '1px solid rgba(220,38,38,0.15)' }}>🎤 Voice</span>
                      </div>
                      {VOICE_FULL}
                    </DemoMiniMessage>
                  </motion.div>
                )}
                {phase === 'loading' && <DemoLoadingDots />}
                {showResponse && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: C.fgDim, textTransform: 'uppercase', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <DemoPrmptLogo size={14} /> Prmpt
                      </div>
                      <VoiceResponseBubble text={VOICE_AI_RESPONSE.slice(0, streamedChars)} streaming={phase === 'streaming'} />
                      {phase === 'done' && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', gap: 5, marginTop: 4 }}>
                          <DemoActionBtn>📋 Copy</DemoActionBtn>
                          <DemoActionBtn>💾 Save</DemoActionBtn>
                          <DemoActionBtn>🔄 Regenerate</DemoActionBtn>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          {/* Custom input bar with mic */}
          <div style={{ flexShrink: 0 }}>
            <div style={{ margin: '0 14px 10px', background: C.card, border: `1px solid ${isListening ? 'rgba(220,38,38,0.3)' : C.border}`, borderRadius: 14, overflow: 'hidden', boxShadow: isListening ? '0 0 0 2px rgba(220,38,38,0.08)' : 'none', transition: 'all 0.3s' }}>
              <div style={{ padding: '10px 14px 4px', fontSize: 13, color: C.fgDim, minHeight: 32 }}>
                {isListening ? <span style={{ color: '#dc2626', fontWeight: 500, fontSize: 12 }}>🎤 Listening...</span> : 'How can I help you today?'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 8px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.fgDim, fontSize: 13 }}>+</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', fontSize: 11, color: C.fgMuted, fontWeight: 500 }}>
                    <span style={{ fontSize: 10 }}>⊞</span> Pro Mode
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div ref={micBtnRef}>
                    <motion.div
                      animate={isListening ? { background: 'rgba(220,38,38,0.1)', borderColor: 'rgba(220,38,38,0.3)' } : {}}
                      style={{ width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${isListening ? 'rgba(220,38,38,0.3)' : 'transparent'}`, color: isListening ? '#dc2626' : C.fgDim, transition: 'all 0.2s' }}
                    >
                      <svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor">
                        <path d="M128,176a48.05,48.05,0,0,0,48-48V64a48,48,0,0,0-96,0v64A48.05,48.05,0,0,0,128,176ZM96,64a32,32,0,0,1,64,0v64a32,32,0,0,1-64,0Zm40,143.6V232a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64,64,0,0,0,128,0,8,8,0,0,1,16,0A80.11,80.11,0,0,1,136,207.6Z" />
                      </svg>
                    </motion.div>
                  </div>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: C.border, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.fgDim} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DemoMiniAppShell>
    </div>
  );
}

function VoiceResponseBubble({ text, streaming }: { text: string; streaming: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [text]);
  return (
    <div ref={ref} style={{ padding: '8px 12px', borderRadius: 10, fontSize: 11, lineHeight: 1.7, color: C.fg, background: C.card, border: `1px solid ${C.border}`, whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto', scrollbarWidth: 'none' } as React.CSSProperties}>
      {text}
      {streaming && (
        <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.5, repeat: Infinity }}
          style={{ display: 'inline-block', width: 1.5, height: 13, background: C.accent, marginLeft: 1, verticalAlign: 'middle' }} />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Visual illustrations — dispatches to demo components
   ───────────────────────────────────────────────────────────── */
function FeatureVisual({ type, onDone }: { type: string; onDone?: () => void }) {
  switch (type) {
    case 'at-prompt': return <AtPromptDemo onDone={onDone} />;
    case 'memory':    return <MemoryDemo onDone={onDone} />;
    case 'chat':      return <ChatDemo onDone={onDone} />;
    case 'library':   return <LibraryDemo onDone={onDone} />;
    case 'voice':     return <VoiceDemo onDone={onDone} />;
    default:          return null;
  }
}

/* ─────────────────────────────────────────────────────────────
   Frameless-window title bar (drag area + Windows controls)
   ───────────────────────────────────────────────────────────── */
function OnboardingTitleBar({ isMac }: { isMac: boolean }) {
  return (
    <div
      className="absolute top-0 left-0 right-0 h-9 z-30 flex items-center justify-end select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {!isMac && (
        <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => (window.electronAPI as any)?.windowControls?.minimize()}
            aria-label="Minimise"
            className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150"
          >
            <Minus size={14} weight="light" />
          </button>
          <button
            onClick={() => (window.electronAPI as any)?.windowControls?.maximize()}
            aria-label="Maximise"
            className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150"
          >
            <Square size={12} weight="light" />
          </button>
          <button
            onClick={() => (window.electronAPI as any)?.windowControls?.close()}
            aria-label="Close"
            className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-white hover:bg-red-500/80 transition-colors duration-150"
          >
            <X size={14} weight="light" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   OnboardingPage
   ───────────────────────────────────────────────────────────── */
interface OnboardingPageProps {
  onComplete: () => void;
  userName?: string;
  /** Show only the AI provider step (later launches with no key set). */
  aiProviderOnly?: boolean;
}

export function OnboardingPage({ onComplete, userName, aiProviderOnly = false }: OnboardingPageProps) {
  const isMac = (window.electronAPI as any)?.platform === 'darwin';
  const [phase, setPhase] = useState<'theme-picker' | 'ai-provider' | 'features'>(
    aiProviderOnly ? 'ai-provider' : 'theme-picker',
  );
  const [selectedTheme, setSelectedTheme] = useState<'light' | 'dark'>(() => {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });
  const [activeIndex, setActiveIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [mounted, setMounted] = useState(false);
  const isPausedRef = useRef(false);
  const isLast = activeIndex === FEATURES.length - 1;
  const feature = FEATURES[activeIndex];
  const Icon = feature.icon;

  // Mount animation
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  const handleThemeSelect = useCallback((theme: 'light' | 'dark') => {
    setSelectedTheme(theme);
    const settings: SettingsData = { ...DEFAULT_SETTINGS, theme };
    applySettings(settings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, []);

  const handleThemeContinue = useCallback(() => {
    const settings: SettingsData = { ...DEFAULT_SETTINGS, theme: selectedTheme };
    if (window.electronAPI?.saveSettings) {
      window.electronAPI.saveSettings({
        theme: selectedTheme,
        font_size: settings.fontSize,
        font_family: settings.fontFamily,
        prompt_instructions: settings.promptInstructions,
      }).catch(() => {});
    }
    setPhase('ai-provider');
  }, [selectedTheme]);

  // After the AI provider step (saved or skipped): the feature tour, or done
  const finishAiProvider = useCallback(() => {
    if (aiProviderOnly) onComplete();
    else setPhase('features');
  }, [aiProviderOnly, onComplete]);

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

  /* ── Animation-driven advance ─────────────────────────── */
  const handleAnimationDone = useCallback(() => {
    if (isPausedRef.current) return;
    const next = activeIndex < FEATURES.length - 1 ? activeIndex + 1 : 0;
    transitionTo(next);
  }, [activeIndex, transitionTo]);

  /* ── Navigation helpers ────────────────────────────────── */
  const goNext = useCallback(() => {
    if (isLast) { onComplete(); return; }
    transitionTo(activeIndex + 1);
  }, [isLast, onComplete, activeIndex, transitionTo]);

  const goPrev = useCallback(() => {
    if (activeIndex > 0) transitionTo(activeIndex - 1);
  }, [activeIndex, transitionTo]);

  /* ── Keyboard navigation (only during features phase) ── */
  useEffect(() => {
    if (phase !== 'features') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      if (e.key === 'Escape') { onComplete(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase, goNext, goPrev, onComplete]);

  /* ── Progress indicator (simple slide-based fraction) ── */
  const overallProgress = (activeIndex + 1) / FEATURES.length;

  /* ── Transition classes ─────────────────────────────────── */
  const contentClass = isTransitioning
    ? 'opacity-0 translate-y-3 scale-[0.98]'
    : 'opacity-100 translate-y-0 scale-100';
  const visualClass = isTransitioning
    ? 'opacity-0 scale-95 translate-y-2'
    : 'opacity-100 scale-100 translate-y-0';

  /* ─── Render: AI provider (OpenRouter key + models) ────── */
  if (phase === 'ai-provider') {
    return (
      <div
        className={`fixed inset-0 z-50 flex flex-col bg-background overflow-hidden transition-opacity duration-700 ${mounted ? 'opacity-100' : 'opacity-0'}`}
      >
        <div
          className="absolute inset-0 opacity-[0.02] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px),
                              linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
            backgroundSize: '56px 56px',
          }}
        />
        <OnboardingTitleBar isMac={isMac} />
        <div className="flex-1 overflow-y-auto flex items-center justify-center px-8 py-12">
          <div className="w-full max-w-md">
            <Logo size="w-12 h-12" />
            <h1 className="mt-6 text-2xl font-bold text-foreground tracking-tight">Connect your AI provider</h1>
            <p className="mt-2 mb-8 text-sm text-muted-foreground">
              Prmpt runs on your computer and uses your own OpenRouter key, so you only pay OpenRouter for what you use.
              Your chats and code index stay on this machine.
            </p>
            <AIProviderForm variant="onboarding" onSaved={finishAiProvider} />
            <button
              type="button"
              onClick={finishAiProvider}
              className="mt-4 block text-xs text-muted-foreground/60 hover:text-muted-foreground"
            >
              {aiProviderOnly ? 'Skip for now' : 'Set this up later'} (Settings &gt; AI provider)
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Render: Theme Picker ─────────────────────────────── */
  if (phase === 'theme-picker') {
    return (
      <div
        className={`fixed inset-0 z-50 flex flex-col bg-background overflow-hidden select-none transition-opacity duration-700 ${mounted ? 'opacity-100' : 'opacity-0'}`}
      >
        {/* ── Subtle grid pattern ── */}
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
          {!isMac && (
            <div
              className="flex items-center h-full"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <button
                onClick={() => (window.electronAPI as any)?.windowControls?.minimize()}
                aria-label="Minimise"
                className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150"
              >
                <Minus size={14} weight="light" />
              </button>
              <button
                onClick={() => (window.electronAPI as any)?.windowControls?.maximize()}
                aria-label="Maximise"
                className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150"
              >
                <Square size={12} weight="light" />
              </button>
              <button
                onClick={() => (window.electronAPI as any)?.windowControls?.close()}
                aria-label="Close"
                className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-white hover:bg-red-500/80 transition-colors duration-150"
              >
                <X size={14} weight="light" />
              </button>
            </div>
          )}
        </div>

        {/* ── Centered content ── */}
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="w-full max-w-lg text-center">
            <Logo size="w-14 h-14 mx-auto" />
            <h1 className="mt-6 text-3xl font-bold text-foreground tracking-tight">
              Welcome{userName ? `, ${userName}` : ''}!
            </h1>
            <p className="mt-3 text-sm text-muted-foreground/60">
              Choose your preferred appearance to get started.
            </p>

            {/* ── Theme cards ── */}
            <div className="mt-10 flex items-stretch gap-5 justify-center">
              {/* Light */}
              <button
                onClick={() => handleThemeSelect('light')}
                className={`group relative flex flex-col items-center gap-4 w-48 rounded-2xl border-2 p-6 transition-all duration-200 ${
                  selectedTheme === 'light'
                    ? 'border-emerald bg-emerald/5 shadow-lg shadow-emerald/10'
                    : 'border-border/50 hover:border-border hover:bg-secondary/50'
                }`}
              >
                <div className={`w-24 h-16 rounded-xl border overflow-hidden transition-all ${
                  selectedTheme === 'light' ? 'border-emerald/30' : 'border-border/40'
                }`}>
                  <div className="h-full bg-white flex flex-col">
                    <div className="h-3 bg-gray-100 border-b border-gray-200 flex items-center px-1.5 gap-0.5">
                      <div className="w-1 h-1 rounded-full bg-red-400/60" />
                      <div className="w-1 h-1 rounded-full bg-amber-400/60" />
                      <div className="w-1 h-1 rounded-full bg-green-400/60" />
                    </div>
                    <div className="flex-1 p-1.5 space-y-1">
                      <div className="h-1 w-full rounded-full bg-gray-200" />
                      <div className="h-1 w-3/4 rounded-full bg-gray-200" />
                      <div className="h-1 w-1/2 rounded-full bg-gray-200" />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Sun size={16} weight={selectedTheme === 'light' ? 'fill' : 'light'}
                    className={selectedTheme === 'light' ? 'text-amber-500' : 'text-muted-foreground/50'} />
                  <span className={`text-sm font-semibold ${
                    selectedTheme === 'light' ? 'text-foreground' : 'text-muted-foreground/70'
                  }`}>
                    Light
                  </span>
                </div>
                {selectedTheme === 'light' && (
                  <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-emerald flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
              </button>

              {/* Dark */}
              <button
                onClick={() => handleThemeSelect('dark')}
                className={`group relative flex flex-col items-center gap-4 w-48 rounded-2xl border-2 p-6 transition-all duration-200 ${
                  selectedTheme === 'dark'
                    ? 'border-emerald bg-emerald/5 shadow-lg shadow-emerald/10'
                    : 'border-border/50 hover:border-border hover:bg-secondary/50'
                }`}
              >
                <div className={`w-24 h-16 rounded-xl border overflow-hidden transition-all ${
                  selectedTheme === 'dark' ? 'border-emerald/30' : 'border-border/40'
                }`}>
                  <div className="h-full bg-[#1a1a2e] flex flex-col">
                    <div className="h-3 bg-[#16162a] border-b border-[#2a2a4a] flex items-center px-1.5 gap-0.5">
                      <div className="w-1 h-1 rounded-full bg-red-400/60" />
                      <div className="w-1 h-1 rounded-full bg-amber-400/60" />
                      <div className="w-1 h-1 rounded-full bg-green-400/60" />
                    </div>
                    <div className="flex-1 p-1.5 space-y-1">
                      <div className="h-1 w-full rounded-full bg-[#2a2a4a]" />
                      <div className="h-1 w-3/4 rounded-full bg-[#2a2a4a]" />
                      <div className="h-1 w-1/2 rounded-full bg-[#2a2a4a]" />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Moon size={16} weight={selectedTheme === 'dark' ? 'fill' : 'light'}
                    className={selectedTheme === 'dark' ? 'text-blue-400' : 'text-muted-foreground/50'} />
                  <span className={`text-sm font-semibold ${
                    selectedTheme === 'dark' ? 'text-foreground' : 'text-muted-foreground/70'
                  }`}>
                    Dark
                  </span>
                </div>
                {selectedTheme === 'dark' && (
                  <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-emerald flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
              </button>
            </div>

            {/* ── Continue ── */}
            <button
              onClick={handleThemeContinue}
              className="mt-10 inline-flex items-center gap-2 text-sm font-semibold py-2.5 px-8 rounded-xl border border-input text-foreground hover:bg-muted transition-all duration-200"
            >
              Continue
              <ArrowRight size={14} weight="light" />
            </button>

            <p className="mt-4 text-[11px] text-muted-foreground/30">
              You can change this anytime in Settings
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Render: Features carousel ──────────────────────────── */
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
        {!isMac && (
          <div
            className="flex items-center h-full"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <button
              onClick={() => (window.electronAPI as any)?.windowControls?.minimize()}
              aria-label="Minimise"
              className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150"
            >
              <Minus size={14} weight="light" />
            </button>
            <button
              onClick={() => (window.electronAPI as any)?.windowControls?.maximize()}
              aria-label="Maximise"
              className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150"
            >
              <Square size={12} weight="light" />
            </button>
            <button
              onClick={() => (window.electronAPI as any)?.windowControls?.close()}
              aria-label="Close"
              className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-white hover:bg-red-500/80 transition-colors duration-150"
            >
              <X size={14} weight="light" />
            </button>
          </div>
        )}
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
      <div className="relative z-10 flex-1 flex items-center px-8 lg:px-16 pb-6 min-h-0">
        <div className="w-full max-w-6xl mx-auto flex items-center gap-12 lg:gap-20 h-full">

          {/* ── Left: Text content ── */}
          <div className="flex-1 min-w-0 max-w-md flex-shrink-0">
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
                      ? 'border border-input text-foreground hover:bg-muted'
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
            className="flex-1 min-w-0 relative self-stretch"
            onMouseEnter={() => { isPausedRef.current = true; }}
            onMouseLeave={() => { isPausedRef.current = false; }}
          >
            {/* Ambient glow behind the card */}
            <div className={`absolute inset-0 -inset-x-10 -inset-y-10 rounded-full bg-gradient-radial ${feature.glow} blur-[80px] opacity-60 pointer-events-none transition-all duration-1000`} />

            {/* Visual frame — fills available height */}
            <div className={`relative h-full transition-all duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${visualClass}`}
              style={{ minHeight: 360, maxHeight: 480 }}
            >
              <FeatureVisual type={feature.visual} onDone={handleAnimationDone} />
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
