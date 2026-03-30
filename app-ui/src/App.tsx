import { useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, useNavigate } from "react-router-dom";
import { AuthWrapper } from "@/components/auth/AuthWrapper";
import Index from "./pages/Index";
import SharePage from "./pages/SharePage";
import SharePromptPage from "./pages/SharePromptPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function DeepLinkListener() {
  const navigate = useNavigate();
  useEffect(() => {
    const cleanup = window.electronAPI?.onNavigateToShare?.((routePath: string) => {
      // routePath is already the full validated route, e.g. /share/c/<token>
      navigate(routePath);
    });
    return () => cleanup?.();
  }, [navigate]);
  return null;
}

const App = () => {
  return (
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
          <h2>Something went wrong</h2>
          <p style={{ color: '#888' }}>An unexpected error occurred. Please restart the application.</p>
          <button onClick={resetError}>Try Again</button>
        </div>
      )}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <HashRouter>
            <DeepLinkListener />
            <Routes>
              {/* Share routes — outside AuthWrapper */}
              {/* Collections require app auth (handled inside SharedLibraryView via IPC) */}
              <Route path="/share/c/:token" element={<SharePage />} />
              {/* Prompts viewable in-app; web viewers use the Edge Function URL */}
              <Route path="/share/p/:token" element={<SharePromptPage />} />
              {/* All other routes require authentication */}
              <Route
                path="/*"
                element={
                  <AuthWrapper>
                    <Routes>
                      <Route path="/" element={<Index />} />
                      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </AuthWrapper>
                }
              />
            </Routes>
          </HashRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  );
};

export default App;
