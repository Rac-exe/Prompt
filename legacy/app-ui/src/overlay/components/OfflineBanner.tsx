import React from 'react';

interface OfflineBannerProps {
  visible: boolean;
}

const OfflineBanner: React.FC<OfflineBannerProps> = ({ visible }) => {
  if (!visible) return null;
  return (
    <div className="offline-banner visible">
      <span className="offline-dot" />
      <span>You&rsquo;re offline &mdash; prompt optimization is paused. Cached prompts still work.</span>
    </div>
  );
};

export default React.memo(OfflineBanner);
