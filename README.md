# Janvey OS Middleware MVP

Janvey OS is the middleware control plane between OpenClaw agents, Slack, and Janvey business systems.

This MVP intentionally focuses on:
- safe business tools
- permission checks
- approval gates
- audit logging
- integration boundaries (NetSuite/email/vendor systems stubbed behind tools)
- manager visibility

## Architecture

```text
Slack
  ↓
OpenClaw Agent
  ↓
Janvey OS Middleware API
  ↓
Safe Business Tools
  ↓
NetSuite / Email / Vendor Portals (next)
```

## Quick Start

1. Copy env file:
```bash
cp .env.example .env
```

2. Fill in required keys:
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- Slack keys for `/janvey` command (optional)
- `AGENT_SHARED_SECRET` (optional but recommended)
- `NETSUITE_QUOTE_LOOKUP_RESTLET_URL` for Slack quote lookup flow
- NetSuite OAuth/TBA keys and RESTlet URLs for quote lookup + live transform (optional unless using live execution)

3. Install and run:
```bash
npm install
npm run dev
```

4. Health check:
```bash
curl http://localhost:3000/health
```

## Tool Endpoints (Phase 1)

All endpoints are explicit and deterministic under `/api/tools/*`.

Optional auth header:
- `x-agent-secret: <AGENT_SHARED_SECRET>`
- If `AGENT_SHARED_SECRET` is set, requests without a matching value are rejected.

Read-only tools (logged to `agent_tool_calls`):
- `POST /api/tools/item-lookup`
- `POST /api/tools/eta-lookup`
- `POST /api/tools/pricing-lookup`

Preview/draft tools (create `agent_action_requests`, no execution):
- `POST /api/tools/quote-to-so/preview`
- `POST /api/tools/new-item/draft`
- `POST /api/tools/pricing-update/preview`

No real NetSuite writes are implemented in this phase.

`agent_action_requests` now includes `requires_approval` so action policies are explicit per request.

## Agent Manager Endpoints (MVP)

- `GET /api/agent/tool-calls`
  - returns recent `agent_tool_calls` newest first
- `GET /api/agent/action-requests`
  - returns recent `agent_action_requests` newest first
- `POST /api/agent/action-requests/:id/approve`
  - only `pending` requests can be approved
  - sets `status=approved`, `approved_by`, `approved_at`, `updated_at`
- `POST /api/agent/action-requests/:id/reject`
  - only `pending` requests can be rejected
  - sets `status=rejected`, `updated_at`

Approval/rejection does not execute any downstream business action yet.

## Execution Worker MVP

- Polls approved action requests every 10 seconds (configurable)
- Claims jobs with conditional update (`status=approved`, `claimed_at is null`) to avoid double execution
- Executes handlers with explicit live-gating for NetSuite Quote -> Sales Order
- Writes execution attempt logs to `agent_action_execution_logs`
- Retries failed jobs up to 3 attempts
- Marks terminal status as `failed` after max retries
- `quote_to_so` execution defaults to production-safe dry-run preview
- live NetSuite transform runs only when explicitly enabled
- Uses NetSuite-native transform semantics (`estimate` -> `salesorder`) in output preview
- Never auto-approves, fulfills, or bills downstream records

Environment:
- `EXECUTION_WORKER_ENABLED=true|false` (default true)
- `EXECUTION_WORKER_INTERVAL_MS=10000`
- `NETSUITE_EXECUTION_MODE=dry_run|live` (invalid/missing defaults to `dry_run`)
- `NETSUITE_LIVE_QUOTE_TO_SO_ENABLED=true|false` (default `false`)
- `NETSUITE_QUOTE_LOOKUP_RESTLET_URL`
- `NETSUITE_QUOTE_TO_SO_RESTLET_URL`
- Optional NetSuite auth envs for RESTlet/OAuth/TBA wiring:
  - `NETSUITE_ACCOUNT_ID`
  - `NETSUITE_CONSUMER_KEY`
  - `NETSUITE_CONSUMER_SECRET`
  - `NETSUITE_TOKEN_ID`
  - `NETSUITE_TOKEN_SECRET`
  - `NETSUITE_RESTLET_AUTH_HEADER`

### Quote -> Sales Order Dry-Run (Phase 2C)

Expected action request `input_json` example:

```json
{
  "action_type": "quote_to_so",
  "quote_internal_id": "12345",
  "memo": "Dry run conversion test",
  "po_number": "TEST-PO-123",
  "approval_status_target": "Pending Approval"
}
```

Behavior:
- validates `quote_internal_id` (or other supported aliases)
- builds a `record.transform` preview payload (`estimate` -> `salesorder`)
- does not call NetSuite
- does not create a Sales Order
- writes `output_json` with `wouldSubmit=false` and `mode=dry_run`
- carries intended post-transform approval target (`Pending Approval` by default)

Live behavior:
- If `NETSUITE_EXECUTION_MODE=live` and `NETSUITE_LIVE_QUOTE_TO_SO_ENABLED=true`, the execution worker calls the NetSuite Quote -> Sales Order transform RESTlet after manager approval.
- If `NETSUITE_EXECUTION_MODE=live` but `NETSUITE_LIVE_QUOTE_TO_SO_ENABLED` is not `true`, execution fails with a non-retryable safety error.

## Manager Console Pages

- `/agent-activity` shows recent tool calls
- `/agent-actions` shows action requests and approve/reject controls

No auth yet.

## Persistence

Supabase tables:
- `agent_tool_calls`
- `agent_action_requests`

See [`supabase/schema.sql`](/Users/samjanvey/Desktop/Developer/janveyOS/supabase/schema.sql) for definitions.

## Slack Command (MVP)

`/janvey <tool> <json_payload>`

Examples:
```text
/janvey item_lookup {"query":"DIV 95892221"}
/janvey eta_lookup {"sku":"DIV 95892221","customer":"CHS","sales_order":"SO12345"}
/janvey pricing_update_preview {"sku":"DIV 95892221","customer":"CHS","new_price":42.5}
```

## Slack Quote -> SO Conversation (Phase 2E)

Example:

User:
`convert quote EST123`

Bot:
`I found Quote EST123 for ABC Customer, total $1,234.56. Do you want to add a PO number before I submit this for manager approval?`

User:
`po PO-456`

Bot:
`Submitted Quote EST123 with PO # PO-456 for manager approval.`

Expired quote behavior:
- `Quote EST999 is expired as of 04/30/2026. I won't submit it for conversion unless we add an override flow.`
- no action request is created for expired quotes

Notes:
- Slack does not execute NetSuite transform directly.
- Slack only creates `quote_to_so` action requests (`requires_approval=true`).
- Conversation state is in-memory for MVP and does not survive server restarts.

## Live Quote -> SO Settings

To enable live NetSuite transform execution (post-approval only):

- `NETSUITE_EXECUTION_MODE=live`
- `NETSUITE_LIVE_QUOTE_TO_SO_ENABLED=true`
- `NETSUITE_QUOTE_TO_SO_RESTLET_URL=<your quote->so RESTlet URL>`
- NetSuite OAuth/TBA credentials:
  - `NETSUITE_ACCOUNT_ID`
  - `NETSUITE_CONSUMER_KEY`
  - `NETSUITE_CONSUMER_SECRET`
  - `NETSUITE_TOKEN_ID`
  - `NETSUITE_TOKEN_SECRET`

Slack still does not execute NetSuite directly. Slack only creates an approval-gated action request that the worker executes after manager approval.

## OpenClaw Routing

OpenClaw should call Janvey OS APIs directly:
- `POST {JANVEY_OS_API_BASE_URL}/api/tools/item-lookup`
- `POST {JANVEY_OS_API_BASE_URL}/api/tools/eta-lookup`
- `POST {JANVEY_OS_API_BASE_URL}/api/tools/pricing-lookup`
- `POST {JANVEY_OS_API_BASE_URL}/api/tools/quote-to-so/preview`
- `POST {JANVEY_OS_API_BASE_URL}/api/tools/new-item/draft`
- `POST {JANVEY_OS_API_BASE_URL}/api/tools/pricing-update/preview`

Skill file:
- [`openclaw-skills/janvey-os/SKILL.md`](/Users/samjanvey/Desktop/Developer/janveyOS/openclaw-skills/janvey-os/SKILL.md)

## Legacy Modules

The existing recommendation, ingestion, and knowledge routes remain in the repo for now, but they are not the primary product direction for this MVP. The explicit `/api/tools/*` routes define the current architecture boundary.
