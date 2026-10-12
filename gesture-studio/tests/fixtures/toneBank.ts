import type { InstrumentVoices } from "../../src/runtime/audio/instrument";

/** Test instrument: a looped 440 Hz sine, pitched by playback rate. Exact and measurable. */
export function createToneBank(ctx: BaseAudioContext): InstrumentVoices {
  const length = ctx.sampleRate; // one second, an integer number of 440 Hz cycles at 48 kHz
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.sin((2 * Math.PI * 440 * i) / ctx.sampleRate);
  return {
    id: "test-tone",
    label: "Test tone",
    releaseTauSec: 0.08,
    layers: (note) => [{ buffer, playbackRate: 2 ** ((note - 69) / 12), offsetSec: 0, gain: 1, loop: true }],
  };
}
