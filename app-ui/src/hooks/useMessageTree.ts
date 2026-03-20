/**
 * useMessageTree — Tree-based message versioning for ChatGPT-style edit/retry navigation.
 *
 * Instead of a flat list, messages are organized as a tree:
 *   ROOT → U1 → A1 → U2 → A2
 *                    └→ U2' → A2'   (edit/retry creates a sibling branch)
 *
 * The "active path" walks from ROOT to leaf following the active child at each fork,
 * giving us the currently displayed conversation. Version navigation changes which
 * child is active at a fork point.
 */

import { useCallback, useRef, useState } from 'react';
import type { Message } from '@/components/chat/MessageBubble';

const ROOT = '__ROOT__';

export interface VersionInfo {
  total: number;
  current: number; // 1-based for display
  parentId: string;
}

interface TreeData {
  /** parentId → ordered child message IDs */
  children: Record<string, string[]>;
  /** parentId → index of the active child */
  active: Record<string, number>;
  /** childId → parentId */
  parent: Record<string, string>;
}

export function useMessageTree() {
  const tree = useRef<TreeData>({
    children: { [ROOT]: [] },
    active: {},
    parent: {},
  });

  // Incrementing counter used as a useMemo dependency so consumers recompute
  // when the tree changes. We deliberately use state (not a ref) for reactivity.
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion(v => v + 1), []);

  // ── Initialise ─────────────────────────────────────────────────────────────

  /**
   * Build a tree from a flat messages array.
   *
   * If messages carry `groupId` metadata the tree reconstructs version
   * branches (edits / retries) automatically.  Messages that share the
   * same `groupId` become siblings under the same parent.
   *
   * Without `groupId` metadata (legacy chats) it falls back to a plain
   * linear chain — identical to the old behaviour.
   */
  const init = useCallback((messages: Message[]) => {
    const t: TreeData = { children: { [ROOT]: [] }, active: {}, parent: {} };

    // Sort chronologically
    const sorted = [...messages].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const hasGroupMeta = sorted.some(m => m.groupId);

    if (!hasGroupMeta) {
      // ── Legacy linear chain ───────────────────────────────────────────
      let prev = ROOT;
      for (const m of sorted) {
        if (!t.children[prev]) t.children[prev] = [];
        t.children[prev].push(m.id);
        t.active[prev] = t.children[prev].length - 1;
        t.parent[m.id] = prev;
        prev = m.id;
      }
      tree.current = t;
      bump();
      return;
    }

    // ── Group-aware reconstruction ────────────────────────────────────
    //
    // Walk messages in chronological order.
    //
    //  • First time we see a `groupId`  → new conversation slot.
    //    Attach as child of the current branch-end (`lastId`).
    //
    //  • Subsequent versions of the same `groupId` → sibling.
    //    Parent is the *corresponding version* of the previous group
    //    (or ROOT if the first group).  This ensures each edit branch
    //    forms a proper sub-tree.
    //
    const groupVersions = new Map<string, string[]>(); // groupId → msg IDs in version order
    const msgToGroup = new Map<string, string>();       // msgId   → groupId

    let lastId = ROOT; // tracks the end of the "current" branch

    for (const msg of sorted) {
      const gid = msg.groupId || msg.id; // legacy fallback

      if (!groupVersions.has(gid)) {
        // ── First version of a new group ──
        groupVersions.set(gid, [msg.id]);
        msgToGroup.set(msg.id, gid);

        if (!t.children[lastId]) t.children[lastId] = [];
        t.children[lastId].push(msg.id);
        t.active[lastId] = t.children[lastId].length - 1;
        t.parent[msg.id] = lastId;

        lastId = msg.id;
      } else {
        // ── Additional version (edit / retry) ──
        const versions = groupVersions.get(gid)!;
        const verIdx = versions.length; // 0-based index of THIS version
        versions.push(msg.id);
        msgToGroup.set(msg.id, gid);

        // Determine the correct parent for this version.
        const v0Id = versions[0];
        const v0Parent = t.parent[v0Id]; // parent of the first version

        let parentForVersion: string;

        if (v0Parent === ROOT) {
          parentForVersion = ROOT;
        } else {
          // Find the group the v0-parent belongs to, then pick
          // the matching version index (or the last available one).
          const parentGid = msgToGroup.get(v0Parent);
          if (parentGid) {
            const parentVersions = groupVersions.get(parentGid)!;
            parentForVersion = parentVersions[Math.min(verIdx, parentVersions.length - 1)];
          } else {
            parentForVersion = v0Parent; // safety fallback
          }
        }

        if (!t.children[parentForVersion]) t.children[parentForVersion] = [];
        t.children[parentForVersion].push(msg.id);
        t.active[parentForVersion] = t.children[parentForVersion].length - 1;
        t.parent[msg.id] = parentForVersion;

        // Follow the new branch for subsequent messages
        lastId = msg.id;
      }
    }

    tree.current = t;
    bump();
  }, [bump]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  /** Add `newId` as a sibling of `siblingOfId` (same parent), and make it active. */
  const addBranch = useCallback((siblingOfId: string, newId: string) => {
    const t = tree.current;
    const parentId = t.parent[siblingOfId];
    if (!parentId) return;
    if (!t.children[parentId]) t.children[parentId] = [];
    t.children[parentId].push(newId);
    t.active[parentId] = t.children[parentId].length - 1;
    t.parent[newId] = parentId;
    bump();
  }, [bump]);

  /** Add `childId` as a new child of `parentId` (linear chain extension). */
  const addChild = useCallback((parentId: string, childId: string) => {
    if (parentId === childId) return; // prevent self-loop
    const t = tree.current;
    if (!t.children[parentId]) t.children[parentId] = [];
    if (t.children[parentId].includes(childId)) return; // duplicate guard
    t.children[parentId].push(childId);
    t.active[parentId] = t.children[parentId].length - 1;
    t.parent[childId] = parentId;
    bump();
  }, [bump]);

  /** Swap a temporary placeholder ID for the real backend-assigned ID. */
  const replaceId = useCallback((oldId: string, newId: string) => {
    const t = tree.current;
    const parentId = t.parent[oldId];
    if (!parentId) return;

    // Update in parent's children list
    const siblings = t.children[parentId];
    if (siblings) {
      const idx = siblings.indexOf(oldId);
      if (idx !== -1) siblings[idx] = newId;
    }

    // Parent mapping
    t.parent[newId] = parentId;
    delete t.parent[oldId];

    // Transfer children
    if (t.children[oldId]) {
      t.children[newId] = t.children[oldId];
      delete t.children[oldId];
      for (const child of t.children[newId]) {
        t.parent[child] = newId;
      }
    }

    // Transfer active-child pointer
    if (t.active[oldId] !== undefined) {
      t.active[newId] = t.active[oldId];
      delete t.active[oldId];
    }

    bump();
  }, [bump]);

  // ── Queries ────────────────────────────────────────────────────────────────

  /** Walk from ROOT following active children → returns ordered message IDs. */
  const getActivePath = useCallback((): string[] => {
    const t = tree.current;
    const path: string[] = [];
    let current = ROOT;
    const visited = new Set<string>(); // safety against cycles
    while (true) {
      if (visited.has(current)) break;
      visited.add(current);
      const kids = t.children[current];
      if (!kids || kids.length === 0) break;
      const idx = Math.min(t.active[current] ?? 0, kids.length - 1);
      path.push(kids[idx]);
      current = kids[idx];
    }
    return path;
  }, []);

  /** Version info for a message, or null if there's no branching at its parent. */
  const getVersionInfo = useCallback((messageId: string): VersionInfo | null => {
    const t = tree.current;
    const parentId = t.parent[messageId];
    if (!parentId) return null;
    const siblings = t.children[parentId];
    if (!siblings || siblings.length <= 1) return null;
    const activeIdx = Math.min(t.active[parentId] ?? 0, siblings.length - 1);
    return {
      total: siblings.length,
      current: activeIdx + 1,
      parentId,
    };
  }, []);

  /** Whether a message is already tracked in the tree. */
  const has = useCallback((id: string): boolean => !!tree.current.parent[id], []);

  // ── Navigation ─────────────────────────────────────────────────────────────

  /** Switch to the prev/next sibling at a branch point. */
  const navigate = useCallback((parentId: string, direction: 'prev' | 'next') => {
    const t = tree.current;
    const siblings = t.children[parentId];
    if (!siblings) return;
    const cur = t.active[parentId] ?? 0;
    const next = direction === 'prev' ? cur - 1 : cur + 1;
    if (next < 0 || next >= siblings.length) return;
    t.active[parentId] = next;
    bump();
  }, [bump]);

  return {
    init,
    addBranch,
    addChild,
    replaceId,
    getActivePath,
    getVersionInfo,
    navigate,
    has,
    version,
    ROOT,
  };
}
