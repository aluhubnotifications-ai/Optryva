"""
Optryva Extraction Service
==========================

Optional companion to the Node/Cloudflare-Workers backend. It does the heavy
content extraction that Workers can't run in-process:

  * Public URLs        -> Crawl4AI + Playwright (JavaScript-heavy pages)
  * DOCX / PPTX / XLS  -> Unstructured
  * PDF                -> Unstructured (falls back to pdfplumber)
  * Images             -> Vision LLM (OpenAI or Mistral Pixtral)
  * Audio / Video      -> faster-whisper transcription

The Node backend calls POST /extract only for the content types it can't
process natively, and only when EXTRACTION_SERVICE_URL is configured. When the
service is absent, those types are simply skipped and the pipeline still works
for URLs, PDFs, and images (handled natively by the Worker).

Run:
    pip install -r requirements.txt
    playwright install chromium
    uvicorn main:app --host 0.0.0.0 --port 8000

Env:
    OPENAI_API_KEY / OPENAI_VISION_MODEL      (vision, preferred)
    MISTRAL_API_KEY / MISTRAL_VISION_MODEL    (vision, fallback)
"""

import os
import io
import base64
import tempfile
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Optryva Extraction Service")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class ExtractRequest(BaseModel):
    kind: str  # "url" | "file"
    url: str | None = None
    filename: str | None = None
    data_base64: str | None = None
    mime: str | None = None


def _ext(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if name and "." in name else ""


async def extract_url(url: str) -> str:
    from crawl4ai import AsyncWebCrawler
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=url, bypass_cache=True)
    return result.markdown or result.cleaned_text or ""


def parse_document(filename: str, data: bytes) -> str:
    from unstructured.partition.auto import partition
    suffix = "." + _ext(filename)
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        f.write(data)
        path = f.name
    try:
        elements = partition(filename=path)
        return "\n".join(str(e) for e in elements)
    finally:
        os.remove(path)


def transcribe(data: bytes, filename: str) -> str:
    from faster_whisper import WhisperModel
    suffix = "." + _ext(filename)
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        f.write(data)
        path = f.name
    try:
        model = WhisperModel("base", device="cpu", compute_type="int8")
        segments, _ = model.transcribe(path)
        return " ".join(s.text for s in segments)
    finally:
        os.remove(path)


def describe_image(data: bytes, mime: str) -> str:
    import requests
    data_url = f"data:{mime or 'image/jpeg'};base64,{base64.b64encode(data).decode()}"
    system = (
        "Describe this image of a student's work evidence (certificate, "
        "project screenshot, event photo, design, poster). Return a concise, "
        "factual description of what it shows and the skills it demonstrates."
    )
    if os.getenv("OPENAI_API_KEY"):
        r = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {os.getenv('OPENAI_API_KEY')}"},
            json={
                "model": os.getenv("OPENAI_VISION_MODEL", "gpt-4o-mini"),
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": [{"type": "image_url", "image_url": {"url": data_url}}]},
                ],
                "max_tokens": 400,
            },
            timeout=60,
        )
        return r.json()["choices"][0]["message"]["content"].strip()
    if os.getenv("MISTRAL_API_KEY"):
        r = requests.post(
            "https://api.mistral.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {os.getenv('MISTRAL_API_KEY')}"},
            json={
                "model": os.getenv("MISTRAL_VISION_MODEL", "pixtral-large-latest"),
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": [{"type": "image_url", "image_url": {"url": data_url}}]},
                ],
                "max_tokens": 400,
            },
            timeout=60,
        )
        return r.json()["choices"][0]["message"]["content"].strip()
    return ""


@app.post("/extract")
async def extract(req: ExtractRequest):
    try:
        if req.kind == "url":
            if not req.url:
                raise HTTPException(400, "url required")
            text = await extract_url(req.url)
            return {"text": text[:20000]}

        if not req.data_base64:
            raise HTTPException(400, "data_base64 required")
        data = base64.b64decode(req.data_base64)
        ext = _ext(req.filename or "")
        mime = req.mime or ""
        if mime.startswith("image/") or ext in {"png", "jpg", "jpeg", "gif", "webp"}:
            text = describe_image(data, mime)
        elif mime.startswith("audio/") or ext in {"mp3", "wav", "m4a", "ogg", "aac", "flac"}:
            text = transcribe(data, req.filename or "audio.mp3")
        elif mime.startswith("video/") or ext in {"mp4", "mov", "webm", "mkv", "avi"}:
            text = transcribe(data, req.filename or "video.mp4")
        else:
            text = parse_document(req.filename or "doc", data)
        return {"text": (text or "")[:20000]}
    except HTTPException:
        raise
    except Exception as e:  # surface a clean error to the caller
        raise HTTPException(500, str(e))


@app.get("/health")
async def health():
    return {"status": "ok"}
