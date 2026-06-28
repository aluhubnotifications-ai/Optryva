# Outcome-tracking worker — contract

The server records an **intent-to-apply** (and snapshots the match score) whenever a
student clicks an external "Apply" link, and schedules a background check 14 days
out (`match_outcomes`, migration `0014_outcome_tracking.sql`). Your lightweight
worker (Python) does the periodic checks and writes evidence back. This file is the
contract so you can plug it in without touching the app.

## Hard rules (read first)
1. **Consent is mandatory.** Only ever process rows returned by the `due_outcome_checks`
   RPC — it already filters to students who opted in (`profiles.monitoring_consent = 1`).
   Never query `match_outcomes` directly for work.
2. **GitHub: use the official API** (`api.github.com`) on the URL the student linked.
   Public, rate-limited, allowed.
3. **LinkedIn: do NOT scrape.** It violates LinkedIn's ToS and is privacy-sensitive.
   If you monitor LinkedIn at all, use an official API / user-initiated OAuth, gated on
   the same consent. The schema is source-agnostic, so a compliant source slots in
   without changing anything here.
4. Store only what you need to guide the student. Don't retain raw scraped pages.

## How to find work
Call the RPC (service-role key, server-side only):
```sql
select * from due_outcome_checks(100);
-- returns: student_id, job_id, github, linkedin, status, check_count, signals
```
Returns outcomes that are **due** (`check_at <= now()`), still `monitoring`, and
**opted-in**, oldest first.

## How to write results back
Update the row by its (`student_id`, `job_id`) key:
```python
sb.table("match_outcomes").update({
    "signals": merged_signals,        # jsonb: e.g. {"github_commits_30d": 12, "new_repo": true}
    "status": new_status,             # see state machine below
    "check_count": row["check_count"] + 1,
    "last_checked_at": iso_now,
    "check_at": iso_now_plus_14d,     # next check, or leave when closing
    "updated_at": iso_now,
}).eq("student_id", row["student_id"]).eq("job_id", row["job_id"]).execute()
```

## Status state machine
- `monitoring`      → default after intent; keep checking on the 14-day cadence.
- `profile_updated` → detected relevant progress (e.g. new project/commits). Surfaces a
                      "you're moving — here's the next gap" nudge to the student.
- `likely_hired`    → strong evidence of a new role. Feeds the calibration loop as the
                      **strongest positive** signal on the score we gave.
- `closed`          → no signal after `MAX_CHECKS` (suggest 3) → stop.
- `opted_out`       → student turned consent off (the RPC already excludes them; set this
                      if you observe it mid-run).

Reschedule `check_at = now + 14d` after each check; after `MAX_CHECKS`, set `closed`.

## What the loop feeds
`status = 'likely_hired'` / `'profile_updated'` are read by `npm run calibrate` as
positive outcomes (using `score_at_intent`), and by `npm run eval-matching` as
engagement — closing the loop that trains the matcher on real results.

## Minimal Python skeleton (no scraping)
```python
import os, datetime as dt
from supabase import create_client

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
MAX_CHECKS = 3

def iso(d): return d.isoformat()

def run():
    due = sb.rpc("due_outcome_checks", {"p_limit": 100}).execute().data or []
    for row in due:
        signals = dict(row.get("signals") or {})
        status = row["status"]
        # GitHub via official API only; LinkedIn left out unless compliant.
        if row.get("github"):
            signals |= check_github(row["github"])          # you implement: api.github.com
            if signals.get("likely_hired"):   status = "likely_hired"
            elif signals.get("recent_activity"): status = "profile_updated"
        n = row["check_count"] + 1
        if status == "monitoring" and n >= MAX_CHECKS:
            status = "closed"
        now = dt.datetime.now(dt.timezone.utc)
        sb.table("match_outcomes").update({
            "signals": signals, "status": status, "check_count": n,
            "last_checked_at": iso(now), "check_at": iso(now + dt.timedelta(days=14)),
            "updated_at": iso(now),
        }).eq("student_id", row["student_id"]).eq("job_id", row["job_id"]).execute()

if __name__ == "__main__":
    run()
```
Run it on a schedule (cron / a tiny container). The DB does the consent + due-time
filtering, so the worker stays dumb and safe.
