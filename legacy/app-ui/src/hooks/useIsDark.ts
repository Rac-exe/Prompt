import { useState, useEffect } from 'react';

/**
 * Returns true when the <html> element has the `dark` class,
 * and updates reactively when the theme is toggled.
 */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
