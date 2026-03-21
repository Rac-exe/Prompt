import { useCallback, useRef, useState } from 'react';
import type { AttachedFile, OverlayMessage, Turn } from '../lib/types';
import { generateGroupId, generateId } from '../lib/utils';

/**
 * useTurns – manages the turn-based versioning model for the overlay.
 *
 * Each turn = one user prompt ↔ one (or more) assistant response(s).
 * User edits create new versions within the same turn.
 * Regenerations create new assistant versions within the active user version.
 */
export function useTurns() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const messagesRef = useRef<OverlayMessage[]>([]);

  // Pending optimization tracking (mutable refs to avoid re-renders)
  const pendingTurnIdx = useRef(-1);
  const pendingUserVerIdx = useRef(-1);
  const pendingIsRegen = useRef(false);

  // ── Add a brand-new user message (creates a new turn) ────────────────────
  const addUserMessage = useCallback(
    (
      content: string,
      files?: AttachedFile[],
      skill?: string | null,
      skillLabel?: string | null,
    ): { msg: OverlayMessage; turnIdx: number; userGroupId: string; assistantGroupId: string } => {
      const msg: OverlayMessage = {
        id: generateId(),
        role: 'user',
        content,
        timestamp: Date.now(),
        attachedFiles: files || [],
        skill: skill ?? null,
        skillLabel: skillLabel ?? null,
      };
      messagesRef.current.push(msg);

      const userGroupId = generateGroupId();
      const assistantGroupId = generateGroupId();
      const newTurn: Turn = {
        userVersions: [msg],
        userActiveIdx: 0,
        assistantGroups: {},
        assistantActiveIdx: {},
        userGroupId,
        assistantGroupIds: { 0: assistantGroupId },
      };

      // We need the index synchronously — we know it's `turns.length` before set.
      const turnIdx = turns.length; // stale but correct before batched update
      setTurns((prev) => [...prev, newTurn]);

      pendingTurnIdx.current = turnIdx;
      pendingUserVerIdx.current = 0;
      pendingIsRegen.current = false;

      return { msg, turnIdx, userGroupId, assistantGroupId };
    },
    [turns.length],
  );

  // ── Register an assistant message into the correct turn/version ──────────
  const registerAssistantMessage = useCallback(
    (content: string, autoSavedToChat: boolean): OverlayMessage => {
      const msg: OverlayMessage = {
        id: generateId(),
        role: 'assistant',
        content,
        timestamp: Date.now(),
        autoSavedToChat,
      };
      messagesRef.current.push(msg);

      const tIdx = pendingTurnIdx.current;
      const uIdx = pendingUserVerIdx.current;

      setTurns((prev) => {
        const next = prev.map((t, i) => {
          if (i !== tIdx) return t;
          const turn = { ...t };
          const groups = { ...turn.assistantGroups };
          const activeIdxMap = { ...turn.assistantActiveIdx };
          const groupIds = { ...turn.assistantGroupIds };

          if (!groups[uIdx]) {
            groups[uIdx] = [];
            activeIdxMap[uIdx] = 0;
            if (!groupIds[uIdx]) groupIds[uIdx] = generateGroupId();
          }
          groups[uIdx] = [...groups[uIdx], msg];
          activeIdxMap[uIdx] = groups[uIdx].length - 1;

          return { ...turn, assistantGroups: groups, assistantActiveIdx: activeIdxMap, assistantGroupIds: groupIds };
        });
        return next;
      });

      return msg;
    },
    [],
  );

  // ── Create a new user version (edit) within a turn ───────────────────────
  const commitEdit = useCallback(
    (
      turnIdx: number,
      newContent: string,
    ): { newMsg: OverlayMessage; newUserVerIdx: number; turn: Turn } | null => {
      const turn = turns[turnIdx];
      if (!turn) return null;

      const activeMsg = turn.userVersions[turn.userActiveIdx];
      if (!activeMsg) return null;

      const newMsg: OverlayMessage = {
        id: generateId(),
        role: 'user',
        content: newContent,
        timestamp: Date.now(),
        attachedFiles: activeMsg.attachedFiles || [],
        skill: activeMsg.skill ?? null,
        skillLabel: activeMsg.skillLabel ?? null,
      };
      messagesRef.current.push(newMsg);

      const newUserVerIdx = turn.userVersions.length;
      const assistGroupId = generateGroupId();

      setTurns((prev) =>
        prev.map((t, i) => {
          if (i !== turnIdx) return t;
          return {
            ...t,
            userVersions: [...t.userVersions, newMsg],
            userActiveIdx: newUserVerIdx,
            assistantGroupIds: { ...t.assistantGroupIds, [newUserVerIdx]: assistGroupId },
          };
        }),
      );

      pendingTurnIdx.current = turnIdx;
      pendingUserVerIdx.current = newUserVerIdx;
      pendingIsRegen.current = false;

      // Return turn from state (pre-update) with added data for IPC usage
      const updatedTurn: Turn = {
        ...turn,
        userVersions: [...turn.userVersions, newMsg],
        userActiveIdx: newUserVerIdx,
        assistantGroupIds: { ...turn.assistantGroupIds, [newUserVerIdx]: assistGroupId },
      };

      return { newMsg, newUserVerIdx, turn: updatedTurn };
    },
    [turns],
  );

  // ── Prepare regeneration of the active assistant version ─────────────────
  const prepareRegenerate = useCallback(
    (turnIdx: number): { userVer: OverlayMessage; assistGroupId: string; assistVerIdx: number; uIdx: number; previousAssistantContent: string | null } | null => {
      const turn = turns[turnIdx];
      if (!turn) return null;

      const uIdx = turn.userActiveIdx;
      const userVer = turn.userVersions[uIdx];
      if (!userVer) return null;

      const groupIds = { ...turn.assistantGroupIds };
      if (!groupIds[uIdx]) groupIds[uIdx] = generateGroupId();
      const assistGroupId = groupIds[uIdx];
      const group = turn.assistantGroups[uIdx] || [];
      const assistVerIdx = group.length;

      // Collect the content of the currently displayed assistant message (last active version)
      const activeAssistIdx = turn.assistantActiveIdx[uIdx] ?? (group.length - 1);
      const lastAssistantMsg = group[activeAssistIdx] ?? group[group.length - 1] ?? null;
      const previousAssistantContent = lastAssistantMsg ? lastAssistantMsg.content : null;

      // Update groupIds in state if newly generated
      if (!turn.assistantGroupIds[uIdx]) {
        setTurns((prev) =>
          prev.map((t, i) =>
            i !== turnIdx ? t : { ...t, assistantGroupIds: groupIds },
          ),
        );
      }

      pendingTurnIdx.current = turnIdx;
      pendingUserVerIdx.current = uIdx;
      pendingIsRegen.current = true;

      return { userVer, assistGroupId, assistVerIdx, uIdx, previousAssistantContent };
    },
    [turns],
  );

  // ── Navigate user version ────────────────────────────────────────────────
  const navigateUserVersion = useCallback((turnIdx: number, direction: 1 | -1) => {
    setTurns((prev) =>
      prev.map((t, i) => {
        if (i !== turnIdx) return t;
        const newIdx = t.userActiveIdx + direction;
        if (newIdx < 0 || newIdx >= t.userVersions.length) return t;
        return { ...t, userActiveIdx: newIdx };
      }),
    );
  }, []);

  // ── Navigate assistant version ───────────────────────────────────────────
  const navigateAssistantVersion = useCallback((turnIdx: number, direction: 1 | -1) => {
    setTurns((prev) =>
      prev.map((t, i) => {
        if (i !== turnIdx) return t;
        const uIdx = t.userActiveIdx;
        const group = t.assistantGroups[uIdx];
        if (!group) return t;
        const curIdx = t.assistantActiveIdx[uIdx] || 0;
        const newIdx = curIdx + direction;
        if (newIdx < 0 || newIdx >= group.length) return t;
        return { ...t, assistantActiveIdx: { ...t.assistantActiveIdx, [uIdx]: newIdx } };
      }),
    );
  }, []);

  // ── Get message content by ID ────────────────────────────────────────────
  const getMessageContent = useCallback((msgId: string): string => {
    const msg = messagesRef.current.find((m) => m.id === msgId);
    return msg ? msg.content : '';
  }, []);

  // ── Clear all turns (new session) ────────────────────────────────────────
  const clearAll = useCallback(() => {
    setTurns([]);
    messagesRef.current = [];
    pendingTurnIdx.current = -1;
    pendingUserVerIdx.current = -1;
    pendingIsRegen.current = false;
  }, []);

  return {
    turns,
    messages: messagesRef,
    pendingTurnIdx,
    pendingUserVerIdx,
    pendingIsRegen,
    addUserMessage,
    registerAssistantMessage,
    commitEdit,
    prepareRegenerate,
    navigateUserVersion,
    navigateAssistantVersion,
    getMessageContent,
    clearAll,
  };
}
