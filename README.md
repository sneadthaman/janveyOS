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
- Slack approval buttons are supported for `quote_to_so` requests:
  - `Approve / Create Sales Order`
  - `Reject`
  - `Cancel`
- Optional approver allowlist:
  - `QUOTE_TO_SO_APPROVER_SLACK_USER_IDS=U123,U456`
  - If unset, approval behavior falls back to existing local/dev behavior (no Slack-user restriction).

## Live Quote -> SO Settings

To enable live NetSuite transform execution (post-approval only):

- `NETSUITE_EXECUTION_MODE=live`
- `NETSUITE_LIVE_QUOTE_TO_SO_ENABLED=true`
- `NETSUITE_QUOTE_TO_SO_RESTLET_URL=<your quote->so RESTlet URL>`
- `NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL=<your sales-order lookup RESTlet URL>`
- NetSuite OAuth/TBA credentials:
  - `NETSUITE_ACCOUNT_ID`
  - `NETSUITE_CONSUMER_KEY`
  - `NETSUITE_CONSUMER_SECRET`
  - `NETSUITE_TOKEN_ID`
  - `NETSUITE_TOKEN_SECRET`

Slack still does not execute NetSuite directly. Slack only creates an approval-gated action request that the worker executes after manager approval.

## Quote-to-SO Production Readiness Checklist

Before controlled live rollout:

- Apply required migration:
  - `supabase/migrations/20260523014000_phase3g_agent_action_request_status_cleanup.sql`
- Configure required env vars:
  - `NETSUITE_EXECUTION_MODE=live`
  - `NETSUITE_LIVE_QUOTE_TO_SO_ENABLED=true`
  - `NETSUITE_QUOTE_TO_SO_RESTLET_URL=...`
  - `NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL=...`
  - `NETSUITE_ACCOUNT_ID=...`
  - `NETSUITE_CONSUMER_KEY=...`
  - `NETSUITE_CONSUMER_SECRET=...`
  - `NETSUITE_TOKEN_ID=...`
  - `NETSUITE_TOKEN_SECRET=...`
- Optional but recommended for Slack SO links:
  - `NETSUITE_ACCOUNT_BASE_URL=https://<account>.app.netsuite.com`
- Slack approver allowlist:
  - `QUOTE_TO_SO_APPROVER_SLACK_USER_IDS=U123,U456`
- Confirm worker is enabled:
  - `EXECUTION_WORKER_ENABLED=true`

Recommended first live test:
1. Reset one safe test quote workflow (`npm run dev:reset-quote-to-so -- EST7883` in non-prod only).
2. Submit from Slack, capture PO/no-PO, approve with an authorized approver.
3. Verify transitions: `pending -> approved -> running -> executed`.
4. Confirm one Sales Order is created and Slack posts success with SO details.
5. Re-click stale approval button; verify no duplicate execution.

Safety notes:
- Idempotency and stale-button protections prevent duplicate Quote->SO transforms.
- Unauthorized approvers are blocked with ephemeral Slack responses.

Dev-only local reset helper (never use in production):

```bash
npm run dev:reset-quote-to-so -- EST7883
```

## Phase 3B Manual E2E Validation (Idempotency)

Apply migration first (run in Supabase SQL editor):

```sql
select *
from quote_to_so_executions
order by created_at desc
limit 10;
```

If the table does not exist, apply the latest `supabase/schema.sql` changes, then re-run the query.

Live test prerequisites:
- `NETSUITE_EXECUTION_MODE=live`
- `NETSUITE_LIVE_QUOTE_TO_SO_ENABLED=true`
- `NETSUITE_QUOTE_TO_SO_RESTLET_URL=<...>`
- valid NetSuite OAuth env vars

Expected user-result states surfaced by execution output:
- `started`
- `already_running`
- `already_completed`
- `completed`
- `failed`

SQL inspection queries during tests:

```sql
select
  id,
  quote_internal_id,
  idempotency_key,
  status,
  sales_order_internal_id,
  sales_order_tran_id,
  error_code,
  error_message,
  started_at,
  completed_at,
  created_at,
  updated_at
from quote_to_so_executions
order by created_at desc
limit 20;
```

```sql
select
  idempotency_key,
  count(*)
from quote_to_so_executions
group by idempotency_key
having count(*) > 1;
```

Expected duplicate check result:
- zero rows

Manual tests:
1. First Approval
- Trigger Slack quote conversion and approve once.
- Expect one `quote_to_so_executions` row, status transitions `running -> completed`.

## Document Review + Outlook Ingestion (Phases 6F, 6G, 6G.1)

### New Environment Variables

- `DOCUMENT_REVIEW_SLACK_CHANNEL_ID`
- `OUTLOOK_INGESTION_ENABLED=false`
- `OUTLOOK_MAILBOX=<mailbox@domain>`
- `OUTLOOK_CUSTOMER_PO_FOLDER_NAME=AI Cust PO`
- `OUTLOOK_MAX_MESSAGES=10`
- `MICROSOFT_GRAPH_TENANT_ID`
- `MICROSOFT_GRAPH_CLIENT_ID`
- `MICROSOFT_GRAPH_CLIENT_SECRET`

### New Scripts

- `npm run eta:post-reviews -- [limit]`
  - posts pending ETA review cards to Slack
- `npm run outlook:scan-cust-po -- --dry-run --limit 10`
  - scans AI Cust PO folder and reports candidates
- `npm run outlook:scan-cust-po -- --ingest --limit 10`
  - ingests discovered customer PO PDFs/bodies
- `npm run outlook:scan-cust-po -- --ingest --extract --limit 10`
  - ingest + classify + mismatch/triage updates

### Slack Review Cards (Phase 6F)

- ETA candidate cards post to `DOCUMENT_REVIEW_SLACK_CHANNEL_ID`
- Buttons:
  - `Approve ETA`
  - `Reject`
  - `Maybe Later`
- Actions update the original Slack card (`chat.update`) and use existing review services.
- Approval creates pending `eta_update` action requests only.
- No NetSuite mutation is executed from these review buttons.

### Outlook AI Cust PO Ingestion (Phase 6G)

Scope:
- Folder: `AI Cust PO` only
- Source hint: `customer_po`
- No Sales Order creation
- No NetSuite writes
- No email move/delete

Dry-run shows:
- folder messages scanned
- PDF files found
- sender/subject/message ids

Ingest mode writes `ingested_documents` with mailbox/folder/folder_hint metadata and (optionally) classification results.

### Thread-Aware Hardening (Phase 6G.1)

Defaults:
- `--include-thread` enabled
- `--include-body` enabled
- disable with `--no-thread` / `--no-body`

Thread behavior:
- For each routed folder message, scans same-conversation messages for PDF attachments.
- Preserves metadata from attachment source message and routed-by message.
- Deduplicates by `sourceMessageId + attachmentId` and by document hash.
- Output distinguishes `ingested` vs `duplicate_existing_document`.

Body fallback behavior:
- If no PDF and body has strong PO signals, ingests `source=email_body` as `email-body-<messageId>.txt`.
- Automatic replies are skipped unless strong PO signals are present.

Resilience:
- If Graph conversation query fails (e.g., “restriction or sort order is too complex”), thread expansion is skipped for that message and processing continues.
- Logged as `outlook.customer_po.thread_scan_skipped`.
- Summaries include `threadScanErrors`.
- Expect one NetSuite Sales Order.

2. Duplicate Approval After Completion
- Re-run for same quote.
- Expect no new NetSuite SO and no second execution row.
- Expect `already_completed` result with existing SO IDs.

3. Duplicate While Running
- Simulate:
```sql
update quote_to_so_executions
set status = 'running'
where quote_internal_id = '<QUOTE_INTERNAL_ID>';
```
- Approve again.
- Expect `already_running` and no NetSuite transform call.

4. Failed Then Retry
- Force controlled failure (dev only), e.g. invalid transform RESTlet URL.
- Expect `failed` status with safe `error_message`.
- Restore config and retry.
- Expect same idempotency row reused and final `completed` state.

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
