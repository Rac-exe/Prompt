import { ReactNode } from "react";
import { Minus, Square, X } from "lucide-react";

interface AppLayoutProps {
  children: ReactNode;
  sidebar: ReactNode;
}

export const AppLayout = ({ children, sidebar }: AppLayoutProps) => {
  const minimize = () => window.electronAPI?.windowControls?.minimize();
  const maximize = () => window.electronAPI?.windowControls?.maximize();
  const close    = () => window.electronAPI?.windowControls?.close();

  return (
    <div className="h-screen flex flex-col w-full bg-background overflow-hidden">

      {/* ── Custom title bar ──────────────────────────────────────
          Full-width draggable strip. Controls are no-drag so clicks
          register. Height h-9 (36px) — tight but comfortable.
      ──────────────────────────────────────────────────────────── */}
      <div
        className="h-9 flex-shrink-0 flex items-center justify-end select-none
                   border-b border-border/50 bg-background"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {/* Window control buttons */}
        <div
          className="flex items-center h-full"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* Minimise */}
          <button
            onClick={minimize}
            aria-label="Minimise"
            className="h-full w-11 flex items-center justify-center
                       text-muted-foreground/50 hover:text-foreground
                       hover:bg-white/5 transition-colors duration-150"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          {/* Maximise / Restore */}
          <button
            onClick={maximize}
            aria-label="Maximise"
            className="h-full w-11 flex items-center justify-center
                       text-muted-foreground/50 hover:text-foreground
                       hover:bg-white/5 transition-colors duration-150"
          >
            <Square className="w-3 h-3" />
          </button>

          {/* Close */}
          <button
            onClick={close}
            aria-label="Close"
            className="h-full w-11 flex items-center justify-center
                       text-muted-foreground/50 hover:text-white
                       hover:bg-red-500/80 transition-colors duration-150"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Main layout ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-shrink-0">{sidebar}</div>
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {children}
        </main>
      </div>

    </div>
  );
};
