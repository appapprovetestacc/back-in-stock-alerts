# Back in Stock Alerts

Shopify App scaffolded by [AppApprove](https://appapprove.com). Built on
Remix + Cloudflare Workers.

## What this app does

**Back in Stock Alerts** lets customers subscribe to out-of-stock products and automatically receive an email notification the moment inventory is replenished.

### How it works

1. **Customer subscribes** — A customer visits the public subscription page at `/customer/back-in-stock?shop=<shop>&productId=<id>` and enters their email address. The subscription is stored in D1 (Cloudflare's SQLite).

2. **Inventory is replenished** — When a merchant restocks a product, Shopify fires the `inventory_levels/update` webhook to this app.

3. **Notification is sent** — The webhook handler checks for active subscriptions matching the replenished variant, sends each subscriber an email via the `sendMail()` helper, and marks the subscription as notified.

### Admin dashboard

Merchants can view subscription counts and manage settings from the embedded admin dashboard at the app's root route. The dashboard uses Polaris components and App Bridge JWT authentication.

## Local development

```bash
pnpm install
cp .env.example .env
pnpm dev
```

## Deploy

This repo is automatically deployed by AppApprove on every push to `main`.
Your live URL is `https://back-in-stock-alerts.appapprove.app`.

## Key routes

| Route | Description |
|---|---|
| `/app` | Embedded admin dashboard (Polaris + App Bridge) |
| `/customer/back-in-stock` | Public customer subscription form (no auth required) |
| `/webhooks/*` | HMAC-verified Shopify webhook endpoint |
| `/auth` | OAuth entry point |
| `/auth/callback` | OAuth callback — saves offline session to KV |

## Webhooks

| Topic | Handler | Purpose |
|---|---|---|
| `inventory_levels/update` | `app/webhooks/inventory-levels-update.ts` | Detects restocks and triggers email notifications |
| `customers/data_request` | `app/webhooks/customers-data-request.ts` | GDPR: export customer data |
| `customers/redact` | `app/webhooks/customers-redact.ts` | GDPR: delete customer data |
| `shop/redact` | `app/webhooks/shop-redact.ts` | GDPR: delete shop data on uninstall |

## Scopes

```
read_products,read_inventory
```

## What's in here

- `app/` - Remix routes and components
- `app/webhooks/` - Shopify webhook handlers (HMAC-verified by app/lib/webhook-router.server.ts)
- `app/crons/` - CF Cron Trigger handlers (dispatched by app/lib/cron-router.server.ts)
- `app/lib/review-evidence.ts` - reviewer setup, screencast, credential, and data-retention checklist
- `app/lib/sync.server.ts` - starter helpers for GraphQL backfill, webhook upserts, and replay-safe sync
- `extensions/` - editable theme app extension and Shopify Function starters
- `tests/` - generated review and webhook smoke tests
- `shopify.app.toml` - Shopify App configuration. Apply it to your Partner Dashboard yourself (or run `shopify app deploy`) - AppApprove does not sync it for you.
- `appapprove.config.ts` - webhook routes, cron handlers, build hooks, env mapping
- `pricing.yaml` - declarative billing plans
- `wrangler.toml` - Cloudflare Workers runtime config

## Background jobs

Cron schedules and CF Queues are declared in two places that must stay
in sync: `appapprove.config.ts` (handler dispatch) and `wrangler.toml`
(`[triggers]` + `[[queues.*]]`). The deploy pipeline diffs the two on
every push and warns when they drift.

To add an hourly cleanup job:

1. `app/crons/cleanup.ts` - write your handler (see `example-cleanup.ts`)
2. `appapprove.config.ts` - add `"0 * * * *": "~/crons/cleanup"` to `crons`
3. `wrangler.toml` - uncomment `[triggers]` and add the same schedule

Edit anything you like. Open the project in AppApprove's hosted Iterate
for AI-assisted changes with live preview.