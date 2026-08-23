import {
	AlertTriangle,
	ClipboardCheck,
	Info,
	Lightbulb,
	Lock,
	ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import EquipmentCheck, {
	type EquipmentCheckHandle,
} from "@/components/EquipmentCheck";
import {
	ProctorMonitor,
	type ProctorViolation,
	VIOLATION_LABEL,
} from "@/components/ProctorMonitor";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/toast";
import { applicationsApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Application, JobListing } from "@/types";

const PROCTOR_RULES = [
	"Your camera and microphone are monitored live for the whole test. Nothing is recorded or sent anywhere.",
	"When the test starts you will be asked to allow camera & microphone. The test then locks into fullscreen (hiding your browser tabs) automatically.",
	"If a second person appears, you leave the camera frame, you look down/away, there is loud noise, or excessive movement, the test is cancelled.",
	"Switching tabs, minimizing, leaving the test window, or exiting fullscreen cancels the test immediately.",
	"Stopping the camera or microphone also cancels the test immediately.",
	"You have a limited number of attempts, set by the employer. Breaking the rules uses one up.",
];

function QuestionField({
	question,
	value,
	onChange,
}: {
	question: any;
	value?: string | string[];
	onChange: (value: string | string[]) => void;
}) {
	const choices = (question.options ?? []).filter(Boolean) as string[];
	const selected = Array.isArray(value)
		? value
		: typeof value === "string" && value
			? [value]
			: [];
	return (
		<div className="rounded-xl border border-border p-4">
			<div className="flex items-start justify-between gap-3">
				<p className="text-sm font-medium">{question.prompt}</p>
				{question.required && (
					<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
						Required
					</span>
				)}
			</div>
			{question.type === "essay" ? (
				<div className="mt-3">
					<textarea
						value={typeof value === "string" ? value : ""}
						onChange={(e) => onChange(e.target.value)}
						placeholder="Write your answer…"
						className="min-h-[100px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
					/>
					{(question.minWords || question.maxWords) &&
						(() => {
							const wc = (typeof value === "string" ? value : "")
								.trim()
								.split(/\s+/)
								.filter(Boolean).length;
							const over = question.maxWords ? wc > question.maxWords : false;
							const under = question.minWords ? wc < question.minWords : false;
							return (
								<p
									className={`mt-1 text-xs ${over || under ? "text-danger" : "text-muted-foreground"}`}
								>
									{wc} words
									{question.maxWords ? ` / ${question.maxWords} max` : ""}
									{question.minWords ? ` · ${question.minWords} min` : ""}
									{over ? " — too long" : under ? " — too short" : ""}
								</p>
							);
						})()}
				</div>
			) : (
				<div className="mt-3 space-y-2">
					{choices.map((choice) => (
						<label
							key={choice}
							className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm hover:border-accent"
						>
							<input
								type={
									question.type === "multiple_choice" ? "checkbox" : "radio"
								}
								name={question.id}
								checked={
									question.type === "multiple_choice"
										? selected.includes(choice)
										: value === choice
								}
								onChange={() =>
									question.type === "multiple_choice"
										? onChange(
												selected.includes(choice)
													? selected.filter((i: string) => i !== choice)
													: [...selected, choice],
											)
										: onChange(choice)
								}
								className="h-4 w-4 accent-primary"
							/>
							{choice}
						</label>
					))}
				</div>
			)}
		</div>
	);
}

function fmt(sec: number) {
	const m = Math.floor(sec / 60);
	const s = sec % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AssessmentRunner({
	job,
	application,
	onComplete,
	onClose,
}: {
	job: JobListing;
	application: Application;
	onComplete: (app: Application) => void;
	onClose: () => void;
}) {
	const { toast } = useToast();
	const assignment = job.assignment!;
	const questions = (
		assignment.questions?.length
			? assignment.questions
			: assignment.rubric.map((c) => ({
					id: c.id,
					type: "essay" as const,
					prompt: c.label,
					required: true,
				}))
	) as any[];
	const maxAttempts = assignment.max_attempts ?? 10;
	const durationMin = assignment.duration_minutes ?? 30;

	const [consentGiven, setConsentGiven] = useState(false);
	const [consentChecked, setConsentChecked] = useState(false);
	const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
	const [submitting, setSubmitting] = useState(false);
	const [proctorCancelled, setProctorCancelled] =
		useState<ProctorViolation | null>(null);
	const [proctorResult, setProctorResult] = useState<Application | null>(null);
	const [remaining, setRemaining] = useState(durationMin * 60);
	const [timeUp, setTimeUp] = useState(false);
	const startedAt = useRef<number>(0);
	const eqRef = useRef<EquipmentCheckHandle>(null);

	const proctoring = consentGiven && !proctorCancelled && !submitting;
	function handleProctorViolation(reason: ProctorViolation) {
		setProctorCancelled(reason);
		if (job?.id)
			applicationsApi
				.proctorCancel({ job_id: job.id, reason })
				.then(setProctorResult)
				.catch(() => {});
	}

	useEffect(() => {
		if (!consentGiven || proctorCancelled) return;
		startedAt.current = Date.now();
		setRemaining(durationMin * 60);
		setTimeUp(false);
		const iv = setInterval(() => {
			setRemaining((s) => {
				if (s <= 1) {
					clearInterval(iv);
					setTimeUp(true);
					return 0;
				}
				return s - 1;
			});
		}, 1000);
		return () => clearInterval(iv);
	}, [consentGiven, proctorCancelled, durationMin]);

	async function submitTest() {
		setSubmitting(true);
		const duration_seconds = Math.round(
			(Date.now() - startedAt.current) / 1000,
		);
		const assignment_answers = questions.map((q) => ({
			question_id: q.id,
			answer: answers[q.id] ?? "",
		}));
		try {
			const updated = await applicationsApi.submitAssignment(application.id, {
				assignment_answers,
				duration_seconds,
			});
			toast({ title: "Test submitted", tone: "success" });
			onComplete(updated);
		} catch (e) {
			toast({
				title: "Could not submit test",
				description: e instanceof Error ? e.message : undefined,
				tone: "error",
			});
		} finally {
			setSubmitting(false);
		}
	}

	if (proctorCancelled) {
		const used = proctorResult?.attempts ?? 1;
		const canRetry = used < maxAttempts;
		return (
			<div className="space-y-4 rounded-2xl border border-danger/30 bg-danger/5 p-6 text-center">
				<AlertTriangle className="mx-auto h-8 w-8 text-danger" />
				<p className="text-lg font-semibold">
					{canRetry
						? "Test cancelled — you can retry"
						: "Test cancelled — no attempts left"}
				</p>
				<p className="mt-1 text-sm text-muted-foreground">
					{VIOLATION_LABEL[proctorCancelled]}
				</p>
				<p className="text-xs text-muted-foreground">
					{canRetry
						? `Attempt ${used} of ${maxAttempts}. You can take the test again.`
						: `You've used all ${maxAttempts} attempts for this test.`}
					{timeUp ? " The time limit was also reached." : ""}
				</p>
				{canRetry ? (
					<Button
						className="mt-3"
						onClick={() => {
							setProctorCancelled(null);
							setConsentGiven(false);
							setConsentChecked(false);
							setAnswers({});
						}}
					>
						Try again
					</Button>
				) : (
					<Button className="mt-3" onClick={onClose}>
						Close
					</Button>
				)}
			</div>
		);
	}

	if (!consentGiven) {
		return (
			<div className="space-y-4">
				<div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5 p-5">
					<div className="flex items-center gap-2 text-primary">
						<ShieldCheck className="h-5 w-5" />
						<p className="font-semibold">Before you start your assessment</p>
					</div>
					<div className="mt-4 grid gap-4 lg:grid-cols-2">
						<EquipmentCheck ref={eqRef} />
						<div className="space-y-3">
							<div className="rounded-xl border border-border bg-card p-4">
								<div className="flex items-center gap-2 font-medium">
									<Info className="h-4 w-4 text-accent" /> Why this task?
								</div>
								<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
									This short, practical task is part of a fair, job‑relevant
									assessment for {job.title}. Your camera and microphone are
									analysed live in your browser only — nothing is recorded and
									nothing is sent anywhere. The point is simply to confirm it's
									you, working on your own, for the whole test.
								</p>
							</div>
							<div className="rounded-xl border border-border bg-card p-4">
								<div className="flex items-center gap-2 font-medium">
									<Lightbulb className="h-4 w-4 text-accent" /> Before you begin
								</div>
								<ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
									<li>
										Find a quiet, well‑lit room and close other apps and tabs.
									</li>
									<li>
										Use a laptop or desktop with a webcam and a stable
										connection.
									</li>
									<li>Keep your phone out of reach — you won't need it.</li>
									<li>
										You'll be asked to allow camera &amp; microphone, then the
										test locks into fullscreen.
									</li>
								</ul>
							</div>
						</div>
					</div>
					<ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
						{PROCTOR_RULES.map((rule, i) => (
							<li key={i}>{rule}</li>
						))}
					</ul>
					<label className="mt-4 flex items-start gap-2 text-sm">
						<input
							type="checkbox"
							checked={consentChecked}
							onChange={(e) => setConsentChecked(e.target.checked)}
							className="mt-0.5 h-4 w-4 accent-primary"
						/>
						<span>
							I agree to be monitored by camera and microphone for the duration
							of this test, and I understand the test will be cancelled if these
							rules are broken.
						</span>
					</label>
					<Button
						className="mt-4"
						disabled={!consentChecked}
						onClick={() => {
							eqRef.current?.release();
							setConsentGiven(true);
							document.documentElement.requestFullscreen?.().catch(() => {});
						}}
					>
						Start test
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<ProctorMonitor
				active={proctoring}
				onViolation={handleProctorViolation}
			/>
			<div className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex items-start gap-3">
						<ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
						<div className="min-w-0">
							<p className="font-semibold">{assignment.title}</p>
							<p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
								{assignment.prompt}
							</p>
						</div>
					</div>
					<div
						className={cn(
							"flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-sm font-medium",
							timeUp
								? "bg-danger/15 text-danger"
								: "bg-muted text-muted-foreground",
						)}
					>
						<Lock className="h-3.5 w-3.5" /> {fmt(remaining)}
						{timeUp ? " — time up, submit now" : ` / ${durationMin}m`}
					</div>
				</div>
				<div className="mt-4 space-y-3">
					{questions.map((question) => (
						<QuestionField
							key={question.id}
							question={question}
							value={answers[question.id]}
							onChange={(value) =>
								setAnswers((c) => ({ ...c, [question.id]: value }))
							}
						/>
					))}
				</div>
				<Button
					className="mt-4 w-full"
					onClick={submitTest}
					loading={submitting}
				>
					Submit test
				</Button>
			</div>
		</div>
	);
}
