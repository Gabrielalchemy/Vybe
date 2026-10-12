import type { HandRole } from "../../domain/events";

/** DESIGN_SYSTEM.md §5. Physical key codes, so the map survives keyboard layouts. */
const MELODY_KEYS: Readonly<Record<string, number>> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6,
  KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
};

export function targetForKey(code: string): { hand: HandRole; targetId: string } | null {
  const pc = MELODY_KEYS[code];
  if (pc !== undefined) return { hand: "right", targetId: `melody-pc-${pc}` };
  const digit = /^Digit([1-8])$/.exec(code);
  if (digit) return { hand: "left", targetId: `chord-slot-${Number(digit[1]) - 1}` };
  return null;
}

export const KEY_LABEL_BY_TARGET: Readonly<Record<string, string>> = Object.fromEntries([
  ...Object.entries(MELODY_KEYS).map(([code, pc]) => [`melody-pc-${pc}`, code.slice(3)]),
  ...Array.from({ length: 8 }, (_, i) => [`chord-slot-${i}`, String(i + 1)]),
]);

/** Shortcuts never fire while typing or adjusting a form control. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return (el as HTMLInputElement).type !== "button" && (el as HTMLInputElement).type !== "checkbox";
  return el.closest("dialog") !== null;
}
