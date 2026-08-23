import { useEffect, useState } from "react"
import { Download, Expand, Minimize2 } from "lucide-react"
import { Modal } from "@/components/ui/Modal"
import { DOC_LABELS } from "@/components/DocumentList"
import type { AppDocument } from "@/types"
import { fetchProtectedDocument } from "@/lib/api"
import { formatBytes } from "@/lib/utils"

async function resolveViewUrl(d: AppDocument): Promise<string> {
	if (d.url.startsWith("data:")) {
		const blob = await (await fetch(d.url)).blob()
		return URL.createObjectURL(blob)
	}
	if (d.url.startsWith("/api/documents/")) {
		return await fetchProtectedDocument(d.url)
	}
	return d.url
}

const isImage = (d: AppDocument) =>
	/^data:image\//.test(d.url) || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(d.url)
const isPdf = (d: AppDocument) =>
	/^data:application\/pdf/i.test(d.url) || /\.pdf$/i.test(d.url)

export function DocumentViewer({
	document: doc,
	open,
	onClose,
}: {
	document: AppDocument | null
	open: boolean
	onClose: () => void
}) {
	const [url, setUrl] = useState<string | null>(null)
	const [wide, setWide] = useState(false)
	const [error, setError] = useState(false)

	useEffect(() => {
		let blobUrl: string | null = null
		let active = true
		setUrl(null)
		setError(false)
		if (open && doc) {
			resolveViewUrl(doc)
				.then((u) => {
					if (!active) {
						if (u.startsWith("blob:")) URL.revokeObjectURL(u)
						return
					}
					if (u.startsWith("blob:")) blobUrl = u
					setUrl(u)
				})
				.catch(() => active && setError(true))
		}
		return () => {
			active = false
			if (blobUrl) URL.revokeObjectURL(blobUrl)
		}
	}, [open, doc])

	const label = doc ? (DOC_LABELS[doc.kind] ?? doc.kind) : ""
	const previewable = doc ? isImage(doc) || isPdf(doc) : false

	return (
		<Modal
			open={open}
			onClose={onClose}
			size={wide ? "xl" : "lg"}
			className={wide ? "!max-w-[95vw] !max-h-[95dvh]" : undefined}
			title={doc?.name}
			description={doc ? `${label}${doc.size ? ` · ${formatBytes(doc.size)}` : ""}` : undefined}
		>
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={() => setWide((w) => !w)}
					className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
				>
					{wide ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
					{wide ? "Narrow" : "Widen"}
				</button>
				{doc && (
					<a
						href={url ?? undefined}
						download={doc.name}
						target="_blank"
						rel="noopener"
						className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
					>
						<Download className="h-4 w-4" /> Download
					</a>
				)}
			</div>

			<div className="mt-4 min-h-[50vh] overflow-hidden rounded-xl border border-border bg-muted/30">
				{error ? (
					<div className="flex h-[50vh] items-center justify-center px-4 text-center text-sm text-muted-foreground">
						This document could not be previewed. Use Download to open it instead.
					</div>
				) : !url ? (
					<div className="flex h-[50vh] items-center justify-center text-sm text-muted-foreground">
						Loading preview…
					</div>
				) : !previewable ? (
					<div className="flex h-[50vh] items-center justify-center px-4 text-center text-sm text-muted-foreground">
						This file type can't be previewed here. Use Download to open it.
					</div>
				) : isImage(doc!) ? (
					<img
						src={url}
						alt={doc!.name}
						className="mx-auto max-h-[80vh] w-auto object-contain"
					/>
				) : (
					<iframe src={url} title={doc!.name} className="h-[80vh] w-full" />
				)}
			</div>
		</Modal>
	)
}
