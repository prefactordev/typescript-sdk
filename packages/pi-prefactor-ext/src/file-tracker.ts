/**
 * File Tracker for pi-prefactor-ext
 *
 * Tracks file modifications during a session: create and update operations.
 * Used to build the filesModified array for agent_run result payload.
 *
 * @module
 */

import type { Logger } from './logger.js';

/**
 * File operation type
 */
export type FileOperation = 'create' | 'update';

/**
 * Tracked file entry
 */
interface FileEntry {
  path: string;
  operation: FileOperation;
  timestamp: number;
}

/**
 * File Tracker interface
 */
export interface FileTracker {
  trackFileModified(path: string, operation: FileOperation): void;
  getFilesModified(): Array<{ path: string; operation: FileOperation }>;
  getFilesCreated(): string[];
  getFilesUpdated(): string[];
  getAllPaths(): string[];
  reset(): void;
  getFileCount(): number;
}

/**
 * File Tracker implementation
 *
 * Features:
 * - Track file operations (create vs update)
 * - Distinguish between new files and modified files
 * - Store operation timestamps
 * - Reset between sessions
 */
export class FileTrackerImpl implements FileTracker {
  private logger: Logger;
  private files: Map<string, FileEntry> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
    logger.debug('file_tracker_init');
  }

  /**
   * Track a file modification
   *
   * @param path - File path that was modified
   * @param operation - Type of operation: 'create' or 'update'
   */
  trackFileModified(path: string, operation: FileOperation): void {
    const timestamp = Date.now();

    const entry: FileEntry = {
      path,
      operation,
      timestamp,
    };

    // If file was previously created, don't downgrade to update
    const existing = this.files.get(path);
    if (existing && existing.operation === 'create') {
      // Keep as 'create', just update timestamp
      this.files.set(path, { ...entry, operation: 'create' });
      this.logger.debug('file_modified_existing_create', { path, operation: 'create' });
      return;
    }

    this.files.set(path, entry);

    this.logger.info('file_modified_tracked', {
      path,
      operation,
      totalFiles: this.files.size,
    });
  }

  /**
   * Get all tracked file modifications
   *
   * @returns Array of file entries with path and operation
   */
  getFilesModified(): Array<{ path: string; operation: FileOperation }> {
    return Array.from(this.files.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get only files that were created (not just updated)
   *
   * @returns Array of file paths that were created
   */
  getFilesCreated(): string[] {
    return Array.from(this.files.entries())
      .filter(([, entry]) => entry.operation === 'create')
      .map(([path]) => path)
      .sort();
  }

  /**
   * Get only files that were updated (not created)
   *
   * @returns Array of file paths that were updated
   */
  getFilesUpdated(): string[] {
    return Array.from(this.files.entries())
      .filter(([, entry]) => entry.operation === 'update')
      .map(([path]) => path)
      .sort();
  }

  /**
   * Get all modified file paths (regardless of operation type)
   *
   * @returns Array of all file paths
   */
  getAllPaths(): string[] {
    return Array.from(this.files.keys()).sort();
  }

  /**
   * Reset all tracked files
   * Call at session end to prepare for next session
   */
  reset(): void {
    const count = this.files.size;
    this.files.clear();
    this.logger.debug('file_tracker_reset', { clearedCount: count });
  }

  /**
   * Get count of tracked files
   *
   * @returns Number of tracked file modifications
   */
  getFileCount(): number {
    return this.files.size;
  }
}

/**
 * Create a File Tracker instance
 *
 * @param logger - Logger instance
 * @returns File Tracker instance
 */
export function createFileTracker(logger: Logger): FileTracker {
  return new FileTrackerImpl(logger);
}
