import { useState, useEffect, useRef, useCallback } from "react";
import type { AttachedFile } from "@/types/electron";

export type ChatUIState = {
  input: string;
  mode: "fast" | "thinking";
  skills: string[];
  attachedFiles: AttachedFile[];
};

const MAX_SKILLS = 2;

const getDefaultState = (): ChatUIState => ({
  input: "",
  mode: "thinking",
  skills: [],
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
  const [selectedSkills, setSelectedSkillsRaw] = useState<string[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  const setSelectedSkills = useCallback((update: string[] | ((prev: string[]) => string[])) => {
    setSelectedSkillsRaw((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      return next.slice(0, MAX_SKILLS);
    });
  }, []);

  // Load state when selectedChatId changes
  useEffect(() => {
    if (!selectedChatId) {
      setInput("");
      setMode("thinking");
      setSelectedSkillsRaw([]);
      setAttachedFiles([]);
      return;
    }

    const state = chatUIStateMapRef.current[selectedChatId] || getDefaultState();
    setInput(state.input);
    setMode(state.mode);
    setSelectedSkillsRaw(state.skills);
    setAttachedFiles(state.attachedFiles);
  }, [selectedChatId]);

  // Persist state to map whenever any value changes
  useEffect(() => {
    if (!selectedChatId) return;

    chatUIStateMapRef.current[selectedChatId] = {
      input,
      mode,
      skills: selectedSkills,
      attachedFiles,
    };
  }, [selectedChatId, input, mode, selectedSkills, attachedFiles]);

  // Clean up deleted chat state
  const deleteChatState = useCallback((chatId: string) => {
    delete chatUIStateMapRef.current[chatId];
  }, []);

  return {
    input,
    setInput,
    mode,
    setMode,
    selectedSkills,
    setSelectedSkills,
    attachedFiles,
    setAttachedFiles,
    deleteChatState,
  };
};
