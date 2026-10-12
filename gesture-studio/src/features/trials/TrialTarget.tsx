import type { LayoutDefinition } from "../../domain/layout";

/** Marks the prompted target, positioned from the same layout used for hit testing. */
export function TrialTarget({ layout, targetId }: { layout: LayoutDefinition; targetId: string }) {
  const t = layout.targets.find((x) => x.id === targetId);
  if (!t) return null;
  return (
    <div
      className="trial-target"
      aria-hidden="true"
      style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%`, width: `${t.w * 100}%`, height: `${t.h * 100}%` }}
    >
      <span className="trial-target__label">Target</span>
    </div>
  );
}
