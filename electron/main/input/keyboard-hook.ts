import { EventEmitter } from "events";

/**
 * Simplified keyboard hook - now only used for logging
 * Text state polling is handled by TextStatePoller
 */
export class KeyboardHook extends EventEmitter {
  constructor() {
    super();
  }

  start() {
    console.log("[KeyboardHook] Started (deprecated - using TextStatePoller)");
  }

  stop() {
    console.log("[KeyboardHook] Stopped");
    this.removeAllListeners();
  }
}
