import { net } from 'electron';
import { EventEmitter } from 'events';

/**
 * NetworkMonitor — watches Electron's `net.isOnline()` on an interval
 * and broadcasts status changes to the app window and overlay.
 */
export class NetworkMonitor extends EventEmitter {
  private _isOnline: boolean = true;
  private _intervalId: NodeJS.Timeout | null = null;

  get isOnline(): boolean {
    return this._isOnline;
  }

  /**
   * Start polling for network status every 5 seconds.
   * Emits 'status-changed' events and sends IPC messages to both windows.
   */
  start(
    sendToApp: (channel: string, data: any) => void,
    sendToOverlay: (channel: string, data: any) => void,
    onReconnect?: () => void
  ): void {
    // Check immediately on start
    this._check(sendToApp, sendToOverlay, onReconnect);

    // Then poll every 5 seconds
    this._intervalId = setInterval(() => {
      this._check(sendToApp, sendToOverlay, onReconnect);
    }, 5000);

    console.log('[NetworkMonitor] Started polling every 5s');
  }

  stop(): void {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  private _check(
    sendToApp: (channel: string, data: any) => void,
    sendToOverlay: (channel: string, data: any) => void,
    onReconnect?: () => void
  ): void {
    const online = net.isOnline();

    if (online !== this._isOnline) {
      const wasOffline = !this._isOnline;
      this._isOnline = online;

      console.log(`[NetworkMonitor] Status changed → ${online ? 'ONLINE' : 'OFFLINE'}`);

      sendToApp('network:status', { isOnline: online });
      sendToOverlay('network:status', { isOnline: online });

      // Emit event for internal listeners (e.g. SyncManager)
      this.emit('status-changed', online);

      // If we just came back online, trigger sync
      if (online && wasOffline && onReconnect) {
        console.log('[NetworkMonitor] Reconnected — triggering sync');
        onReconnect();
      }
    }
  }
}
