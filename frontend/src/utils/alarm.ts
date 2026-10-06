import { useEffect, useRef, useState } from "react";

const BEEP_FREQUENCY_HZ = 880;
const BEEP_DURATION_S = 0.18;
const BEEP_GAP_S = 0.12;
const BEEP_VOLUME = 0.25;
const ROUND_INTERVAL_MS = 2000;

// Synthesised with the Web Audio API rather than an audio file, so the demo
// stays fully offline with no asset to ship.
function playBeep(ctx: AudioContext, startAt: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = BEEP_FREQUENCY_HZ;
  // Short attack/release ramps avoid audible clicks at the beep edges.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(BEEP_VOLUME, startAt + 0.01);
  gain.gain.setValueAtTime(BEEP_VOLUME, startAt + BEEP_DURATION_S - 0.02);
  gain.gain.linearRampToValueAtTime(0, startAt + BEEP_DURATION_S);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + BEEP_DURATION_S);
}

// One "beep~ beep~" round: two beeps separated by a short gap.
function playRound(ctx: AudioContext) {
  const t = ctx.currentTime;
  playBeep(ctx, t);
  playBeep(ctx, t + BEEP_DURATION_S + BEEP_GAP_S);
}

// Repeating supervisor alarm: plays a beep round every ROUND_INTERVAL_MS
// while `active` is true. Browsers block audio until the user interacts with
// the page, so sound only starts after `enable()` is called from a click.
export function useAlarm(active: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);

  function enable() {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    void ctxRef.current.resume();
    setEnabled(true);
  }

  const sounding = enabled && !muted && active;

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!sounding || !ctx) return;
    playRound(ctx);
    const interval = setInterval(() => playRound(ctx), ROUND_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sounding]);

  useEffect(() => () => void ctxRef.current?.close(), []);

  return { enabled, muted, sounding, enable, setMuted };
}
