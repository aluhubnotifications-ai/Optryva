import { AlertTriangle, Camera, Mic, RefreshCw } from "lucide-react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/utils";

export interface EquipmentCheckHandle {
	release: () => void;
}

/** Live camera preview + microphone level meter shown BEFORE the test starts, so
 *  candidates can confirm their equipment works (and fix it) instead of failing
 *  mid-test. Nothing here is recorded — it's a local self-check only. */
const EquipmentCheck = forwardRef<EquipmentCheckHandle>(
	function EquipmentCheck(_, ref) {
		const videoRef = useRef<HTMLVideoElement>(null);
		const streamRef = useRef<MediaStream | null>(null);
		const audioCtxRef = useRef<AudioContext | null>(null);
		const rafRef = useRef<number | null>(null);
		const cancelledRef = useRef(false);
		const [state, setState] = useState<"checking" | "ok" | "denied">(
			"checking",
		);
		const [level, setLevel] = useState(0);

		const release = useCallback(() => {
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
			streamRef.current?.getTracks().forEach((t) => {
				t.stop();
			});
			streamRef.current = null;
			audioCtxRef.current?.close?.().catch(() => {});
			audioCtxRef.current = null;
		}, []);

		const run = useCallback(async () => {
			cancelledRef.current = false;
			release();
			setState("checking");
			setLevel(0);
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					video: true,
					audio: true,
				});
				if (cancelledRef.current) {
					stream.getTracks().forEach((t) => {
						t.stop();
					});
					return;
				}
				streamRef.current = stream;
				if (videoRef.current) {
					videoRef.current.srcObject = stream;
					await videoRef.current.play().catch(() => {});
				}
				const AC =
					window.AudioContext ||
					(window as Window & { webkitAudioContext?: typeof AudioContext })
						.webkitAudioContext;
				const ctx: AudioContext = new AC();
				audioCtxRef.current = ctx;
				const src = ctx.createMediaStreamSource(stream);
				const analyser = ctx.createAnalyser();
				analyser.fftSize = 256;
				src.connect(analyser);
				const buf = new Uint8Array(analyser.fftSize);
				const tick = () => {
					if (cancelledRef.current) return;
					analyser.getByteTimeDomainData(buf);
					let sum = 0;
					for (let i = 0; i < buf.length; i++) {
						const x = (buf[i] - 128) / 128;
						sum += x * x;
					}
					setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3));
					rafRef.current = requestAnimationFrame(tick);
				};
				rafRef.current = requestAnimationFrame(tick);
				setState("ok");
			} catch {
				if (!cancelledRef.current) setState("denied");
			}
		}, [release]);

		useImperativeHandle(ref, () => ({ release }), [release]);

		useEffect(() => {
			run();
			return () => {
				cancelledRef.current = true;
				release();
			};
		}, [run, release]);

		return (
			<div className="rounded-2xl border border-border bg-card p-4">
				<div className="flex flex-col gap-4 sm:flex-row">
					<div className="relative w-full overflow-hidden rounded-xl border border-border bg-black sm:w-64">
						<video
							ref={videoRef}
							autoPlay
							muted
							playsInline
							className="h-44 w-full object-cover"
						/>
						<div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">
							<Camera className="h-3.5 w-3.5" /> Camera preview
						</div>
						{state === "checking" && (
							<div className="absolute inset-x-2 bottom-2 rounded-md bg-black/60 px-2 py-1 text-center text-[11px] text-white">
								Requesting camera &amp; microphone…
							</div>
						)}
					</div>
					<div className="flex-1 space-y-3">
						<StatusRow
							ok={state === "ok"}
							icon={<Mic className="h-4 w-4" />}
							label="Microphone"
						/>
						<div>
							<div className="flex items-center justify-between text-xs text-muted-foreground">
								<span>Mic level</span>
								<span>{state === "ok" ? "Say something to test it" : "—"}</span>
							</div>
							<div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
								<div
									className={cn(
										"h-full rounded-full bg-accent transition-all",
										level > 0.6 && "bg-danger",
									)}
									style={{ width: `${Math.min(100, level * 100)}%` }}
								/>
							</div>
						</div>
						{state === "denied" && (
							<div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
								<AlertTriangle className="h-4 w-4 shrink-0" />
								<span>
									Camera &amp; microphone access was blocked. Enable them in
									your browser, then{" "}
									<button
										type="button"
										onClick={() => run()}
										className="inline-flex items-center gap-1 font-medium underline"
									>
										<RefreshCw className="h-3.5 w-3.5" /> retry
									</button>
									.
								</span>
							</div>
						)}
					</div>
				</div>
			</div>
		);
	},
);

function StatusRow({
	ok,
	icon,
	label,
}: {
	ok: boolean;
	icon: React.ReactNode;
	label: string;
}) {
	return (
		<div
			className={cn(
				"flex items-center gap-2 text-sm",
				ok ? "text-success" : "text-muted-foreground",
			)}
		>
			<span
				className={cn(
					"flex h-6 w-6 items-center justify-center rounded-full",
					ok ? "bg-success/15" : "bg-muted",
				)}
			>
				{icon}
			</span>
			{label}
			<span
				className={cn(
					"ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium",
					ok ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
				)}
			>
				{ok ? "Ready" : "Checking…"}
			</span>
		</div>
	);
}

export default EquipmentCheck;
