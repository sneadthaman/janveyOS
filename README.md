# Janvey OS MVP

Janvey OS is an AI-powered sales coach and knowledge system for I. Janvey & Sons.
This repository contains the initial MVP backend scaffold:

- Slack app (rep-facing, Slack Bolt)
- API server (Node.js + TypeScript + Express)
- Supabase integration (Postgres + vector-ready schema)
- OpenAI-powered recommendation flow with fallback behavior

## Quick Start

1. Copy env file:
```bash
cp .env.example .env
```

2. Fill in required keys:
- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- Slack keys for bot/socket mode

3. Install and run:
```bash
npm install
npm run dev
```

Manager console (separate Vite app):
```bash
npm run dev:web
```
Open `http://localhost:5174`.

## AI Model Router

Janvey OS uses a central router at [`src/ai/model-router.ts`](/Users/samjanvey/Desktop/Developer/janveyOS/src/ai/model-router.ts) so model choice is task-based instead of hardcoded.
All AI execution must go through [`src/ai/ai-client.ts`](/Users/samjanvey/Desktop/Developer/janveyOS/src/ai/ai-client.ts), not direct OpenAI SDK calls.

Task types:
- `sales_recommendation`
- `slack_simple_reply`
- `file_extraction`
- `knowledge_summary`
- `email_draft`
- `fallback`

Optional env overrides are available in [`.env.example`](/Users/samjanvey/Desktop/Developer/janveyOS/.env.example):
- `AI_MODEL_*` for per-task model selection
- `AI_REASONING_EFFORT_*` for per-task reasoning effort (`minimal|low|medium|high`)

4. Health check:
```bash
curl http://localhost:3000/health
```

## API Endpoints

- `GET /health`
- `POST /api/recommendations`
- `POST /api/recommendations/autoscrubber`
  - body fields:
    - `customer_name`
    - `customer_segment`
    - `floor_type`
    - `square_footage`
    - `cleaning_frequency`
    - `walk_behind_or_ride_on`
    - `battery_preference`
    - `budget`
    - `existing_machine`
    - `notes`
  - response includes:
    - `best_fit_product`
    - `value_alternative`
    - `price/cost/margin`
    - `why_it_fits`
    - `how_to_sell`
    - `objections`
    - `questions_to_ask_next`
    - `confidence_score`
- `GET /api/recommendations/recent`
- `POST /api/recommendations/:id/review`
- `POST /api/recommendations/:id/feedback`
  - supports:
    - `good_recommendation`
    - `bad_recommendation`
    - `needs_correction`
    - `wrong_product`
    - `bad_tone`
    - `missing_context`
  - optional `free_text_feedback` creates a pending `knowledge_entries` draft (`category=manager_feedback`, `source_type=recommendation_feedback`)
  - body: `{ "userId": "sam", "source": "web", "text": "Need an autoscrubber for a school" }`
- `POST /api/recommendations/feedback`
  - body: `{ "recommendationId": "...", "userId": "sam", "feedbackType": "approve|edit|reject", "notes": "..." }`
- `POST /api/uploads`
  - multipart form-data:
    - `file` (`.xlsx`, `.csv`, `.pdf`)
    - `vendor` (`Nilfisk|Taski|Triple-S`, default `Nilfisk`)
    - `documentType` (default `price_sheet`)
- `GET /api/uploads/:id/parsed-preview`
- `GET /api/uploads`
- `GET /api/uploads/:id`
- `POST /api/uploads/:id/approve`
- `POST /api/uploads/:id/reject`
- `POST /api/uploads/:id/reprocess` (placeholder)
- `GET /api/knowledge?status=pending|approved|rejected`
- `PATCH /api/knowledge/:id`
- `POST /api/knowledge/:id/approve`
- `POST /api/knowledge/:id/reject`

## Supabase Setup

Run [`supabase/schema.sql`](/Users/samjanvey/Desktop/Developer/janveyOS/supabase/schema.sql) in your Supabase SQL editor.

## Upload Ingestion MVP

### Behavior

- Files are saved locally to `./uploads` for development.
- Upload metadata is stored in `uploaded_documents`.
- CSV/XLSX parsing currently targets Nilfisk dealer-style columns:
  - SKU/item number
  - product name/description
  - suggested list price
  - dealer net price
- Parsed rows are stored in `parsed_product_rows` with `approved_status = pending`.
- Bad rows are skipped and logged with `skip_reason` (row-level; not fatal for entire upload).
- Pricing math applied per parsed row:
  - `true_cost = dealer_net * 0.93`
  - `ed_data_sell_price = list_price * 0.79`
  - `gross_profit = sell_price - true_cost`
  - `margin_percent = gross_profit / sell_price`
- `POST /api/uploads/:id/approve` promotes parsed rows into:
  - `products` (`approved_status = approved`)
  - `product_pricing` (`approved_status = approved`)
  - `knowledge_entries` (`category=product`, `source_type=upload`, `approved_status=approved`)

### curl: Upload

```bash
curl -X POST http://localhost:3000/api/uploads \
  -F "vendor=Nilfisk" \
  -F "documentType=price_sheet" \
  -F "file=@/absolute/path/to/nilfisk-price-list.xlsx"
```

Example response:
```json
{
  "uploaded_document_id": "uuid",
  "parse_status": "parsed_with_errors",
  "parsed_rows": 120,
  "skipped_rows": 4,
  "parser_message": null
}
```

### curl: Parsed Preview

```bash
curl http://localhost:3000/api/uploads/<uploaded_document_id>/parsed-preview
```

Returns:
- upload metadata
- summary totals
- `parsed_rows` (pending rows)
- `skipped_rows` with explicit reasons

### curl: Approve Parsed Rows

```bash
curl -X POST http://localhost:3000/api/uploads/<uploaded_document_id>/approve
```

Example response:
```json
{
  "uploaded_document_id": "uuid",
  "approved_rows": 120
}
```

### Automated Upload Test Script

Run:
```bash
npm run test:upload-nilfisk
```

The script will:
- upload a local sample Nilfisk XLSX
- print parse summary
- fetch parsed preview
- approve the upload
- print approved product count

It expects API server on `http://localhost:3000` (override with `JANVEY_API_URL`).

## Troubleshooting

- Supabase env issues:
  - If upload returns `Supabase is required for uploads.`, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`.
- Missing schema:
  - If table errors appear (e.g. `relation ... does not exist`), run [`supabase/schema.sql`](/Users/samjanvey/Desktop/Developer/janveyOS/supabase/schema.sql) in Supabase SQL editor.
- Multer/file upload issues:
  - Ensure request is `multipart/form-data` and file field name is exactly `file`.
  - Allowed extensions: `.xlsx`, `.csv`, `.pdf`.
- Slack env not configured:
  - API still runs; Slack integration is disabled with a warning until Slack tokens are provided.
- OpenAI key missing:
  - Recommendation endpoint falls back to deterministic coaching output and still logs recommendation attempts.

## Manager Console MVP

Routes:
- `/dashboard`: recent uploads, parse status, parsed/skipped counts, pending/approved totals
- `/uploads/:id`: parsed rows with pricing/margin details, skipped rows, approve/reject/reprocess actions
- `/knowledge`: pending knowledge inbox with approve/edit/reject actions
- `/recommendations`: recent recommendation logs with manager feedback actions
- `/playbooks`: autoscrubber playbook builder/editor for selling logic by segment

## Slack Autoscrubber Flow

- Slash command:
  - `/janvey autoscrubber need scrubber for school, VCT, 40000 sqft, daily use, battery, budget 15k`
- If key discovery fields are missing, Janvey asks follow-up prompts.

## MVP Logic Notes

- Recommendation pipeline currently:
  1. Pulls strategy rules and vendor priority from Supabase.
  2. Prompts OpenAI with sales context.
  3. Logs every recommendation for later review/training.
  4. Falls back to deterministic coaching output if OpenAI is unavailable.

- Next iterations:
  - Add product/pricing ingestion from uploaded files.
  - Add retrieval over `products.knowledge_embedding` via pgvector.
  - Add margin calculation service with contract overrides.
  - Build manager web console for knowledge approvals and strategy edits.
- `GET /api/playbooks?category=autoscrubber`
- `GET /api/playbooks/:id`
- `POST /api/playbooks`
- `PATCH /api/playbooks/:id`
- `DELETE /api/playbooks/:id`
