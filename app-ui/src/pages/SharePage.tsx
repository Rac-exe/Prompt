import { useParams, useNavigate } from "react-router-dom";
import { SharedLibraryView } from "@/components/library/SharedLibraryView";

/**
 * Route: /#/share/:token
 *
 * Renders the shared library view for any visitor.
 * After the user saves the library, they are redirected to the main app (/#/).
 */
const SharePage = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const handleSaved = () => {
    // Redirect to the library view in the main app
    navigate("/");
  };

  const handleBack = () => {
    navigate(-1);
  };

  if (!token) {
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
