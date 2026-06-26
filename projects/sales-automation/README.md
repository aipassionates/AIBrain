# Sales Automation

Automated lead pipeline: Facebook Lead Ads → AI voice call → email follow-up → CRM.

## Stack decided

| Step | Tool | Status |
|---|---|---|
| Lead capture | Facebook Lead Ads webhook → n8n | ⬜ Not built |
| Lead enrichment | Apollo.io (Cowork plugin) | ⬜ Not configured |
| AI voice call | Retell AI + Twilio/Telnyx | ⬜ Not built |
| Email follow-up | SendGrid | ⬜ Not built |
| CRM | HubSpot | ⬜ Not configured |
| Booking | Acuity or Cal.com | ⬜ Not decided |

## What exists

- n8n is running and Cowork-connected
- Telnyx MCP is available (Cowork connector)
- The "Cowork MCP Tools" workflow (ID: `2zxCSXHtmY76XU69`) is the MCP executor

## Build order (recommended)

1. Facebook Lead Ads webhook → n8n (capture + store in n8n Data Store)
2. HubSpot Cowork connector → create contact/deal on lead capture
3. Retell AI API → trigger outbound call via n8n ToolHttpRequest node
4. SendGrid email sequence (triggered by call outcome)
5. Booking link in email → Acuity/Cal.com webhook back to n8n to update CRM

## n8n workflow naming convention

`[SalesAuto] <description>` — e.g. `[SalesAuto] Facebook Lead Capture`
