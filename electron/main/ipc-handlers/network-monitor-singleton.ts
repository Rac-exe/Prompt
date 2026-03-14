/**
 * Singleton export of NetworkMonitor for use across IPC handlers.
 * The monitor is created here and started from index-new.ts after windows are ready.
 */
import { NetworkMonitor } from '../utils/network-monitor';

export const networkMonitor = new NetworkMonitor();
