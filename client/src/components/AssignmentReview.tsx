import { ScoreRing } from "@/components/ScoreRing";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { Application, JobListing } from "@/types";

/** Resolve the assessment questions — either the explicit question list, or (for
 *  legacy rubric-only assignments) one synthetic essay question per criterion. */
export function getAssignmentQuestions(job: JobListing | null) {
	const assignment = job?.assignment;
	if (!assignment) return [];
	return assignment.questions?.length
		? assignment.questions
		: (assignment.rubric ?? []).map((c: any) => ({
				id: c.id,
				type: "essay",
				prompt: c.label,
				required: true,
			}));
}

function answerText(answer: string | string[] | undefined) {
	if (Array.isArray(answer)) return answer.length ? answer.join(", ") : "";
	if (!answer) return "";
	return String(answer);
}

const recTone = {
	advance: "success",
	consider: "warning",
	hold: "danger",
} as const;
const recLabel = {
	advance: "Advance",
	consider: "Consider",
	hold: "Hold",
} as const;

/** Read-only rendering of the candidate's submitted answers, with the AI's
 *  per-question feedback shown right beneath each answer (feedback near the
 *  question, not buried elsewhere). */
export function SubmittedAnswers({
	job,
	application,
}: {
	job: JobListing;
	application: Application;
}) {
	const questions = getAssignmentQuestions(job);
	const answers = application.assignment_answers ?? [];
	const feedback = application.assignment_ai_feedback?.perQuestion ?? [];
	if (!questions.length)
		return (
			<p className="text-sm text-muted-foreground">
				This assessment has no questions.
			</p>
		);
	return (
		<div className="space-y-3">
			{questions.map((q: any, i: number) => {
				const entry = answers.find(
					(e) => (e.question_id ?? e.criterion_id) === q.id,
				);
				const answer = entry?.answer;
				const fb = feedback.find((p) => p.id === q.id)?.feedback;
				const isChoice =
					q.type === "single_choice" ||
					q.type === "multiple_choice" ||
					q.type === "true_false";
				const selected = Array.isArray(answer)
					? answer.map(String)
					: answer
						? [String(answer)]
						: [];
				return (
					<div
						key={q.id ?? i}
						className="rounded-xl border border-border bg-card p-4"
					>
						<div className="flex items-start justify-between gap-3">
							<p className="text-sm font-medium">
								<span className="text-muted-foreground">{i + 1}.</span>{" "}
								{q.prompt}
							</p>
							{q.required && (
								<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
									Required
								</span>
							)}
						</div>

						{isChoice ? (
							<div className="mt-3 space-y-2">
								{(q.type === "true_false"
									? ["True", "False"]
									: (q.options ?? [])
								).map((opt: string) => {
									const sel = selected.includes(opt);
									return (
										<div
											key={opt}
											className={cn(
												"flex items-center justify-between rounded-lg border px-3 py-2 text-sm",
												sel
													? "border-primary bg-primary/10 text-foreground"
													: "border-border bg-muted/30 text-muted-foreground",
											)}
										>
											<span>{opt}</span>
											{sel && (
												<span className="text-xs font-medium text-primary">
													Your answer
												</span>
											)}
										</div>
									);
								})}
							</div>
						) : (
							<div className="mt-3">
								{(() => {
									const text = answerText(answer);
									const wc = text.trim()
										? text.trim().split(/\s+/).filter(Boolean).length
										: 0;
									const over = q.maxWords ? wc > q.maxWords : false;
									const under = q.minWords ? wc < q.minWords : false;
									return (
										<>
											<div
												className={cn(
													"min-h-[60px] whitespace-pre-wrap rounded-lg border border-border px-3 py-2 text-sm",
													text
														? "bg-muted/30"
														: "bg-muted/30 text-muted-foreground",
												)}
											>
												{text || "No answer submitted."}
											</div>
											{(q.minWords || q.maxWords) && (
												<p
													className={cn(
														"mt-1 text-xs",
														over || under
															? "text-danger"
															: "text-muted-foreground",
													)}
												>
													{wc} words{q.maxWords ? ` / ${q.maxWords} max` : ""}
													{q.minWords ? ` · ${q.minWords} min` : ""}
													{over ? " — too long" : under ? " — too short" : ""}
												</p>
											)}
										</>
									);
								})()}
							</div>
						)}

						{fb && (
							<div className="mt-3 rounded-lg border-l-2 border-accent/60 bg-accent/5 px-3 py-2 text-sm leading-relaxed text-muted-foreground">
								<span className="font-medium text-accent">Feedback: </span>
								{fb}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

/** Candidate-facing grade summary: a prominent score ring, a colour-coded
 *  recommendation tier, the employer note, and the overall AI rationale. */
export function GradeSummary({ application }: { application: Application }) {
	const score = application.assignment_score;
	const feedback = application.assignment_ai_feedback;
	const rec = application.ai_recommendation;

	if (score == null) {
		return (
			<div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
				<p className="font-medium">Results pending</p>
				<p className="mt-1 text-sm text-muted-foreground">
					Your answers have been received. The employer will review your
					assessment and the result will appear here.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-5 rounded-2xl border border-border bg-card p-5">
				<ScoreRing score={score} size={104} stroke={9} showLabel />
				<div className="min-w-0 flex-1">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Recommendation
					</p>
					<Badge
						tone={recTone[rec as keyof typeof recTone] ?? "default"}
						className="mt-1.5 capitalize"
					>
						{recLabel[rec as keyof typeof recLabel] ?? rec ?? "—"}
					</Badge>
					{application.decision_reason && (
						<p className="mt-2 text-sm text-muted-foreground">
							<span className="font-medium text-foreground">
								Employer note:{" "}
							</span>
							{application.decision_reason}
						</p>
					)}
				</div>
			</div>
			{feedback?.overall && (
				<div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
					{feedback.overall}
				</div>
			)}
		</div>
	);
}
