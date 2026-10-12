import { useEffect } from "react";
import type { SessionController } from "../../app/sessionController";
import type { HandRole } from "../../domain/events";
import { isTypingTarget, targetForKey } from "./keyboardMap";

/**
 * Global conventional input. Escape always stops all audio first. A lane
 * pressed by one key is released only by that same key, so pressing a second
 * key for the same hand cannot release the first note. Focus loss releases all.
 */
export function useKeyboardInput(session: SessionController, onOctave: (delta: -1 | 1) => void, stopEverything: () => void): void {
  useEffect(() => {
    const heldKey: Record<HandRole, string | null> = { left: null, right: null };

    const releaseAll = () => {
      for (const hand of ["left", "right"] as const) {
        if (heldKey[hand] !== null) {
          heldKey[hand] = null;
          session.release(hand, "keyboard");
        }
      }
      session.setSustain(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        heldKey.left = null;
        heldKey.right = null;
        stopEverything();
        return; // Overlays may still close on the same key afterwards.
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.code === "ShiftLeft") {
        if (!e.repeat) session.setSustain(true);
        return;
      }
      if (e.code === "BracketLeft" || e.code === "BracketRight") {
        if (!e.repeat) onOctave(e.code === "BracketLeft" ? -1 : 1);
        e.preventDefault();
        return;
      }
      const mapped = targetForKey(e.code);
      if (!mapped) return;
      e.preventDefault();
      if (e.repeat || heldKey[mapped.hand] !== null) return;
      heldKey[mapped.hand] = e.code;
      session.press(mapped.hand, mapped.targetId, "keyboard");
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "ShiftLeft") {
        session.setSustain(false);
        return;
      }
      for (const hand of ["left", "right"] as const) {
        if (heldKey[hand] === e.code) {
          heldKey[hand] = null;
          session.release(hand, "keyboard");
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", releaseAll);
      releaseAll();
    };
  }, [session, onOctave, stopEverything]);
}
