import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

interface ScrollControllerOpts {
  /** True while streaming chunks are arriving */
  isStreaming: boolean;
  /** Number of committed messages / turns — used to detect new messages */
  messageCount: number;
  /** A value that changes each streaming chunk (e.g. accumulated content string) */
  streamingTrigger: unknown;
}

interface ScrollControllerReturn {
  /** Attach to the scroll container's onScroll */
  handleScroll: () => void;
  /** Imperatively scroll to bottom */
  scrollToBottom: () => void;
  /** True when a "scroll to bottom" floating button should be shown */
  showScrollButton: boolean;
}

/**
 * Single-source-of-truth scroll controller for chat containers.
 *
 * Rules:
 * - New message added AND user is at bottom → scroll to bottom
 * - Streaming starts AND user is at bottom → scroll to bottom
 * - During streaming, "soft stick" (throttled) keeps user at bottom if they were there
 * - If user scrolls up → respect it completely, never snap back
 * - Initial mount → scroll to bottom
 */
export function useScrollController(
  containerRef: RefObject<HTMLElement | null>,
  opts: ScrollControllerOpts,
): ScrollControllerReturn {
  const { isStreaming, messageCount, streamingTrigger } = opts;

  // ── Internal refs ──────────────────────────────────────────────────────────
  const isAtBottomRef = useRef(true);
  const isStreamingRef = useRef(isStreaming);
  const prevMsgCountRef = useRef(messageCount);
  const prevIsStreamingRef = useRef(isStreaming);

  // Keep streaming ref in sync for use inside scrollToBottom
  isStreamingRef.current = isStreaming;

  // ── Scroll button state ────────────────────────────────────────────────────
  const [showScrollButton, setShowScrollButton] = useState(false);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const checkIfAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, [containerRef]);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: isStreamingRef.current ? 'auto' : 'smooth',
    });
  }, [containerRef]);

  // ── onScroll handler (single listener) ─────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distFromBottom < 40;
    // Larger threshold for button to avoid flicker
    setShowScrollButton(distFromBottom > 100);
  }, [containerRef]);

  // ── Fix 3: Initial render → scroll to bottom ──────────────────────────────
  useEffect(() => {
    // Use rAF so the DOM has been painted with initial content
    requestAnimationFrame(() => {
      scrollToBottom();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fix 4: Recalculate isAtBottom after committed message changes ─────────
  // NOTE: intentionally excludes streamingTrigger — updating isAtBottom on
  // every streaming chunk races with Fix 7's setTimeout and wrongly marks the
  // user as "not at bottom" before Fix 7 can scroll them there.
  useEffect(() => {
    requestAnimationFrame(() => {
      isAtBottomRef.current = checkIfAtBottom();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageCount, checkIfAtBottom]);

  // ── Fix 1: New message OR streaming starts → conditional scroll ────────────
  useEffect(() => {
    // Case A: New message added → always scroll to bottom
    // (user just sent a prompt, or assistant response was committed)
    if (messageCount > prevMsgCountRef.current) {
      scrollToBottom();
    }
    // Case B: Streaming just started → scroll only if at bottom
    if (isStreaming && !prevIsStreamingRef.current && isAtBottomRef.current) {
      scrollToBottom();
    }

    prevMsgCountRef.current = messageCount;
    prevIsStreamingRef.current = isStreaming;
  }, [messageCount, isStreaming, scrollToBottom]);

  // ── Fix 7: Throttled "soft stick" during streaming ─────────────────────────
  useEffect(() => {
    if (!isStreaming || !isAtBottomRef.current) return;

    const id = setTimeout(() => {
      containerRef.current?.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'auto',
      });
    }, 100);

    return () => clearTimeout(id);
  }, [isStreaming, streamingTrigger, containerRef]);

  return { handleScroll, scrollToBottom, showScrollButton };
}
