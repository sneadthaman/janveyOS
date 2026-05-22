---
name: janvey-os
description: Janvey business middleware tools for NetSuite, ETA, pricing, and operational workflows.
---

# Janvey OS Skill

Use this skill when a user asks about Janvey business operations, including:
- item lookup
- ETA lookup
- pricing lookup
- quote conversion
- new item creation
- pricing updates
- NetSuite-related requests

## Rules

1. Never directly write to NetSuite.
2. Use Janvey OS API endpoints for all business data.
3. Read-only lookups may be performed immediately.
4. Write or change requests must be previewed first and require approval.
5. Always summarize the source trail and confidence.
6. If information is missing, ask concise follow-up questions.
7. If sources conflict, mark confidence low and escalate for human review.

## Tool routing

For item lookup:
POST {JANVEY_OS_API_BASE_URL}/api/tools/item-lookup

For ETA lookup:
POST {JANVEY_OS_API_BASE_URL}/api/tools/eta-lookup

For pricing lookup:
POST {JANVEY_OS_API_BASE_URL}/api/tools/pricing-lookup

For quote-to-SO preview:
POST {JANVEY_OS_API_BASE_URL}/api/tools/quote-to-so/preview

For new item draft:
POST {JANVEY_OS_API_BASE_URL}/api/tools/new-item/draft

For pricing update preview:
POST {JANVEY_OS_API_BASE_URL}/api/tools/pricing-update/preview

## Response style

Be concise and operational.

For lookups:
- Answer
- Confidence
- Sources checked
- Next action if needed

For previews:
- Show current data
- Show proposed change
- Show issues
- Say approval is required
