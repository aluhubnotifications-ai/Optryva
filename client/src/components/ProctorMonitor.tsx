import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Lock, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ProctorViolation =
  | 'permission_denied'
  | 'second_person'
  | 'left_frame'
  | 'head_down'
  | 'excessive_movement'
  | 'noise'
  | 'tab_switch'
  | 'left_fullscreen'
  | 'screen_denied'
  | 'screen_left'

export const VIOLATION_LABEL: Record<ProctorViolation, string> = {
  permission_denied: "Camera/microphone permission is required to take this test.",
  second_person: 'Another person was detected in the frame.',
  left_frame: 'Your face left the camera frame.',
  head_down: 'You looked down / away from the camera.',
  excessive_movement: 'Excessive movement was detected.',
  noise: 'Loud noise was detected.',
  tab_switch: 'You left the test window.',
  left_fullscreen: 'You exited fullscreen during the test.',
  screen_denied: 'Screen sharing is required to take this test.',
  screen_left: 'You stopped sharing your screen.',
}

const TICK_MS = 300
const SECOND_PERSON_MS = 600
const NO_FACE_MS = 1500
const HEAD_DOWN_MS = 1500
const MOTION_MS = 2000
const NOISE_MS = 1200
// Mean absolute per-pixel diff on a 32x24 grayscale frame (0..255). Small motions
// (breathing, slight shifts) stay well under this; only sustained large motion trips it.
const MOTION_THRESHOLD = 12
// Web Audio RMS (0..1). Normal room silence is ~0.01; speech is 0.1–0.3.
const NOISE_THRESHOLD = 0.15

/**
 * Privacy-preserving proctor: the webcam, mic, and screen share are analysed
 * LIVE in the browser by a free model (TensorFlow.js / BlazeFace). Nothing is
 * recorded and nothing is sent anywhere — it only watches for integrity
 * violations and calls `onViolation` so the host can cancel the test. Cancels
 * on: a second person, the candidate leaving frame, sustained loud noise,
 * abnormal movement, leaving/switching the tab, or denying/stopping the camera,
 * mic, or screen share.
 */
export function ProctorMonitor({ active, onViolation }: { active: boolean; onViolation: (reason: ProctorViolation) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null) // self-view camera
  const screenRef = useRef<HTMLVideoElement>(null) // live screen share
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const runningRef = useRef(false)
  const firedRef = useRef(false)
  const lastGrayRef = useRef<Uint8ClampedArray | null>(null)
  const lastWarnedRef = useRef<string | null>(null)
  const [status, setStatus] = useState<string>('Starting proctor…')
  const [warning, setWarning] = useState<string | null>(null)
  const onViolationRef = useRef(onViolation)
  onViolationRef.current = onViolation

  useEffect(() => {
    if (!active) return
    let cancelled = false
    firedRef.current = false
    lastGrayRef.current = null

    // Leaving the tab/window, or stopping the screen share, is treated as
    // walking away — cancel immediately.
    function onLeave() {
      if (runningRef.current) violate('tab_switch')
    }

    async function start() {
      try {
        const camera = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240 },
          audio: true,
        })
        if (cancelled) {
          camera.getTracks().forEach((t) => t.stop())
          return
        }
        cameraStreamRef.current = camera
        if (videoRef.current) {
          videoRef.current.srcObject = camera
          await videoRef.current.play().catch(() => {})
        }

        // Screen share is required and watched live (never recorded). If the
        // candidate refuses, the test can't start.
        let screen: MediaStream | null = null
        try {
          screen = await navigator.mediaDevices.getDisplayMedia({ video: true })
        } catch {
          if (!cancelled) return violate('screen_denied')
        }
        if (cancelled) {
          screen?.getTracks().forEach((t) => t.stop())
          return
        }
        if (screen) {
          screenStreamRef.current = screen
          if (screenRef.current) {
            screenRef.current.srcObject = screen
            await screenRef.current.play().catch(() => {})
          }
          screen.getVideoTracks().forEach((track) => {
            track.addEventListener('ended', () => {
              if (runningRef.current) violate('screen_left')
            })
          })
        }

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
        const audioCtx = new AudioCtx()
        audioCtxRef.current = audioCtx
        // Short audible alert used when a non-fatal warning appears.
        function beep() {
          try {
            const osc = audioCtx.createOscillator()
            const gain = audioCtx.createGain()
            osc.type = 'sine'
            osc.frequency.value = 880
            osc.connect(gain)
            gain.connect(audioCtx.destination)
            const t = audioCtx.currentTime
            gain.gain.setValueAtTime(0.0001, t)
            gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
            osc.start(t)
            osc.stop(t + 0.3)
          } catch { /* ignore */ }
        }
        const source = audioCtx.createMediaStreamSource(camera)
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 512
        source.connect(analyser)
        const audioBuf = new Uint8Array(analyser.fftSize)

        setStatus('Loading detector…')
        const tf: any = await import('@tensorflow/tfjs')
        await tf.ready()
        const blazeface: any = await import('@tensorflow-models/blazeface')
        const model = await blazeface.load()
        if (cancelled) return
        setStatus('Proctoring active')

        window.addEventListener('blur', onLeave)
        document.addEventListener('visibilitychange', onLeave)

        // Grace counters (in ticks) so brief glitches don't cancel a legitimate attempt.
        let secondPerson = 0
        let noFace = 0
        let headDown = 0
        let motion = 0
        let noise = 0
        const motionTicks = Math.round(MOTION_MS / TICK_MS)
        const noiseTicks = Math.round(NOISE_MS / TICK_MS)
        const secondTicks = Math.round(SECOND_PERSON_MS / TICK_MS)
        const noFaceTicks = Math.round(NO_FACE_MS / TICK_MS)
        const headDownTicks = Math.round(HEAD_DOWN_MS / TICK_MS)

        const canvas = canvasRef.current!
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!

        async function tick() {
          if (!runningRef.current || firedRef.current) return
          const video = videoRef.current
          if (!video || video.videoWidth === 0) {
            schedule()
            return
          }
          // --- Faces + head pose ---
          let faceCount = 0
          let headDownNow = false
          try {
            const preds = await model.estimateFaces(video, false)
            faceCount = preds.length
            if (preds.length) {
              // A face sitting low in the frame (normY > ~0.62) means the
              // candidate is looking down / away — a common cheating tell.
              const f = preds[0]
              const centerY = (f.topLeft[1] + f.bottomRight[1]) / 2
              const normY = centerY / (video.videoHeight || 240)
              if (normY > 0.62) headDownNow = true
            }
          } catch {
            faceCount = 0
          }
          // --- Motion (frame diff) ---
          canvas.width = 32
          canvas.height = 24
          ctx.drawImage(video, 0, 0, 32, 24)
          const data = ctx.getImageData(0, 0, 32, 24).data
          const gray = new Uint8ClampedArray(32 * 24)
          for (let i = 0; i < 32 * 24; i++) {
            const r = data[i * 4]
            const g = data[i * 4 + 1]
            const b = data[i * 4 + 2]
            gray[i] = (r * 0.299 + g * 0.587 + b * 0.114) | 0
          }
          let motionScore = 0
          if (lastGrayRef.current) {
            let s = 0
            for (let i = 0; i < gray.length; i++) s += Math.abs(gray[i] - lastGrayRef.current[i])
            motionScore = s / gray.length
          }
          lastGrayRef.current = gray

          // --- Audio ---
          let rms = 0
          try {
            analyser.getByteTimeDomainData(audioBuf)
            let sum = 0
            for (let i = 0; i < audioBuf.length; i++) {
              const x = (audioBuf[i] - 128) / 128
              sum += x * x
            }
            rms = Math.sqrt(sum / audioBuf.length)
          } catch {
            rms = 0
          }

          // --- Grace logic ---
          secondPerson = faceCount > 1 ? secondPerson + 1 : 0
          noFace = faceCount === 0 ? noFace + 1 : 0
          headDown = headDownNow ? headDown + 1 : 0
          motion = motionScore > MOTION_THRESHOLD ? motion + 1 : 0
          noise = rms > NOISE_THRESHOLD ? noise + 1 : 0

          if (secondPerson >= secondTicks) return violate('second_person')
          if (noFace >= noFaceTicks) return violate('left_frame')
          if (headDown >= headDownTicks) return violate('head_down')
          if (motion >= motionTicks) return violate('excessive_movement')
          if (noise >= noiseTicks) return violate('noise')

          // Non-fatal warnings (don't cancel, just guide + beep once per warning).
          let warn: string | null = null
          if (faceCount === 0) warn = 'Keep your face in the camera frame.'
          else if (headDownNow) warn = 'Keep your head up and face the camera.'
          else if (motionScore > MOTION_THRESHOLD) warn = 'Please stay still.'
          setWarning(warn)
          if (warn && !lastWarnedRef.current) beep()
          lastWarnedRef.current = warn

          schedule()
        }

        function schedule() {
          if (!runningRef.current) return
          setTimeout(() => void tick(), TICK_MS)
        }

        runningRef.current = true
        schedule()
      } catch {
        if (!cancelled) violate('permission_denied')
      }
    }

    function violate(reason: ProctorViolation) {
      if (firedRef.current) return
      firedRef.current = true
      runningRef.current = false
      cleanup()
      onViolationRef.current(reason)
    }

    function cleanup() {
      window.removeEventListener('blur', onLeave)
      document.removeEventListener('visibilitychange', onLeave)
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop())
      cameraStreamRef.current = null
      screenStreamRef.current?.getTracks().forEach((t) => t.stop())
      screenStreamRef.current = null
      audioCtxRef.current?.close().catch(() => {})
      audioCtxRef.current = null
      lastGrayRef.current = null
    }

    runningRef.current = true
    void start()

    return () => {
      cancelled = true
      runningRef.current = false
      cleanup()
    }
  }, [active])

  const ready = status === 'Proctoring active'
  const message = !ready
    ? 'Starting proctor… allow camera, mic & screen share'
    : warning ?? 'Keep your head centered in the frame'

  if (!active) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      <div className="absolute right-4 top-4 flex flex-col items-end gap-2">
        <div className={cn('flex items-center gap-1 rounded-full bg-black/75 px-3 py-1 text-xs font-medium text-white', !ready && 'opacity-80')}>
          <ShieldCheck className="h-3.5 w-3.5 text-success" /> {ready ? 'Proctoring live' : 'Starting…'}
        </div>
        {/* Self-view so the candidate can see themselves (positioned up). */}
        <div className={cn('overflow-hidden rounded-xl border-2 bg-black shadow-lg', warning ? 'border-danger' : 'border-primary/70')}>
          <video ref={videoRef} autoPlay muted playsInline className="h-52 w-72 object-cover" />
        </div>
        {/* Live screen share (monitored, never recorded). */}
        <div className="overflow-hidden rounded-xl border-2 border-accent/60 bg-black shadow-lg">
          <video ref={screenRef} autoPlay muted playsInline className="h-32 w-72 object-cover" />
        </div>
        <div className={cn('max-w-xs rounded-lg px-4 py-2 text-center text-lg font-semibold shadow', warning ? 'bg-danger text-white' : 'bg-primary/95 text-primary-foreground')}>
          {message}
        </div>
        <div className="flex items-center gap-1 rounded-full bg-black/75 px-3 py-1 text-xs font-medium text-white">
          <Lock className="h-3.5 w-3.5" /> Screen locked — leaving the tab cancels the test
        </div>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
