import { useEffect, useRef } from "react";
import type { HandControl } from "../../app/handControl";
import type { HandRole } from "../../domain/events";
import type { LayoutDefinition } from "../../domain/layout";

/**
 * Hand cursor ring and silent hover outline for one lane, positioned from the
 * same LayoutDefinition used for hit testing. Updated per frame through refs,
 * never through React state.
 */
export function HandOverlay({ handControl, hand, layout }: { handControl: HandControl; hand: HandRole; layout: LayoutDefinition }) {
  const cursor = useRef<HTMLDivElement>(null);
  const outline = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let raf = 0;
    let latest: Parameters<Parameters<HandControl["onHands"]>[0]>[0] = null;
    const apply = () => {
      raf = 0;
      const c = cursor.current;
      const o = outline.current;
      const msg = hint.current;
      if (!c || !o || !msg) return;
      const view = latest?.[hand] ?? null;
      const visible = view?.cursor && view.status === "tracking";
      c.hidden = !visible;
      if (visible && view.cursor) {
        c.style.left = `${Math.min(1, Math.max(0, view.cursor.x)) * 100}%`;
        c.style.top = `${Math.min(1, Math.max(0, view.cursor.y)) * 100}%`;
        c.classList.toggle("is-pinched", view.state === "held");
      }
      const targetId = view?.state === "held" ? null : view?.hoverTargetId ?? null;
      const target = targetId ? layout.targets.find((t) => t.id === targetId) : undefined;
      o.hidden = !target || view?.state === "disarmed" || view?.state === "resting";
      if (target) {
        o.style.left = `${target.x * 100}%`;
        o.style.top = `${target.y * 100}%`;
        o.style.width = `${target.w * 100}%`;
        o.style.height = `${target.h * 100}%`;
      }
      const side = hand === "left" ? "left" : "right";
      msg.textContent =
        !latest ? "" :
        view?.status === "ambiguous" ? "Hands overlap. Move them apart, then open both hands to resume." :
        view?.state === "disarmed" ? `Open your ${side} hand to resume.` : "";
    };
    const unsubscribe = handControl.onHands((v) => {
      latest = v;
      if (!raf) raf = requestAnimationFrame(apply);
    });
    return () => {
      unsubscribe();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [handControl, hand, layout]);

  return (
    <>
      <div className="hover-outline" ref={outline} hidden aria-hidden="true" />
      <div className={`hand-cursor hand-cursor--${hand} lane-cursor`} ref={cursor} hidden aria-hidden="true">
        <span>{hand === "left" ? "L" : "R"}</span>
      </div>
      <p className="lane-hint" ref={hint} aria-hidden="true" />
    </>
  );
}
