import type { StorageError } from "./storageError";

export type SaveStatus =
  | { kind: "saved"; revision: number }
  | { kind: "unsaved"; revision: number }
  | { kind: "saving"; revision: number }
  | { kind: "failed"; revision: number; error: StorageError };

/** Opaque handle for one save attempt. */
export interface SaveAttempt {
  readonly id: number;
}

/**
 * Tracks what the "Saved" indicator may claim. "Saved" appears only after the
 * latest attempt commits with no edits since; a failure stays visible until a
 * later save commits (AGENTS.md invariant 10).
 */
export class SaveTracker {
  private committedRevision: number;
  private dirty = false;
  private dirtySinceAttempt = false;
  private inFlight: number | null = null;
  private lastAttemptId = 0;
  private error: StorageError | null = null;

  constructor(committedRevision: number) {
    this.committedRevision = committedRevision;
  }

  markDirty(): void {
    this.dirty = true;
    if (this.inFlight !== null) this.dirtySinceAttempt = true;
  }

  beginSave(): SaveAttempt {
    this.lastAttemptId += 1;
    this.inFlight = this.lastAttemptId;
    this.dirtySinceAttempt = false;
    return { id: this.lastAttemptId };
  }

  commitSucceeded(attempt: SaveAttempt, revision: number): void {
    if (attempt.id !== this.lastAttemptId) return;
    this.inFlight = null;
    this.committedRevision = revision;
    this.error = null;
    this.dirty = this.dirtySinceAttempt;
    this.dirtySinceAttempt = false;
  }

  commitFailed(attempt: SaveAttempt, error: StorageError): void {
    if (attempt.id !== this.lastAttemptId) return;
    this.inFlight = null;
    this.error = error;
    this.dirty = true;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  status(): SaveStatus {
    const revision = this.committedRevision;
    if (this.error) return { kind: "failed", revision, error: this.error };
    if (this.inFlight !== null) return { kind: "saving", revision };
    return this.dirty ? { kind: "unsaved", revision } : { kind: "saved", revision };
  }
}
