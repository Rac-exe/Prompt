import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Data URL for an attachment saved in the local attachment store (via the
 * main process), or null while it loads / if it is missing.
 */
export function useStoredFileUrl(storagePath?: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!storagePath || !window.electronAPI?.storage?.getSignedUrl) return;
    let alive = true;
    window.electronAPI.storage
      .getSignedUrl(storagePath)
      .then((res) => {
        if (alive && res?.signedUrl) setUrl(res.signedUrl);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [storagePath]);
  return url;
}

/** An image attachment from the local attachment store; shows `fallback` until loaded. */
export function StoredImage({
  storagePath,
  alt,
  className,
  style,
  fallback = null,
}: {
  storagePath: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  fallback?: ReactNode;
}) {
  const src = useStoredFileUrl(storagePath);
  if (!src) return <>{fallback}</>;
  return <img src={src} alt={alt} className={className} style={style} />;
}
