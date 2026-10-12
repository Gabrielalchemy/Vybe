import { useEffect, useState, useSyncExternalStore } from "react";
import type { AppRuntime } from "../../app/runtime";

const ms = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)} ms`);

/** Audio settings group: status, browser latency estimates and voice diagnostics. */
export function AudioSettings({ runtime, open }: { runtime: AppRuntime; open: boolean }) {
  const { audio } = runtime;
  const snap = useSyncExternalStore(
    (notify) => audio.subscribe(() => notify()),
    () => audio.snapshot(),
  );
  const [voices, setVoices] = useState({ active: 0, stolen: 0 });

  useEffect(() => {
    if (!open || snap.status !== "ready") return;
    const id = setInterval(() => setVoices({ active: audio.activeVoices(), stolen: audio.stolenVoices() }), 500);
    return () => clearInterval(id);
  }, [open, snap.status, audio]);

  return (
    <>
      <dl className="facts">
        <dt>Instrument</dt>
        <dd>{snap.status === "ready" ? `${snap.instrumentLabel}, ${Math.round(snap.decodedMb)} MB of samples` : snap.status === "loading" ? `Loading ${snap.loaded} of ${snap.total}` : "Not loaded"}</dd>
        <dt>Sample rate</dt>
        <dd className="data">{snap.sampleRate ? `${snap.sampleRate} Hz` : "—"}</dd>
        <dt>Output latency (browser estimate)</dt>
        <dd className="data">base {ms(snap.baseLatencyMs)} · output {ms(snap.outputLatencyMs)}</dd>
        <dt>Sounding voices</dt>
        <dd className="data">
          {voices.active} of 128{voices.stolen > 0 ? ` · ${voices.stolen} cut at the limit` : ""}
        </dd>
      </dl>
      <p className="muted">
        Latency figures come from the browser and do not include the speaker or a Bluetooth link. Measure the full pinch-to-sound time with the
        procedure in the Phase 4 notes. Use built-in speakers or wired output for that measurement.
      </p>
    </>
  );
}
