import { useState, useEffect, useCallback } from "react";
import { SpacesList } from "./SpacesList";
import { SpaceWorkspace } from "./SpaceWorkspace";
import { Sparkle, Folder, ArrowRight, Lightning, Eye, Database } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { Space } from "./types";
import { loadSpaces, saveSpaces } from "./types";

interface ProjectsViewProps {
  onSendToChat?: (prompt: string) => void;
}

export const ProjectsView = ({ onSendToChat }: ProjectsViewProps = {}) => {
  const [spaces, setSpaces] = useState<Space[]>(() => loadSpaces());
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(() => {
    const saved = loadSpaces();
    return saved.length > 0 ? saved.sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0].id : null;
  });

  // Persist to localStorage on every change
  useEffect(() => {
    saveSpaces(spaces);
  }, [spaces]);

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
    setSpaces((prev) =>
      prev.map((s) => s.id === id ? { ...s, lastUsedAt: Date.now() } : s),
    );
  }, []);

  const handleUpdateSpace = useCallback((updated: Space) => {
    setSpaces((prev) => prev.map((s) => s.id === updated.id ? updated : s));
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

  // No spaces yet — full-page onboarding
  if (spaces.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald/20 to-emerald/5 flex items-center justify-center mb-5 border border-emerald/10">
          <Sparkle size={32} weight="duotone" className="text-emerald" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">Welcome to Spaces</h2>
        <p className="text-sm text-muted-foreground max-w-[380px] leading-relaxed mb-6">
          Create a workspace, attach your project folders, and get tailored prompts
          that understand your codebase. No manual context needed.
        </p>
        <Button
          size="sm"
          className="h-10 px-5 text-sm font-semibold gap-2 bg-emerald hover:bg-emerald/90 text-white shadow-sm transition-all hover:shadow-md"
          onClick={() => handleCreateSpace("My Space")}
        >
          <Folder size={16} weight="bold" />
          Create Your First Space
        </Button>
        <div className="flex items-center gap-5 mt-8 text-xs text-muted-foreground/50">
          <span className="flex items-center gap-1.5">
            <Lightning size={12} weight="fill" />
            Codebase-aware
          </span>
          <span className="flex items-center gap-1.5">
            <Eye size={12} weight="fill" />
            Live watching
          </span>
          <span className="flex items-center gap-1.5">
            <Database size={12} weight="fill" />
            Semantic search
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Left panel: spaces list */}
      <div className="w-[240px] flex-shrink-0">
        <SpacesList
          spaces={spaces}
          activeSpaceId={activeSpaceId}
          onSelectSpace={handleSelectSpace}
          onCreateSpace={handleCreateSpace}
          onRenameSpace={handleRenameSpace}
          onDeleteSpace={handleDeleteSpace}
        />
      </div>

      {/* Main area */}
      <div className="flex-1 min-w-0">
        {activeSpace ? (
          <SpaceWorkspace
            key={activeSpace.id}
            space={activeSpace}
            onUpdateSpace={handleUpdateSpace}
            onSendToChat={onSendToChat}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center h-full text-center px-6">
            <Folder size={36} weight="duotone" className="text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Select a space to get started</p>
          </div>
        )}
      </div>
    </div>
  );
};
