# Optryva Extraction Service

A small Python microservice that does the heavy content extraction the
Cloudflare-Workers backend can't run in-process. The Node backend calls it
only for content types it can't handle natively (DOCX/PPTX/XLS, audio, video,
and JavaScript-heavy web pages) and only when `EXTRACTION_SERVICE_URL` is set.

## What it handles

| Input | Engine |
|-------|--------|
| Public URLs (incl. JS-heavy) | Crawl4AI + Playwright |
| DOCX / PPTX / XLS / PDF | Unstructured |
| Images | Vision LLM (OpenAI or Mistral Pixtral) |
| Audio / Video | faster-whisper transcription |

## Run locally

```bash
cd extract-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
uvicorn main:app --host 0.0.0.0 --port 8000
```

## Deploy

Any Python host (Render, Fly, Railway, a container). Expose port 8000 and set:

```
EXTRACTION_SERVICE_URL=https://<your-host>/     # consumed by the Node backend
OPENAI_API_KEY=...                               # vision (preferred)
OPENAI_VISION_MODEL=gpt-4o-mini                 # optional override
MISTRAL_API_KEY=...                              # vision fallback
MISTRAL_VISION_MODEL=pixtral-large-latest       # optional override
```

In the Node backend, set `EXTRACTION_SERVICE_URL` to this service's URL so the
evidence `extract` step delegates unsupported file/URL types to it.

## API

`POST /extract`

```json
{ "kind": "url", "url": "https://student-portfolio.example/project" }
```

```json
{ "kind": "file", "filename": "cert.pdf", "data_base64": "<base64>", "mime": "application/pdf" }
```

Response: `{ "text": "<cleaned, AI-ready content>" }`
