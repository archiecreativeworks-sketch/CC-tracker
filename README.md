# The Pineda’s Blessed CC Tracker

A personal expense tracker for our BPI credit card. It's a static web app hosted on Vercel, with two small serverless functions for household sync and receipt scanning.

## Features
- **Statement cycles** based on the BPI cut-off day. Each transaction is grouped into the statement it will appear on, with its due date.
- **Overview:** charges per statement, amount and date due, outstanding balance, available credit, breakdowns by category and cardholder, and a 6-statement trend.
- **Receipt scanning:** take a photo of a receipt and the date, amount, merchant and category are filled in for you (uses the Claude API). You can always enter things manually.
- **Household sync:** both phones share one set of data, protected by a household passcode.
- **Budgets** per category for each statement, with warnings at 80% and when over.
- **Due-date reminders:** a banner in the app, plus a calendar file with the next 12 due dates and alerts.
- **Statement check:** enter BPI's Total Amount Due and see whether it matches what you recorded.
- **Installments** (BPI Real 0% / SIP), payments, refunds, fees/interest, search and filters.
- **Backup:** export/import JSON, export/import CSV.

## Vercel setup (one time)
1. **Storage for sync:** Vercel project → **Storage** → **Create Database** → **Upstash** (Redis, free plan) → connect it to this project. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
2. **Environment variables** (Project → Settings → Environment Variables):
   - `APP_PASSCODE`: the household passcode you'll type on each phone.
   - `ANTHROPIC_API_KEY`: an API key from console.anthropic.com (needed for receipt scanning only).
3. **Redeploy** (Deployments → ⋯ → Redeploy) so the new settings take effect.

## Files
- `index.html`, `styles.css`, `app.js`: the app
- `shared/merge.js`: merges data from two phones (newest edit of each record wins)
- `api/data.js`: sync endpoint (Upstash Redis)
- `api/scan.js`: receipt scanning endpoint (Claude API)
