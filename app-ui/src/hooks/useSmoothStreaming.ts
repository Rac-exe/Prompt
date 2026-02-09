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

    const startStreaming = useCallback(() => {
        streamBuffer.current = '';
        visualText.current = '';
        pendingFinalMessage.current = null;
        isStreamingRef.current = true;

        // Start 1 second in the future
        startTimestamp.current = performance.now() + 1000;

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

    useEffect(() => {
        const animate = (time: number) => {
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
            else if (lag > 40) charsToAdd = 3;  // Moderate catchup
            else if (lag > 10) charsToAdd = 2;  // Slight catchup

            if (currentLen < targetLen) {
                const nextContent = streamBuffer.current.substring(0, currentLen + charsToAdd);
                visualText.current = nextContent;

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

    return {
        streamingMessage,
        startStreaming,
        handleChunk,
        handleFinalMessage,
        isStreaming: isStreamingRef.current
    };
};
