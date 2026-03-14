import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { randomUUID } from 'crypto';

export type OfflineOpType =
  | 'save-prompt'
  | 'delete-prompt'
  | 'update-prompt'
  | 'toggle-favorite'
  | 'create-collection'
  | 'create-collection-and-save'
  | 'rename-collection'
  | 'delete-collection'
  | 'rename-chat'
  | 'delete-chat';

export interface QueuedOperation {
  id: string;
  type: OfflineOpType;
  payload: any;
  timestamp: string;
  retryCount: number;
}

/**
 * OfflineQueue — a persistent FIFO queue for mutations that failed
 * while offline. Operations are written to disk immediately so they
 * survive app restarts.
 *
 * File: {userData}/offline-queue.json
 */
export class OfflineQueue {
  private queuePath: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.queuePath = join(userDataPath, 'offline-queue.json');
  }

  private read(): QueuedOperation[] {
    try {
      if (!existsSync(this.queuePath)) return [];
      return JSON.parse(readFileSync(this.queuePath, 'utf-8'));
    } catch {
      return [];
    }
  }

  private write(ops: QueuedOperation[]): void {
    try {
      writeFileSync(this.queuePath, JSON.stringify(ops, null, 2), 'utf-8');
    } catch (err) {
      console.error('[OfflineQueue] Failed to write queue:', err);
    }
  }

  enqueue(type: OfflineOpType, payload: any): QueuedOperation {
    const op: QueuedOperation = {
      id: randomUUID(),
      type,
      payload,
      timestamp: new Date().toISOString(),
      retryCount: 0,
    };
    const ops = this.read();
    ops.push(op);
    this.write(ops);
    console.log(`[OfflineQueue] Queued operation: ${type} (id=${op.id})`);
    return op;
  }

  getAll(): QueuedOperation[] {
    return this.read();
  }

  remove(id: string): void {
    const ops = this.read().filter(op => op.id !== id);
    this.write(ops);
  }

  incrementRetry(id: string): void {
    const ops = this.read();
    const op = ops.find(o => o.id === id);
    if (op) {
      op.retryCount++;
      this.write(ops);
    }
  }

  size(): number {
    return this.read().length;
  }

  clear(): void {
    this.write([]);
  }
}

// Singleton
export const offlineQueue = new OfflineQueue();
