// Tiny Web Audio sound effects — no asset files needed. AudioContext is created
// lazily on first use (after a user gesture, so browsers allow playback).

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!ctx) ctx = new Ctor()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', peak = 0.06) {
  const c = getCtx()
  if (!c) return
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.value = freq
  osc.connect(gain)
  gain.connect(c.destination)
  const t = c.currentTime + start
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.linearRampToValueAtTime(peak, t + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

/** Soft tick when advancing to the next onboarding step. */
export function playStep() {
  tone(540, 0, 0.12, 'triangle', 0.04)
}

/** Celebratory arpeggio (C5–E5–G5–C6) when onboarding is completed. */
export function playSuccess() {
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((f, i) => tone(f, i * 0.1, 0.28, 'triangle', 0.07))
}
