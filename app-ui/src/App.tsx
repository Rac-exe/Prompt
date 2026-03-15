import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import { AuthWrapper } from "@/components/auth/AuthWrapper";
import Index from "./pages/Index";
import SharePage from "./pages/SharePage";
import SharePromptPage from "./pages/SharePromptPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <HashRouter>
          <Routes>
            {/* Share routes are intentionally OUTSIDE AuthWrapper so anyone can view */}
            <Route path="/share/:token" element={<SharePage />} />
            <Route path="/share/prompt/:token" element={<SharePromptPage />} />
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
  );
};

export default App;
