# ETA Feature (Phase 5B Foundation)

## Overview
This phase adds the ETA data-model and lookup foundation for JanveyOS without enabling automatic NetSuite updates.

Current scope:
- store normalized ETA updates locally in Supabase
- support Slack ETA queries for PO numbers using local records
- support manual Slack ETA capture into local ETA records
- add NetSuite client scaffolding for open PO lookup
- approval-gated `eta_update` action execution flow to NetSuite PO ETA RESTlet

Out of scope in this phase:
- email inbox parsing
- PDF extraction for ETA
- vendor portal scraping
- automatic NetSuite ETA updates

## Architecture
- `vendor_eta_updates` table stores normalized ETA signals from multiple sources.
- `src/domain/actions/eta-update/eta-update-repository.ts` provides CRUD/query helpers.
- `src/domain/services/slack/eta-query-conversation.ts` handles ETA query intent and formats Slack replies.
- `src/domain/services/slack/eta-capture-conversation.ts` parses/saves manual ETA updates from Slack messages.
- `src/domain/actions/eta-update/eta-slack-parser.ts` normalizes manual ETA text into structured fields.
- `src/integrations/netsuite/client.ts` includes `lookupOpenPurchaseOrder` for open PO data retrieval when RESTlet is available.
- `src/domain/actions/eta-update/eta-update-execution-handler.ts` executes approved ETA updates through NetSuite.
- `src/domain/services/slack/eta-update-approval.ts` sends approval buttons and handles approve/reject/cancel actions.

## Data Model
Table: `public.vendor_eta_updates`

Primary fields:
- vendor identity: `vendor_name`
- PO identity: `po_number`, `netsuite_po_internal_id`
- item identity: `item_number`, `netsuite_item_internal_id`
- ETA signal: `eta_date`, `tracking_number`, `raw_notes`, `confidence`
- source metadata: `source_type`, `source_reference`
- workflow metadata: `status`, `created_action_request_id`

Normalized enums:
- `update_scope`: `po_all_lines | po_line | item_global | unknown`
- `source_type`: `slack | email | pdf | portal | manual`
- `status`: `parsed | matched | needs_review | approved | applied | rejected | superseded`

## Planned Phases
1. Phase 5B (current): local storage + local Slack query + NetSuite open PO lookup method.
2. Next: ingest ETA updates from Slack/manual inputs into the table.
3. Next: add email/PDF/portal ingestion with confidence scoring.
4. Later: scheduled daily ETA agent for match + review queue.
5. Later: controlled approval workflow for applying ETA updates into NetSuite.

## Outlook Ingestion (Phase 6A)
- Create an Outlook folder named `AI ETA`.
- Copy ETA vendor emails into this folder. Moving is optional.
- The ingestion worker polls this folder and processes recent messages regardless of unread/read status.
- Dedupe key is Microsoft Graph `message.id` (`graph_message_id` in DB).
- `internetMessageId` is stored when available.

### Required Env Vars
- `MICROSOFT_GRAPH_ENABLED` (`true` to enable ingestion worker)
- `MICROSOFT_GRAPH_USER_EMAIL` (mailbox to read)
- `MICROSOFT_GRAPH_AI_ETA_FOLDER_NAME` (default `AI ETA`)
- `MICROSOFT_GRAPH_POLL_INTERVAL_MS` (default `60000`)
- Auth: either
  - `MICROSOFT_GRAPH_ACCESS_TOKEN` (delegated token), or
  - `MICROSOFT_GRAPH_TENANT_ID`, `MICROSOFT_GRAPH_CLIENT_ID`, `MICROSOFT_GRAPH_CLIENT_SECRET`
- Optional Slack approval destination:
  - `MICROSOFT_GRAPH_APPROVAL_SLACK_CHANNEL_ID`

### Safety Rules
- Read-only mailbox behavior: no delete, no send, no move operations.
- Ingestion does not rely on unread status.
- NetSuite is not mutated at ingestion time.
- Ingestion only creates approval-gated `eta_update` action requests.

## Sources
Planned source channels:
- Slack/manual
- Email
- PDF
- Vendor portal

## Notes
- This version is intentionally local-first for ETA answers.
- Slack ETA queries currently return only local `vendor_eta_updates` results.
- If no local updates exist, Slack returns a no-data message.
- ETA updates are never auto-applied to NetSuite; manager approval is required.
- NetSuite mutation depends on `NETSUITE_PO_ETA_UPDATE_RESTLET_URL`. Missing config fails safely.

## Manual Slack Capture Examples
- `Diversey says PO289731 is coming 5/29`
- `PO289731 ETA 5/29 tracking 123456`
- `Apply 5/29 ETA to all lines on PO289731`
- `Diversey PO289731 tracking PRO123 ETA 5/29`

Captured fields:
- vendor name (if present)
- PO number
- ETA date normalized to `YYYY-MM-DD`
- tracking number (if present)
- update scope (`po_all_lines` when explicitly stated, otherwise `unknown`)
