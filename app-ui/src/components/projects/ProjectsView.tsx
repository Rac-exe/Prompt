import { useState, useEffect, useCallback } from "react";
import { SpacesList } from "./SpacesList";
import { SpaceWorkspace } from "./SpaceWorkspace";
import { Sparkle, Folder, Lightning, Eye, Database } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { Space } from "./types";
import { loadSpaces, saveSpaces } from "./types";
import { useAuth } from "@/context/AuthContext";

interface ProjectsViewProps {
  onSendToChat?: (prompt: string) => void;
}

export const ProjectsView = ({ onSendToChat }: ProjectsViewProps = {}) => {
  const { user } = useAuth();
  const userId = user?.profile?.id ?? null;

  const [spaces, setSpaces] = useState<Space[]>(() => loadSpaces(userId));
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);

  // Reload spaces whenever the signed-in user changes (login, logout,
  // account switch). Without this, React state from the previous account
  // would leak into the next one.
  useEffect(() => {
    setSpaces(loadSpaces(userId));
    setActiveSpaceId(null);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    saveSpaces(spaces, userId);
  }, [spaces, userId]);

  const handleCreateSpace = useCallback((name: string) => {
    const newSpace: Space = {
      id: crypto.randomUUID(),
      name,
      projects: [],
      messages: [],
      projectMode: true,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    setSpaces((prev) => [...prev, newSpace]);
    setActiveSpaceId(newSpace.id);
  }, []);

  const handleRenameSpace = useCallback((id: string, name: string) => {
    setSpaces((prev) => prev.map((s) => s.id === id ? { ...s, name } : s));
  }, []);

  const handleDeleteSpace = useCallback((id: string) => {
    setSpaces((prev) => prev.filter((s) => s.id !== id));
    setActiveSpaceId((current) => current === id ? null : current);
  }, []);

  const handleSelectSpace = useCallback((id: string) => {
    setActiveSpaceId(id);
    setSpaces((prev) => prev.map((s) => s.id === id ? { ...s, lastUsedAt: Date.now() } : s));
  }, []);

  const handleUpdateSpace = useCallback((updated: Space) => {
    setSpaces((prev) => prev.map((s) => s.id === updated.id ? updated : s));
  }, []);

  const handleBack = useCallback(() => {
    setActiveSpaceId(null);
  }, []);

  const activeSpace = spaces.find((s) => s.id === activeSpaceId) ?? null;

  const api = (window as any).electronAPI?.project;
  if (!api) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Project context is not available in this environment.
      </div>
    );
  }

  /* ── Active space → detail view ────────────────── */
  if (activeSpace) {
    return (
      <div className="flex-1 flex h-full overflow-hidden">
        <SpaceWorkspace
          key={activeSpace.id}
          space={activeSpace}
          onUpdateSpace={handleUpdateSpace}
          onSendToChat={onSendToChat}
          onBack={handleBack}
        />
      </div>
    );
  }

  /* ── No spaces → onboarding ────────────────────── */
  if (spaces.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-emerald/10 flex items-center justify-center mb-6">
          <Sparkle size={28} weight="duotone" className="text-emerald" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2 tracking-tight">Welcome to Spaces</h2>
        <p className="text-[14px] text-muted-foreground/50 max-w-[380px] leading-relaxed mb-8">
          Create a workspace, attach your project folders, and get tailored prompts
          that understand your codebase.
        </p>
        <Button
          size="lg"
          className="h-11 px-6 text-[13px] font-semibold gap-2 bg-emerald hover:bg-emerald/90 text-white rounded-xl"
          onClick={() => handleCreateSpace("My Space")}
        >
          <Folder size={16} weight="bold" />
          Create Your First Space
        </Button>
        <div className="flex items-center gap-6 mt-10 text-[11px] text-muted-foreground/25 font-medium">
          <span className="flex items-center gap-1.5">
            <Lightning size={11} weight="fill" />
            Codebase-aware
          </span>
          <span className="flex items-center gap-1.5">
            <Eye size={11} weight="fill" />
            Live watching
          </span>
          <span className="flex items-center gap-1.5">
            <Database size={11} weight="fill" />
            Semantic search
          </span>
        </div>
      </div>
    );
  }

  /* ── Has spaces → card grid ────────────────────── */
  return (
    <div className="flex-1 flex h-full overflow-hidden">
      <SpacesList
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        onSelectSpace={handleSelectSpace}
        onCreateSpace={handleCreateSpace}
        onRenameSpace={handleRenameSpace}
        onDeleteSpace={handleDeleteSpace}
      />
    </div>
  );
};
