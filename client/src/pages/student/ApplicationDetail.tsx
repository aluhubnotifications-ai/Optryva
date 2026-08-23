import {
	AlertTriangle,
	ArrowLeft,
	CalendarDays,
	CheckCircle2,
	ClipboardCheck,
	Clock,
	FileText,
	LayoutDashboard,
	MessageSquare,
	Repeat,
	Sparkles,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AIResearchPanel } from "@/components/AIResearchPanel";
import { AppProgressSteps } from "@/components/AppProgressSteps";
import { GradeSummary, SubmittedAnswers } from "@/components/AssignmentReview";
import { DocumentList } from "@/components/DocumentList";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Avatar, Badge, Card, CardBody } from "@/components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/toast";
import { applicationsApi, jobsApi, profilesApi } from "@/lib/api";
import { useCurrentUser } from "@/lib/store";
import { formatDate, timeAgo } from "@/lib/utils";
import type { Application, JobListing, Profile } from "@/types";

const statusTone = {
	draft: "outline",
	pending: "default",
	reviewed: "primary",
	shortlisted: "accent",
	hired: "success",
	rejected: "danger",
	cancelled: "danger",
} as const;

export default function ApplicationDetail() {
	const { id } = useParams();
	const navigate = useNavigate();
	const user = useCurrentUser()!;
	const { toast } = useToast();
	const [app, setApp] = useState<Application | null>(null);
	const [job, setJob] = useState<JobListing | null>(null);
	const [company, setCompany] = useState<Profile | null>(null);
	const [loading, setLoading] = useState(true);
	const [research, setResearch] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [tab, setTab] = useState("overview");

	useEffect(() => {
		(async () => {
			if (!id) return;
			const a = await applicationsApi.get(id);
			if (!a) {
				setLoading(false);
				return;
			}
			const j = await jobsApi.get(a.job_id);
			const c = j ? await profilesApi.get(j.company_id) : null;
			setApp(a);
			setJob(j);
			setCompany(c);
			setLoading(false);
		})();
	}, [id]);

	if (loading)
		return (
			<p className="py-20 text-center text-sm text-muted-foreground">
				Loading…
			</p>
		);
	if (!app || !job) {
		return (
			<div className="py-20 text-center">
				<p className="font-medium">Application not found.</p>
				<Link to="/app/applications">
					<Button variant="outline" className="mt-4">
						Back to applications
					</Button>
				</Link>
			</div>
		);
	}

	const brand = job.original_company_name || company?.company_name;

	const when = job.assignment?.required_when ?? "after_application";
	const eligible = when === "after_application" || app.status === "shortlisted";
	const maxAttempts = job.assignment?.max_attempts ?? 10;
	const exhausted = (app.attempts ?? 0) >= maxAttempts;
	const canTake =
		!!job.assignment &&
		app.assignment_status !== "submitted" &&
		eligible &&
		!exhausted;
	const deadline =
		app.test_eligible_at && job.assignment?.window_days
			? new Date(
					new Date(app.test_eligible_at).getTime() +
						job.assignment.window_days * 86400000,
				)
			: null;

	const assessmentState = !job.assignment
		? "Not required"
		: app.assignment_status === "submitted"
			? app.assignment_late
				? "Submitted (late)"
				: "Submitted"
			: eligible
				? exhausted
					? "No attempts left"
					: "Ready to take"
				: "Shortlist to unlock";

	const facts = [
		{ icon: CalendarDays, label: "Applied", value: formatDate(app.created_at) },
		{ icon: ClipboardCheck, label: "Assessment", value: assessmentState },
		...(deadline
			? [
					{
						icon: Clock,
						label: "Due by",
						value: formatDate(deadline.toISOString()),
					},
				]
			: []),
		{
			icon: Repeat,
			label: "Attempts",
			value: `${app.attempts ?? 0} / ${maxAttempts}`,
		},
	];

	async function withdraw() {
		await applicationsApi.remove(app!.id);
		toast({ title: "Application withdrawn", tone: "info" });
		navigate("/app/applications");
	}

	return (
		<div className="space-y-5">
			<Link
				to="/app/applications"
				className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft className="h-4 w-4" /> Back to applications
			</Link>

			{/* Hero */}
			<Card className="overflow-hidden">
				<CardBody>
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div className="flex gap-4">
							<Link
								to={`/app/companies/${job.company_id}`}
								className="shrink-0"
								title={`View ${brand}`}
							>
								<Avatar
									name={brand}
									src={job.original_company_logo_url || company?.avatar_url}
									size={56}
									className="rounded-2xl"
								/>
							</Link>
							<div>
								<Link
									to={`/app/jobs?job=${job.id}`}
									className="text-2xl font-bold tracking-tight hover:text-primary"
								>
									{job.title}
								</Link>
								<p className="mt-0.5 text-sm text-muted-foreground">
									<Link
										to={`/app/companies/${job.company_id}`}
										className="hover:text-primary hover:underline"
									>
										{brand}
									</Link>{" "}
									· {job.location}
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									Applied {formatDate(app.created_at)}
								</p>
							</div>
						</div>
						<Badge
							tone={statusTone[app.status]}
							className="shrink-0 capitalize px-3 py-1 text-sm"
						>
							{app.status === "hired" ? "Accepted" : app.status}
						</Badge>
					</div>

					{/* Key facts — at-a-glance summary */}
					<div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
						{facts.map((f) => (
							<div
								key={f.label}
								className="rounded-xl border border-border bg-muted/30 p-3"
							>
								<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
									<f.icon className="h-3.5 w-3.5" /> {f.label}
								</div>
								<p className="mt-1 text-sm font-semibold">{f.value}</p>
							</div>
						))}
					</div>

					<div className="mt-5 border-t border-border pt-5">
						<AppProgressSteps status={app.status} />
					</div>
				</CardBody>
			</Card>

			{/* Priority: the single most important next action */}
			{canTake ? (
				<Card className="border-primary/30 bg-primary/5">
					<CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex items-start gap-3">
							<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
								<ClipboardCheck className="h-5 w-5" />
							</div>
							<div>
								<p className="font-semibold">Your assessment is ready</p>
								<p className="text-sm text-muted-foreground">
									Complete it in one sitting — you'll need your camera and
									microphone.
								</p>
							</div>
						</div>
						<Button
							className="shrink-0 gap-1.5"
							onClick={() => navigate(`/app/applications/${app.id}/assessment`)}
						>
							<ClipboardCheck className="h-4 w-4" /> Take assessment
						</Button>
					</CardBody>
				</Card>
			) : job.assignment && app.assignment_status === "submitted" ? (
				app.assignment_score != null ? (
					<Card className="border-success/30 bg-success/5">
						<CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="flex items-start gap-3">
								<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success">
									<CheckCircle2 className="h-5 w-5" />
								</div>
								<div>
									<p className="font-semibold">Assessment reviewed</p>
									<p className="text-sm text-muted-foreground">
										The employer has reviewed your assessment. See your results.
									</p>
								</div>
							</div>
							<Button
								variant="outline"
								className="shrink-0 gap-1.5"
								onClick={() => setTab("results")}
							>
								<Sparkles className="h-4 w-4" /> View results
							</Button>
						</CardBody>
					</Card>
				) : (
					<Card className="border-success/30 bg-success/5">
						<CardBody className="flex items-start gap-3">
							<CheckCircle2 className="h-6 w-6 shrink-0 text-success" />
							<div>
								<p className="font-semibold">Assessment submitted</p>
								<p className="text-sm text-muted-foreground">
									Your answers are in. Results will appear here once the
									employer reviews them.
								</p>
							</div>
						</CardBody>
					</Card>
				)
			) : job.assignment && eligible && exhausted ? (
				<Card className="border-danger/30 bg-danger/5">
					<CardBody className="flex items-start gap-3">
						<AlertTriangle className="h-6 w-6 shrink-0 text-danger" />
						<div>
							<p className="font-semibold">No assessment attempts left</p>
							<p className="text-sm text-muted-foreground">
								You've used all {maxAttempts} attempts. Message the employer if
								you think this was a mistake.
							</p>
						</div>
					</CardBody>
				</Card>
			) : job.assignment && !eligible ? (
				<Card className="border-border bg-muted/30">
					<CardBody className="flex items-start gap-3">
						<Clock className="h-6 w-6 shrink-0 text-muted-foreground" />
						<div>
							<p className="font-semibold">Assessment unlocks later</p>
							<p className="text-sm text-muted-foreground">
								This assessment opens once you're shortlisted for the role.
							</p>
						</div>
					</CardBody>
				</Card>
			) : (
				<Card className="border-success/30 bg-success/5">
					<CardBody className="flex items-start gap-3">
						<CheckCircle2 className="h-6 w-6 shrink-0 text-success" />
						<div>
							<p className="font-semibold">Application sent to {brand}</p>
							<p className="text-sm text-muted-foreground">
								The employer will review your application and update you here.
							</p>
						</div>
					</CardBody>
				</Card>
			)}

			{/* Secondary actions */}
			<div className="flex flex-wrap gap-2">
				<Button
					variant="outline"
					className="gap-1.5"
					onClick={() =>
						navigate(`/app/messages?thread=${app.id}&scope=application`)
					}
				>
					<MessageSquare className="h-4 w-4" /> Message {brand}
				</Button>
				<Button
					variant="outline"
					className="gap-1.5"
					onClick={() => setResearch(true)}
				>
					<Sparkles className="h-4 w-4 text-primary" /> AI Research
				</Button>
				<Button
					variant="ghost"
					className="gap-1.5 text-danger"
					onClick={() => setConfirmDelete(true)}
				>
					<Trash2 className="h-4 w-4" /> Withdraw
				</Button>
			</div>

			<Tabs value={tab} onValueChange={setTab} className="space-y-4">
				<TabsList className="flex flex-wrap">
					<TabsTrigger value="overview">
						<LayoutDashboard className="mr-1.5 inline h-4 w-4" />
						Overview
					</TabsTrigger>
					<TabsTrigger value="documents">
						<FileText className="mr-1.5 inline h-4 w-4" />
						Documents
					</TabsTrigger>
					<TabsTrigger value="assessment">
						<ClipboardCheck className="mr-1.5 inline h-4 w-4" />
						Assessment
					</TabsTrigger>
					<TabsTrigger value="results">
						<Sparkles className="mr-1.5 inline h-4 w-4" />
						Results
					</TabsTrigger>
				</TabsList>

				<TabsContent value="overview">
					<Card>
						<CardBody>
							<h2 className="mb-4 font-semibold">Timeline</h2>
							<ol className="space-y-4">
								{app.timeline.map((t, i) => (
									<li key={i} className="flex gap-3">
										<div className="flex flex-col items-center">
											<div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/12 text-primary">
												<CheckCircle2 className="h-4 w-4" />
											</div>
											{i < app.timeline.length - 1 && (
												<div className="my-1 w-0.5 flex-1 bg-border" />
											)}
										</div>
										<div className="pb-1">
											<p className="text-sm font-medium capitalize">
												{t.status === "applied"
													? "Application submitted"
													: t.status === "test_return"
														? "Test attempt returned"
														: t.status === "test_submitted"
															? t.late
																? "Test submitted (late)"
																: "Test submitted"
															: `Moved to ${t.status}`}
											</p>
											<p className="flex items-center gap-1 text-xs text-muted-foreground">
												<Clock className="h-3 w-3" /> {timeAgo(t.at)}
											</p>
										</div>
									</li>
								))}
							</ol>

							{app.cover_note && (
								<div className="mt-6 border-t border-border pt-4">
									<h3 className="mb-2 font-semibold">Your cover note</h3>
									<p className="text-sm leading-relaxed text-muted-foreground">
										{app.cover_note}
									</p>
								</div>
							)}
						</CardBody>
					</Card>
				</TabsContent>

				<TabsContent value="documents">
					<Card>
						<CardBody>
							<h2 className="mb-3 font-semibold">Submitted documents</h2>
							<DocumentList
								documents={app.documents}
								emptyText="No documents."
							/>
						</CardBody>
					</Card>
				</TabsContent>

				<TabsContent value="assessment">
					<Card>
						<CardBody>
							{job.assignment ? (
								<>
									<h3 className="flex items-center gap-2 font-semibold">
										<ClipboardCheck className="h-4 w-4 text-accent" />{" "}
										{job.assignment.title}
									</h3>
									<p className="mt-1 text-xs text-muted-foreground">
										{app.assignment_status === "submitted"
											? app.assignment_late
												? "Submitted after the deadline (marked late)."
												: "Submitted."
											: eligible
												? exhausted
													? `No attempts left (used ${app.attempts ?? 0} of ${maxAttempts}).`
													: "Pending — complete it from the button below."
												: "Unlocks once you're shortlisted."}
									</p>
									<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
										<span className="flex items-center gap-1">
											<Clock className="h-3.5 w-3.5" /> Time limit:{" "}
											{job.assignment.duration_minutes ?? 30} min per attempt
										</span>
										{deadline && (
											<span className="flex items-center gap-1">
												<Clock className="h-3.5 w-3.5" /> Complete by{" "}
												{formatDate(deadline.toISOString())}
											</span>
										)}
									</div>
									{app.assignment_status !== "submitted" &&
										eligible &&
										!exhausted && (
											<Button
												className="mt-3 gap-1.5"
												onClick={() =>
													navigate(`/app/applications/${app.id}/assessment`)
												}
											>
												<ClipboardCheck className="h-4 w-4" /> Take assessment
											</Button>
										)}
									{app.assignment_status === "submitted" && (
										<div className="mt-4">
											<SubmittedAnswers job={job} application={app} />
										</div>
									)}
								</>
							) : (
								<p className="text-sm text-muted-foreground">
									This job has no assessment.
								</p>
							)}
						</CardBody>
					</Card>
				</TabsContent>

				<TabsContent value="results">
					<Card>
						<CardBody>
							<GradeSummary application={app} />
						</CardBody>
					</Card>
				</TabsContent>
			</Tabs>

			<AIResearchPanel
				open={research}
				onClose={() => setResearch(false)}
				job={job}
				company={company ?? undefined}
				user={user}
			/>

			<Modal
				open={confirmDelete}
				onClose={() => setConfirmDelete(false)}
				size="sm"
				title="Withdraw application?"
				description="This can't be undone."
			>
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={() => setConfirmDelete(false)}>
						Cancel
					</Button>
					<Button variant="danger" onClick={withdraw}>
						Withdraw
					</Button>
				</div>
			</Modal>
		</div>
	);
}
