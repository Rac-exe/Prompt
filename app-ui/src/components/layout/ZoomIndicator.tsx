import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Minus } from "@phosphor-icons/react";

export const ZoomIndicator = () => {
  const [percent, setPercent] = useState(100);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialised = useRef(false);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 2000);
  }, []);

  useEffect(() => {
    window.electronAPI?.zoom?.get().then((data) => {
      setPercent(data.percent);
      initialised.current = true;
    });

    const unsub = window.electronAPI?.zoom?.onChanged((data) => {
      setPercent(data.percent);
      setVisible(true);
      scheduleHide();
    });

    return () => {
      unsub?.();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [scheduleHide]);

  const handleZoomIn = () => window.electronAPI?.zoom?.set(percent + 10);
  const handleZoomOut = () => window.electronAPI?.zoom?.set(percent - 10);
  const handleReset = () => window.electronAPI?.zoom?.set(100);

  if (!visible || percent === 100) return null;

  return (
    <div className="fixed top-11 right-2 z-50 animate-fade-in">
      <div className="flex items-center gap-0.5 bg-popover/95 backdrop-blur-md border border-border
                      rounded-lg shadow-elevated px-1 py-0.5 select-none">
        <span className="min-w-[2.5rem] h-6 px-1.5 flex items-center justify-center
                         text-[11px] font-medium text-foreground tabular-nums">
          {percent}%
        </span>

        <button
          onClick={handleZoomOut}
          className="w-6 h-6 flex items-center justify-center rounded
                     text-muted-foreground hover:text-foreground hover:bg-white/10
                     transition-colors"
          aria-label="Zoom out"
        >
          <Minus size={12} weight="bold" />
        </button>

        <button
          onClick={handleZoomIn}
          className="w-6 h-6 flex items-center justify-center rounded
                     text-muted-foreground hover:text-foreground hover:bg-white/10
                     transition-colors"
          aria-label="Zoom in"
        >
          <Plus size={12} weight="bold" />
        </button>

        <button
          onClick={handleReset}
          className="h-6 px-2 flex items-center justify-center rounded
                     text-[11px] font-medium text-muted-foreground
                     hover:text-foreground hover:bg-white/10 transition-colors
                     border-l border-border ml-0.5 pl-2"
        >
          Reset
        </button>
      </div>
    </div>
  );
};
