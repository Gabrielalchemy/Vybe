import type { HandRole } from "../../domain/events";
import type { TargetKind } from "../../domain/layout";
import type { TargetView } from "./Lane";
import type { TargetFlags } from "./targetClass";


/** Inner content of a playing target. Shared by the lanes and the component showcase. */
export function TargetFace({ kind, hand, view, flags }: { kind: TargetKind; hand: HandRole; view: TargetView | null; flags: TargetFlags }) {
  if (kind === "rest") {
    return <span className="target__label">{flags.resting ? "Resting" : `Rest ${hand}`}</span>;
  }
  return (
    <>
      <span className="target__label">{view?.empty ? "Empty" : view?.label}</span>
      {view && !view.empty && <span className="target__detail">{view.detail}</span>}
      {view?.shortcut && <kbd className="target__key">{view.shortcut}</kbd>}
      {flags.blocked && (
        <span className="target__lock" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="16" height="16">
            <rect x="3" y="7" width="10" height="7" rx="1" fill="currentColor" />
            <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
      )}
      {flags.held && <span className="target__marker">Held</span>}
      {flags.pedal && <span className="target__marker target__marker--pedal">Pedal</span>}
      {view && !view.available && !view.empty && <span className="target__marker">Out of range</span>}
    </>
  );
}
