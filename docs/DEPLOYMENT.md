# JanveyOS Deployment Guide

This guide covers production deployment for the internal Janvey beta (JanveyOS/UROS action framework).

## Architecture

Run **two processes**:

1. API process
- serves HTTP API
- listens on `PORT`
- runs Slack Socket Mode app

2. Worker process
- runs background action execution loop
- does **not** listen on a port
- uses same Supabase database as API

Current supported action types:
- `quote_to_so`

Future action placeholders:
- `eta_update`
- `new_item_draft`
- `po_ack`

## Supabase Setup

1. Create/confirm production Supabase project.
2. Set production secrets:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
3. Apply migrations before first rollout.

## Running Migrations

Apply SQL migrations in `supabase/migrations/` to production.

Required for JanveyOS action-request status model:
- `supabase/migrations/20260523014000_phase3g_agent_action_request_status_cleanup.sql`

## Required Environment Variables

- `NODE_ENV=production`
- `PORT`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `SLACK_BOT_TOKEN` (`xoxb-...`)
- `SLACK_APP_TOKEN` (`xapp-...`)
- `SLACK_SIGNING_SECRET`
- `NETSUITE_ACCOUNT_ID`
- `NETSUITE_CONSUMER_KEY`
- `NETSUITE_CONSUMER_SECRET`
- `NETSUITE_TOKEN_ID`
- `NETSUITE_TOKEN_SECRET`
- `NETSUITE_QUOTE_TO_SO_RESTLET_URL`
- `NETSUITE_LIVE_QUOTE_TO_SO_ENABLED` (default should remain `false` until controlled rollout)

Recommended:
- `NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL`
- `NETSUITE_ACCOUNT_BASE_URL` (for Slack clickable SO links)
- `QUOTE_TO_SO_APPROVER_SLACK_USER_IDS` (Slack approver allowlist)
- `EXECUTION_WORKER_INTERVAL_MS`

## API Deployment

Build:

```bash
npm run build
```

Start API process:

```bash
npm run start:api
```

Notes:
- API process validates production env requirements at startup.
- Slack startup failures are logged and do not crash the API process.

## Worker Deployment

Build:

```bash
npm run build
```

Start worker process:

```bash
npm run start:worker
```

Notes:
- Worker does not bind a port.
- Worker startup logs include:
  - worker name
  - polling interval
  - live quote-to-so enabled flag
  - `NODE_ENV`

## Slack Socket Mode Notes

- `SLACK_APP_TOKEN` must start with `xapp-`.
- `SLACK_BOT_TOKEN` must start with `xoxb-`.
- Invalid/missing tokens cause Slack startup to be skipped with warnings.
- Known transient Socket Mode disconnect errors are logged without taking down the API.

## NetSuite Live Gating

- `NETSUITE_LIVE_QUOTE_TO_SO_ENABLED=false` keeps live transform blocked.
- Slack approval flow can still run and surface preview/non-live behavior.
- Live transform is only executed when:
  - execution mode is live
  - `NETSUITE_LIVE_QUOTE_TO_SO_ENABLED=true`

## Smoke Test Checklist

1. API boots.
2. `GET /health` responds with status JSON.
3. Worker boots and logs startup metadata.
4. Slack app connects (or logs clear startup failure reason).
5. Item lookup works.
6. Quote-to-SO preview creates pending action request.
7. Approve button updates request status.
8. Live transform remains blocked while `NETSUITE_LIVE_QUOTE_TO_SO_ENABLED=false`.
9. Live transform works only after setting `NETSUITE_LIVE_QUOTE_TO_SO_ENABLED=true`.

## Railway Deployment (Phase 4B)

Deploy with two Railway services from the same GitHub repo:

1. `janveyos-api`
2. `janveyos-worker`

### Setup Steps

1. Connect this GitHub repo to Railway.
2. Create service: `janveyos-api`
   - Build command: `npm run build`
   - Start command: `npm run start:api`
3. Create service: `janveyos-worker`
   - Build command: `npm run build`
   - Start command: `npm run start:worker`
4. Set `NODE_ENV=production` on both services.
5. Set all required env vars on both services.
6. Keep `NETSUITE_LIVE_QUOTE_TO_SO_ENABLED=false` for initial rollout.

### Required Environment Vars (Railway)

Set these on both API and worker services unless noted:

- `NODE_ENV=production`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`
- `SLACK_SIGNING_SECRET`
- `NETSUITE_ACCOUNT_ID`
- `NETSUITE_CONSUMER_KEY`
- `NETSUITE_CONSUMER_SECRET`
- `NETSUITE_TOKEN_ID`
- `NETSUITE_TOKEN_SECRET`
- `NETSUITE_QUOTE_TO_SO_RESTLET_URL`
- `NETSUITE_LIVE_QUOTE_TO_SO_ENABLED=false` (initially)

API service also needs:
- `PORT` (Railway injects this automatically)

Recommended:
- `NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL`
- `NETSUITE_ACCOUNT_BASE_URL`
- `QUOTE_TO_SO_APPROVER_SLACK_USER_IDS`
- `EXECUTION_WORKER_INTERVAL_MS`

### Railway Smoke Test Commands / Procedure

1. Health check:
```bash
curl https://<railway-api-url>/health
```

2. Confirm API logs:
- API boot message
- Slack startup message (or clear skip reason)

3. Confirm worker logs:
- worker process started
- interval and env info printed

4. Test Slack command/message:
- basic Slack connectivity
- item lookup command/message

5. Test quote-to-SO preview flow:
- submit quote conversion request
- confirm pending action request is created

6. Approve while live flag is false:
- confirm request is handled safely
- confirm no live NetSuite transform executes

7. Only later enable live mode:
- set `NETSUITE_LIVE_QUOTE_TO_SO_ENABLED=true`
- run controlled quote-to-SO approval test
