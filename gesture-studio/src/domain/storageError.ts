export type StorageErrorCode =
  | "unavailable"
  | "quota-exceeded"
  | "transaction-failed"
  | "conflict"
  | "not-found"
  | "invalid-record"
  | "newer-schema"
  | "locked";

/** Storage failures carry a code and user-facing text; callers attach a recovery action. */
export interface StorageError {
  code: StorageErrorCode;
  message: string;
}
