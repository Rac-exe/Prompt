import { useState, useRef, useEffect, useCallback } from 'react';
import { Message } from '@/components/chat/MessageBubble';

interface UseSmoothStreamingProps {
    onStreamingComplete: (finalMessage: Message) => void;
}

export const useSmoothStreaming = ({ onStreamingComplete }: UseSmoothStreamingProps) => {
    const [streamingMessage, setStreamingMessage] = useState<Message | null>(null);

    // Refs for state that changes rapidly to avoid re-renders of the effect loop
    const streamBuffer = useRef<string>('');
    const visualText = useRef<string>('');
    const pendingFinalMessage = useRef<Message | null>(null);
    const animationFrameId = useRef<number | null>(null);
    const lastUpdateTime = useRef<number>(0);
    const isStreamingRef = useRef<boolean>(false);
    const startTimestamp = useRef<number>(0);
    // Each streaming session gets a unique generation ID so stale animation
    // loops from a stopped/cancelled stream don't interfere with the next one.
    const generationId = useRef<number>(0);

    const startStreaming = useCallback(() => {
        streamBuffer.current = '';
        visualText.current = '';
        pendingFinalMessage.current = null;
        isStreamingRef.current = true;
        generationId.current += 1; // Invalidate any leftover animation loop

        // Start 1 second in the future
        startTimestamp.current = performance.now() + 1000;

        // Don't show the bubble immediately. Wait for buffer to fill.
        setStreamingMessage(null);
    }, []);

    const handleChunk = useCallback((chunk: string, accumulated: string) => {
        // Update the buffer with the latest truth from the backend
        streamBuffer.current = accumulated;
    }, []);

    const handleFinalMessage = useCallback((message: Message) => {
        console.log('[useSmoothStreaming] Final message received, buffering...');
        // Store the final message but don't show it yet
        pendingFinalMessage.current = message;
        // Ensure buffer has the full final content
        streamBuffer.current = message.content;
    }, []);

    /**
     * Called when the user clicks Stop.
     * Skips the typewriter delay and immediately shows whatever has been
     * buffered so far. Does NOT call onStreamingComplete — the normal
     * message-received → handleFinalMessage → animate path still handles
     * committing the message once the backend resolves the aborted stream.
     */
    const stopStreaming = useCallback(() => {
        if (!isStreamingRef.current) return;
        console.log('[useSmoothStreaming] Stop — fast-flushing visual buffer');

        // Skip the startup delay so the partial text renders immediately
        startTimestamp.current = 0;

        // Show whatever is in the buffer right now
        const partial = streamBuffer.current;
        if (partial) {
            visualText.current = partial;
            setStreamingMessage(prev => ({
                id: prev?.id || 'streaming-temp',
                role: 'assistant',
                content: partial,
                timestamp: prev?.timestamp || new Date(),
            }));
        }
        // Leave isStreamingRef true — the animate loop will finalize normally
        // once handleFinalMessage() is called with the aborted partial result.
    }, []);

    useEffect(() => {
        const animate = (time: number) => {
            // Capture the generation at frame start; bail out if it changed
            const myGeneration = generationId.current;

            // If not streaming, stop the loop
            if (!isStreamingRef.current) {
                animationFrameId.current = requestAnimationFrame(animate);
                return;
            }

            // 1. Wait for start delay (1s) AND minimum buffer (e.g., 15 chars) to avoid "one word" stalls
            const hasMinBuffer = streamBuffer.current.length > 15 || pendingFinalMessage.current !== null;
            const hasTimePassed = time >= startTimestamp.current;

            if (!isStreamingRef.current || !hasMinBuffer || !hasTimePassed) {
                if (isStreamingRef.current) {
                    animationFrameId.current = requestAnimationFrame(animate);
                }
                return;
            }

            // Cap update rate to ~30fps (33ms)
            if (time - lastUpdateTime.current < 30) {
                animationFrameId.current = requestAnimationFrame(animate);
                return;
            }
            lastUpdateTime.current = time;

            const currentLen = visualText.current.length;
            const targetLen = streamBuffer.current.length;
            const lag = targetLen - currentLen;

            let charsToAdd = 1;

            if (lag > 200) charsToAdd = 10;      // Very fast catchup
            else if (lag > 100) charsToAdd = 5;   // Fast catchup
            else if (lag > 40) charsToAdd = 3;    // Moderate catchup
            else if (lag > 10) charsToAdd = 2;    // Slight catchup

            if (currentLen < targetLen) {
                const nextContent = streamBuffer.current.substring(0, currentLen + charsToAdd);
                visualText.current = nextContent;

                // Guard: if a stop happened while we were computing, bail out
                if (generationId.current !== myGeneration) return;

                // Initialize message if not yet visible
                setStreamingMessage(prev => {
                    if (!prev) {
                        return {
                            id: 'streaming-temp',
                            role: 'assistant',
                            content: nextContent,
                            timestamp: new Date(),
                        };
                    }
                    return { ...prev, content: nextContent };
                });
            } else if (pendingFinalMessage.current && currentLen >= targetLen) {
                // Animation complete AND final message arrived -> Finish!
                console.log('[useSmoothStreaming] Animation caught up, finalizing.');

                if (generationId.current !== myGeneration) return;

                onStreamingComplete(pendingFinalMessage.current);

                // Cleanup
                setStreamingMessage(null);
                streamBuffer.current = '';
                visualText.current = '';
                pendingFinalMessage.current = null;
                isStreamingRef.current = false;
            }

            animationFrameId.current = requestAnimationFrame(animate);
        };

        // Start the loop
        animationFrameId.current = requestAnimationFrame(animate);

        return () => {
            if (animationFrameId.current) {
                cancelAnimationFrame(animationFrameId.current);
            }
        };
    }, [onStreamingComplete]);

    // ── Visibility / focus handling ──────────────────────────────────────────
    // Chromium throttles requestAnimationFrame to ~1 fps when the window loses
    // focus or the page is hidden.  Without intervention, chunks pile up in
    // streamBuffer while visualText stalls, so when the user returns the
    // typewriter animation "restarts" through all the missed content.
    //
    // Fix: on any visibility-change event, immediately flush visualText to the
    // current buffer so the user always sees up-to-date text with no lag.
    // If the stream already finished while the page was hidden, finalize the
    // message on the next tick (gives React one render to show the flushed text
    // before the bubble is committed to the message list).
    useEffect(() => {
        const flush = () => {
            if (!isStreamingRef.current) return;

            const full = streamBuffer.current;
            // Advance visual pointer to wherever the buffer is right now
            visualText.current = full;
            if (full) {
                setStreamingMessage(prev => ({
                    id: prev?.id ?? 'streaming-temp',
                    role: 'assistant',
                    content: full,
                    timestamp: prev?.timestamp ?? new Date(),
                }));
            }
        };

        const handleVisibilityChange = () => {
            if (document.hidden) {
                // Leaving: flush so the rAF loop has nothing to catch up on
                flush();
            } else {
                // Returning: flush to latest buffer (stream may have advanced
                // while the page was hidden and rAF was throttled)
                flush();

                // If the stream finished while we were away, finalize on the
                // next tick rather than waiting for the throttled rAF.
                if (pendingFinalMessage.current) {
                    const myGeneration = generationId.current;
                    setTimeout(() => {
                        if (generationId.current !== myGeneration) return;
                        if (!pendingFinalMessage.current) return;
                        console.log('[useSmoothStreaming] Finalizing after page became visible.');
                        onStreamingComplete(pendingFinalMessage.current);
                        setStreamingMessage(null);
                        streamBuffer.current = '';
                        visualText.current = '';
                        pendingFinalMessage.current = null;
                        isStreamingRef.current = false;
                    }, 50);
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [onStreamingComplete]);

    return {
        streamingMessage,
        startStreaming,
        handleChunk,
        handleFinalMessage,
        stopStreaming,
        isStreaming: isStreamingRef.current
    };
};
