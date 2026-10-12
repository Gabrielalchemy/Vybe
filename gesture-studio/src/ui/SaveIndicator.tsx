import type { SaveStatus } from "../domain/saveStatus";

const TEXT: Record<SaveStatus["kind"], string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  failed: "Not saved",
};

/** "Saved" appears only for a committed revision (SaveTracker enforces this). */
export function SaveIndicator({ status }: { status: SaveStatus }) {
  return (
    <span className={`save-indicator save-indicator--${status.kind}`} role="status">
      {status.kind === "failed" && <span aria-hidden="true">✕ </span>}
      {TEXT[status.kind]}
    </span>
  );
}
