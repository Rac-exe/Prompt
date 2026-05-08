const TECH_PATTERNS = [
  /node_modules/i,
  /\.node['"]/i,
  /NODE_MODULE_VERSION/i,
  /ENOENT|ECONNREFUSED|EPERM|EPIPE|ENOTFOUND/i,
  /new row violates|violates RLS|permission denied/i,
  /PowerShell|stderr|stdout/i,
  /at Object\.|at async /i,
  /compiled against/i,
];

/**
 * Strip Electron's IPC prefix and any technical internals from an error.
 * Returns the fallback string if the error looks technical.
 * Passes through intentionally human-readable errors (e.g. "Collection X already exists").
 */
export function friendlyError(e: unknown, fallback: string): string {
  if (e == null) return fallback;
  const raw = e instanceof Error ? e.message : String(e);
  const stripped = raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  if (TECH_PATTERNS.some((p) => p.test(stripped))) return fallback;
  return stripped || fallback;
}
