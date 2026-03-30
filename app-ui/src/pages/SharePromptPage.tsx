import { useParams, useNavigate } from "react-router-dom";
import { SharedPromptPage } from "@/components/library/SharedPromptPage";

/**
 * Route: /#/share/p/:token
 *
 * In-app viewer for a shared prompt (prmpt://share/p/<token> deep link).
 * HMAC token verified server-side. For browser access, use the Edge Function URL.
 */
const SharePromptPage = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  if (!token) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground text-sm">
        Invalid share link.
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <SharedPromptPage
        token={token}
        onBack={() => navigate(-1)}
      />
    </div>
  );
};

export default SharePromptPage;
