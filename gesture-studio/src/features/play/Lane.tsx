import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { SessionController, SessionSnapshot } from "../../app/sessionController";
import type { HandRole } from "../../domain/events";
import { minimumTargetSizeProblem, type LayoutDefinition, type LayoutTarget } from "../../domain/layout";
import { TargetFace } from "./TargetFace";
import { targetClassName } from "./targetClass";

export interface TargetView {
  /** Primary label, e.g. "C#" or "Cmaj9". */
  label: string;
  /** Exact pitches with octaves, or note name with octave. */
  detail: string;
  /** Accessible name including pitch, octave and availability. */
  accessibleName: string;
  available: boolean;
  empty?: boolean;
  shortcut?: string | undefined;
}

interface LaneProps {
  session: SessionController;
  snapshot: SessionSnapshot;
  hand: HandRole;
  title: string;
  layout: LayoutDefinition;
  describe: (target: LayoutTarget) => TargetView;
  onSizeProblem: (hand: HandRole, problem: string | null) => void;
}

/**
 * Renders a lane from its LayoutDefinition. Positions come from the same
 * normalized rectangles used for hit testing, so visible and hit geometry agree.
 */
export function Lane({ session, snapshot, hand, title, layout, describe, onSizeProblem }: LaneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pointerTarget = useRef<string | null>(null);
  const keyTarget = useRef<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      onSizeProblem(hand, minimumTargetSizeProblem(layout, { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hand, layout, onSizeProblem]);

  const lane = snapshot.lanes[hand];
  const sounding = new Map(snapshot.soundingTargets.filter((t) => t.hand === hand).map((t) => [t.targetId, t]));

  const press = (target: LayoutTarget, input: "pointer" | "keyboard") => {
    if (target.kind === "rest") session.rest(hand, input);
    else session.press(hand, target.id, input);
  };

  const onPointerDown = (target: LayoutTarget) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerTarget.current = target.id;
    press(target, "pointer");
  };
  const onPointerEnd = () => {
    if (pointerTarget.current === null) return;
    pointerTarget.current = null;
    session.release(hand, "pointer");
  };

  const onKeyDown = (target: LayoutTarget) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (e.repeat || keyTarget.current !== null) return;
    keyTarget.current = target.id;
    press(target, "keyboard");
  };
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (keyTarget.current === null) return;
    keyTarget.current = null;
    session.release(hand, "keyboard");
  };
  const onBlur = () => {
    if (keyTarget.current !== null) {
      keyTarget.current = null;
        session.release(hand, "keyboard");
    }
  };
  return (
    <section className={`lane lane--${layout.lane}`} aria-labelledby={`lane-title-${hand}`}>
      <h2 id={`lane-title-${hand}`} className="lane__title">
        <span className="lane__hand">{hand === "left" ? "Left" : "Right"}</span> · {title}
        <span className="lane__state">{laneStateLabel(lane.state)}</span>
      </h2>
      <div className="lane__surface" ref={ref}>
        {layout.targets.map((target) => {
          const view = target.kind === "rest" ? null : describe(target);
          const isHeld = lane.state === "held" && lane.heldTargetId === target.id;
          const pedal = !isHeld && sounding.get(target.id)?.sustained === true;
          const isResting = target.kind === "rest" && lane.resting;
          const flags = { held: isHeld, pedal, resting: isResting };
          const classes = targetClassName(target, view, flags);
          const label = target.kind === "rest" ? `Rest ${hand}` : view?.accessibleName;
          return (
            <button
              key={target.id}
              type="button"
              className={classes}
              data-target-id={target.id}
              style={{
                left: `${target.x * 100}%`,
                top: `${target.y * 100}%`,
                width: `${target.w * 100}%`,
                height: `${target.h * 100}%`,
              }}
              aria-label={label}
              aria-pressed={target.kind === "rest" ? undefined : isHeld}
              aria-disabled={view && !view.available ? true : undefined}
              onPointerDown={onPointerDown(target)}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onLostPointerCapture={onPointerEnd}
              onKeyDown={onKeyDown(target)}
              onKeyUp={onKeyUp}
              onBlur={onBlur}
              onContextMenu={(e) => e.preventDefault()}
            >
              <TargetFace kind={target.kind} hand={hand} view={view} flags={flags} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function laneStateLabel(state: SessionSnapshot["lanes"]["left"]["state"]): string {
  switch (state) {
    case "disarmed":
      return "Ready";
    case "open":
      return "Ready";
    case "held":
      return "Held";
    case "held-silent":
      return "Closed on a silent target";
  }
}
