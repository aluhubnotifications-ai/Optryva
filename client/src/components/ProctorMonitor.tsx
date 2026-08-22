import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ShieldCheck } from 'lucide-react'

export type ProctorViolation =
  | 'permission_denied'
  | 'second_person'
  | 'left_frame'
  | 'excessive_movement'
  | 'noise'

const TICK_MS = 300
const SECOND_PERSON_MS = 600
const NO_FACE_MS = 1500
const MOTION_MS = 2000
const NOISE_MS = 1200
// Mean absolute per-pixel diff on a 32x24 grayscale frame (0..255). Small motions
// (breathing, slight shifts) stay well under this; only sustained large motion trips it.
const MOTION_THRESHOLD = 12
// Web Audio RMS (0..1). Normal room silence is ~0.01; speech is 0.1–0.3.
const NOISE_THRESHOLD = 0.15

export const VIOLATION_LABEL: Record<ProctorViolation, string> = {
  permission_denied: "Camera/microphone permission is required to take this test.",
  second_person: 'Another person was detected in the frame.',
  left_frame: 'Your face left the camera frame.',
  excessive_movement: 'Excessive movement was detected.',
  noise: 'Loud noise was detected.',
}

/**
 * Privacy-preserving proctor: the webcam + mic feed is analysed locally in the
 * browser by a free model (TensorFlow.js / BlazeFace). Nothing is recorded and
 * nothing is sent anywhere — it only watches for integrity violations and calls
 * `onViolation` so the host can cancel the test. Cancels on: a second person,
 * the candidate leaving frame, sustained loud noise, or abnormal movement.
 */
export function ProctorMonitor({ active, onViolation }: { active: boolean; onViolation: (reason: ProctorViolation) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const runningRef = useRef(false)
  const firedRef = useRef(false)
  const lastGrayRef = useRef<Uint8ClampedArray | null>(null)
  const [status, setStatus] = useState<string>('Starting proctor…')
  const [warning, setWarning] = useState<string | null>(null)
  const onViolationRef = useRef(onViolation)
  onViolationRef.current = onViolation

  useEffect(() => {
    if (!active) return
    let cancelled = false
    firedRef.current = false
    lastGrayRef.current = null

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240 },
          audio: true,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
        const audioCtx = new AudioCtx()
        audioCtxRef.current = audioCtx
        const source = audioCtx.createMediaStreamSource(stream)
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

        // Grace counters (in ticks) so brief glitches don't cancel a legitimate attempt.
        let secondPerson = 0
        let noFace = 0
        let motion = 0
        let noise = 0
        const motionTicks = Math.round(MOTION_MS / TICK_MS)
        const noiseTicks = Math.round(NOISE_MS / TICK_MS)
        const secondTicks = Math.round(SECOND_PERSON_MS / TICK_MS)
        const noFaceTicks = Math.round(NO_FACE_MS / TICK_MS)

        const canvas = canvasRef.current!
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!

        async function tick() {
          if (!runningRef.current || firedRef.current) return
          const video = videoRef.current
          if (!video || video.videoWidth === 0) {
            schedule()
            return
          }
          // --- Faces ---
          let faceCount = 0
          try {
            const preds = await model.estimateFaces(video, false)
            faceCount = preds.length
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
          motion = motionScore > MOTION_THRESHOLD ? motion + 1 : 0
          noise = rms > NOISE_THRESHOLD ? noise + 1 : 0

          if (secondPerson >= secondTicks) return violate('second_person')
          if (noFace >= noFaceTicks) return violate('left_frame')
          if (motion >= motionTicks) return violate('excessive_movement')
          if (noise >= noiseTicks) return violate('noise')

          // Non-fatal warnings (don't cancel, just guide).
          if (faceCount === 0) setWarning('Keep your face in the camera frame.')
          else if (motionScore > MOTION_THRESHOLD) setWarning('Please stay still.')
          else setWarning(null)

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
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
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

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-2 text-xs">
      <video ref={videoRef} muted playsInline className="h-10 w-14 rounded-md bg-black object-cover" />
      <div className="flex-1">
        <p className="flex items-center gap-1 font-medium text-success">
          <ShieldCheck className="h-3.5 w-3.5" /> Proctoring active
        </p>
        <p className="text-muted-foreground">{warning ?? status}</p>
      </div>
      {warning && <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
