import { ReactNode, useState, useEffect } from "react";
import { Minus, Square, X, WifiSlash, Warning } from "@phosphor-icons/react";
import { ZoomIndicator } from "./ZoomIndicator";

interface AppLayoutProps {
  children: ReactNode;
  sidebar: ReactNode;
}

export const AppLayout = ({ children, sidebar }: AppLayoutProps) => {
  const isMac = window.electronAPI?.platform === 'darwin';
  const minimize = () => window.electronAPI?.windowControls?.minimize();
  const maximize = () => window.electronAPI?.windowControls?.maximize();
  const close = () => window.electronAPI?.windowControls?.close();

  const [isOnline, setIsOnline] = useState(true);
  const [isPythonAvailable, setIsPythonAvailable] = useState(true);

  useEffect(() => {
    window.electronAPI?.onNetworkStatus?.((data) => {
      setIsOnline(data.isOnline);
    });
    window.electronAPI?.onNetworkReconnected?.(() => {
      setIsOnline(true);
    });
    window.electronAPI?.onPythonUnavailable?.(() => {
      setIsPythonAvailable(false);
    });
    window.electronAPI?.onPythonRecovered?.(() => {
      setIsPythonAvailable(true);
    });
  }, []);

  return (
    <div className="min-h-[100dvh] h-screen flex w-full bg-background overflow-hidden">

      {/* ── Sidebar (full height, no title bar above it) ── */}
      <div className="flex-shrink-0 h-full">{sidebar}</div>

      {/* ── Right column: title bar + content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* ── Custom title bar (only spans the content area) ────────
            Draggable strip for window movement. Controls are no-drag.
            Height h-9 (36px).
        ──────────────────────────────────────────────────────────── */}
        <div
          className={`h-9 flex-shrink-0 flex items-center select-none bg-background ${isMac ? 'justify-start pl-[80px]' : 'justify-end'}`}
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          {!isMac && (
            <div
              className="flex items-center h-full"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <button
                onClick={minimize}
                aria-label="Minimise"
                className="h-full w-11 flex items-center justify-center
                           text-muted-foreground/50 hover:text-foreground
                           hover:bg-white/5 transition-colors duration-150"
              >
                <Minus size={14} weight="light" />
              </button>

              <button
                onClick={maximize}
                aria-label="Maximise"
                className="h-full w-11 flex items-center justify-center
                           text-muted-foreground/50 hover:text-foreground
                           hover:bg-white/5 transition-colors duration-150"
              >
                <Square size={12} weight="light" />
              </button>

              <button
                onClick={close}
                aria-label="Close"
                className="h-full w-11 flex items-center justify-center
                           text-muted-foreground/50 hover:text-white
                           hover:bg-red-500/80 transition-colors duration-150"
              >
                <X size={14} weight="light" />
              </button>
            </div>
          )}
        </div>

        {/* ── Offline banner ── */}
        {!isOnline && (
          <div className="flex items-center justify-center gap-2 px-4 py-1.5
                         bg-amber-500/10 border-b border-amber-500/20 text-amber-400
                         text-[11px] font-medium flex-shrink-0 animate-fade-in">
            <WifiSlash size={12} weight="light" className="flex-shrink-0" />
            <span>You're offline — Prmpt needs internet to reach OpenRouter.</span>
          </div>
        )}

        {/* ── Python service unavailable banner ── */}
        {!isPythonAvailable && (
          <div className="flex items-center justify-center gap-2 px-4 py-1.5
                         bg-red-500/10 border-b border-red-500/20 text-red-400
                         text-[11px] font-medium flex-shrink-0 animate-fade-in">
            <Warning size={12} weight="light" className="flex-shrink-0" />
            <span>The local AI service isn't running — start it with npm run python:dev.</span>
          </div>
        )}

        {/* ── Content area ── */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {children}
        </main>

      </div>

      <ZoomIndicator />
    </div>
  );
};
