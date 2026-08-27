# AGENTS.md — Optryva Internship AI Assistant

## What it does
The Optryva Assistant is an AI agent embedded in the Optryva platform that helps
students, employers, and universities with internship discovery, preparation,
application, and hiring — all via conversational chat.

## Architecture
Two layers, both using the LLM abstraction layer (`server/src/assistant/llm.ts`):

1. **Chat mode** (`POST /api/assistant/chat`) — non-streaming, structured output.
   Uses `generateStructured()` which returns `{ text, actions }` as typed JSON.
   **This is the DEFAULT for all messages.** One AI request per message.
   Actions returned as a list for the client to execute.

2. **Agentic task mode** (`POST /api/assistant/task`) — streaming SSE. The agent
   calls tools autonomously in a loop (max 3 iterations, max 3 tools per turn).
   Each step (text delta, tool_use, tool_result, action) streams as an SSE frame.
   Only triggered when the user clicks "Run task" in the chat UI.

### Key behaviors
- **Default is chat**: `AssistantChat.tsx` calls `assistantApi.chat()` for normal
  messages. `runTask()` is opt-in via the ⚡ "Run task" button.
- **Immediate ack**: Chat shows "I'm checking that now…" instantly while the AI runs.
- **No auto URL inspection**: URLs in messages are only deep-inspected when the user
  explicitly asks (keywords: inspect, check, open, analyze, scrape).
- **Cancel support**: Both `chat()` and `runTask()` accept an optional `AbortSignal`.
  SSE text events are treated as deltas (replaced), not appended.
- **Timeouts**: AI calls 8s, tool execution 8s, Supabase queries 5s, external fetches 8s.
- **Parallel tools**: Independent tool calls within one iteration run via `Promise.all`.
- **Context cache**: Profile context cached for 30s TTL (`context.ts`).
- **Mode enforcement**: Server derives mode from `req.user.user_type`, ignoring any
  client-sent mode that doesn't match the user's role.
- **Action validation**: `emit_action` inputs validated against an allowlist of
  navigation targets. `parseAction()` replaces the broken `JSON.parse(tc.input)`.

### Safety fixes
- `agent.ts` no longer calls `JSON.parse(object)` — uses `parseAction()` validator.
- Actions in autonomous mode require explicit user opt-in via "Run task" button.
- TypeScript errors in `auth.ts`, `oauth.ts`, `onboarding.ts` fixed.

### LLM abstraction (`assistant/llm.ts`)
- **Primary**: Mistral (`mistral-large-latest`, JSON-mode structured output)
- **Fallback**: Claude (structured output via `output_config`)
- To switch providers: edit ONLY `llm.ts`. All other assistant modules import
  from `./llm` and never touch `@/lib/claude` or `@/lib/mistral` directly.

### Server structure
```
server/src/assistant/
  types.ts      — shared types + Zod schema
  llm.ts        — provider abstraction (Mistral primary, Claude fallback)
  context.ts    — mode-aware grounding (student résumé/matches, employer jobs)
  tools.ts      — deep_inspect (URL scraping + skill extraction), demo matcher
  engine.ts     — single-turn chat engine (structured output)
  agent.ts      — autonomous agentic loop (JSON-mode tool calling)
server/src/routes/assistant.ts  — Hono router → /api/assistant/*
```

### Available tools (agent can call any of these)
| Tool | Description |
|---|---|
| `deep_inspect` | Scrape a URL, extract skills + achievements |
| `update_profile_skills` | Add/replace skills on the user's profile (DB write) |
| `create_job_draft` | Create a draft job posting for an employer |
| `get_fixed40_matches` | Return 40 demo internship matches for a student |
| `get_employer_shortlist` | Get ranked candidates for a posted job |
| `emit_action` | Trigger client-side action (navigate, inject_data, etc.) |
| `save_message` | Persist a message to the conversation history |

## Client structure
```
client/src/components/
  RightSidebar.tsx       — persistent right sidebar with AI tabs (replaces floating widgets)
    Tabs: Assistant (chat), Activity (AI activity log), Research (quick info)
  AssistantChat.tsx      — chat UI with streaming + tool event display
client/src/app/AppShell.tsx  — layout: left sidebar | main content | RightSidebar
client/src/lib/api.ts
  assistantApi           — chat(), runTask(), sessions(), messages(), etc.
  jobsApi.create()        — direct job creation (used by create_job action)
  profilesApi.updateSkills — skill injection
```

## Running

### Server
```bash
cd server
npm run dev      # watch mode (tsx)
npm run typecheck
```
Requires: `MISTRAL_API_KEY` (primary), or `ANTHROPIC_API_KEY` (fallback),
plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

### Client
```bash
cd client
npm run dev      # Vite dev server
npm run typecheck
```
Set `VITE_API_URL=http://localhost:4000/api` in `.env` for local dev.

## Deploy
```bash
# Server Worker
npx wrangler deploy --config wrangler.jsonc
# Client (Pages)
cd client && npm run build && npx wrangler pages deploy dist --project-name=optryva
```

## Testing

Verified end-to-end with the existing `MISTRAL_API_KEY`:

```
TEST 1 (skills): Mistral returned { text, tool_calls: [{name: "update_profile_skills", input: {skills: ["Python","Docker"], mode: "add"}}] }
TEST 2 (job draft): Mistral returned create_job_draft with title, location, tags
TEST 3 (multi-tool): Mistral returned deep_inspect(url) + emit_action(navigate, jobs)
MULTI-TURN: Turn 1 → 2 tool_calls → Turn 2 → 0 tool_calls (done)
```

The resilient parameter parser (`getParam`/`getStr`/`getStrArray` in `agent.ts`)
handles Mistral's occasional parameter-name variants (e.g. `skills_to_add` vs
`skills`, `navigation` vs `navigate`).

## Migration
Run `0055_assistant_everything.sql` to create `assistant_sessions` and
`assistant_messages` tables (plus indexes + `assistant_thread` RPC).
