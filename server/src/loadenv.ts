// Side-effect module: load .env with `override: true` so the project's .env is
// authoritative in local dev. dotenv does NOT override variables already set in
// the environment, so a stale ANTHROPIC_API_KEY (or any var) exported in the
// shell would otherwise shadow .env and cause silent 401s on every Claude call.
// Must be imported FIRST — before anything that reads process.env at import time
// (e.g. lib/claude.ts constructs the Anthropic client at module load). In
// production (Cloudflare) there's no .env file, so this is a no-op.
import { config as loadEnv } from 'dotenv'
loadEnv({ override: true })
