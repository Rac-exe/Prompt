import { useParams, useNavigate } from "react-router-dom";
import * as Sentry from "@sentry/react";
import { SharedLibraryView } from "@/components/library/SharedLibraryView";

/**
 * Route: /#/share/c/:token
 *
 * Renders the shared library view. Requires the user to be authenticated in-app
 * (HMAC verified + RLS auth.uid() required). After saving, redirects to /#/.
 */
const SharePage = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const handleSaved = () => {
    Sentry.addBreadcrumb({
      category: "sharing",
      message: "Shared collection save flow completed",
      level: "info",
      data: { hasToken: Boolean(token) },
    });
    // Redirect to the library view in the main app
    navigate("/");
  };

  const handleBack = () => {
    navigate(-1);
  };

  if (!token) {
    Sentry.captureMessage("Share collection route missing token", "warning");
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground text-sm">
        Invalid share link.
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <SharedLibraryView
        token={token}
        onBack={handleBack}
        onSaved={handleSaved}
      />
    </div>
  );
};

export default SharePage;
