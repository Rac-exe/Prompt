import { useState, useEffect, useRef, useCallback } from "react";
import type { AttachedFile } from "@/types/electron";

export type ChatUIState = {
  input: string;
  mode: "fast" | "thinking";
  skill: string | null;
  attachedFiles: AttachedFile[];
};

const getDefaultState = (): ChatUIState => ({
  input: "",
  mode: "thinking",
  skill: null,
  attachedFiles: [],
});

/**
 * Hook to manage per-chat UI state in memory.
 * Each chat has its own isolated input, mode, skill, and files.
 * State is NOT persisted — it resets on app reload.
 */
export const useChatUIState = (selectedChatId: string | null) => {
  // In-memory map: chatId -> UI state
  const chatUIStateMapRef = useRef<Record<string, ChatUIState>>({});

  // Local state for current chat
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"fast" | "thinking">("thinking");
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  // Load state when selectedChatId changes
  useEffect(() => {
    if (!selectedChatId) {
      // No chat selected → reset to defaults
      setInput("");
      setMode("thinking");
      setSelectedSkill(null);
      setAttachedFiles([]);
      return;
    }

    // Load state for this chat (or defaults if it doesn't exist yet)
    const state = chatUIStateMapRef.current[selectedChatId] || getDefaultState();
    setInput(state.input);
    setMode(state.mode);
    setSelectedSkill(state.skill);
    setAttachedFiles(state.attachedFiles);
  }, [selectedChatId]);

  // Persist state to map whenever any value changes
  useEffect(() => {
    if (!selectedChatId) return;

    chatUIStateMapRef.current[selectedChatId] = {
      input,
      mode,
      skill: selectedSkill,
      attachedFiles,
    };
  }, [selectedChatId, input, mode, selectedSkill, attachedFiles]);

  // Clean up deleted chat state
  const deleteChatState = useCallback((chatId: string) => {
    delete chatUIStateMapRef.current[chatId];
  }, []);

  return {
    input,
    setInput,
    mode,
    setMode,
    selectedSkill,
    setSelectedSkill,
    attachedFiles,
    setAttachedFiles,
    deleteChatState,
  };
};
