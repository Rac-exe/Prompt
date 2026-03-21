import React from 'react';

interface OfflineBannerProps {
  visible: boolean;
}

const OfflineBanner: React.FC<OfflineBannerProps> = ({ visible }) => {
  if (!visible) return null;
  return (
    <div className="offline-banner visible">
      <span className="offline-dot" />
      <span>You&rsquo;re offline — optimization unavailable. Cached prompts are still viewable &amp; saveable.</span>
    </div>
  );
};

export default React.memo(OfflineBanner);
