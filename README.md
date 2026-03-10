# Moments Hospice — Operations Command Center

Auto-updating dashboard pulling from Tableau (HCHB), Zendesk, and Microsoft 365 email.
Refreshes every 30 minutes automatically. Pushes critical alerts to your email instantly.

---

## WHAT YOU GET

- Live dashboard at a real URL you can bookmark
- Auto-refreshes every 30 minutes without touching anything
- WebSocket real-time push — data appears the moment it's fetched
- Daily 6:30am email digest with top risks
- Instant alert email when critical issues are detected (resignations, escalated tickets, etc.)
- AI-generated intelligence summary of the most urgent issues

---

## STEP 1: GET YOUR CREDENTIALS (30 min)

You need 4 sets of credentials. Get them in this order:

### Tableau Personal Access Token
1. Go to https://basrv-tx.hchb.com
2. Click your name (top right) → My Account Settings
3. Scroll to "Personal Access Tokens"
4. Click "Create token" → name it "ops-center"
5. Copy the Token Name and Token Value — save them, you only see the value once

### Zendesk API Token
1. Go to your Zendesk Admin Center
2. Apps and Integrations → Zendesk API
3. Enable Token Access → Add API token
4. Copy the token

### Microsoft 365 App (for email scanning)
1. Go to https://portal.azure.com
2. Azure Active Directory → App registrations → New registration
3. Name: "Moments Ops Center" → Register
4. Copy the Application (client) ID and Directory (tenant) ID
5. Certificates & secrets → New client secret → Copy the Value
6. API permissions → Add permission → Microsoft Graph → Application → Mail.Read → Grant admin consent

### Anthropic API Key (for AI summaries)
1. Go to https://console.anthropic.com
2. API Keys → Create key
3. Copy it

---

## STEP 2: DEPLOY TO RENDER (20 min, free)

1. Create a free account at https://render.com

2. Put the app files in a GitHub repo:
   - Go to https://github.com → New repository → "moments-ops-center"
   - Upload all files from this folder

3. In Render:
   - New → Web Service → Connect your GitHub repo
   - It will auto-detect the render.yaml
   - Click "Create Web Service"

4. Add your environment variables in Render:
   - Go to your service → Environment
   - Add each variable from .env.example with your real values

5. Render will deploy and give you a URL like:
   https://moments-ops-center.onrender.com

Bookmark that URL. It runs 24/7.

---

## STEP 3: TEST IT (5 min)

Open your URL. You should see the dashboard loading.
Within 2 minutes of startup it will fetch your first data refresh.

Check the colored pills at the top:
- Green = connected successfully
- Red = check that credential in Render environment variables

---

## REFRESH SCHEDULE

Default: every 30 minutes
Change REFRESH_INTERVAL_MINUTES in Render environment to adjust (e.g., 15 for every 15 min)

Daily digest: sent at 6:30am to DIGEST_RECIPIENTS
Critical alerts: sent immediately when detected, any time of day

---

## YOUR TABLEAU VIEWS (already wired in)

The app is pre-configured with your actual Moments Hospice view IDs:
- Hospice Key Metrics: Summary, Census, Admits/Discharges, Visits, Gross Margin, Cost Per Day
- Visit Patterns
- Hospice Census
- Worker Turnover
- Field Metrics
- Visit Utilization

---

## TROUBLESHOOTING

**Dashboard shows "—" for census data:**
Tableau token may be expired or wrong. Regenerate in HCHB and update Render env vars.

**Zendesk shows "not connected":**
Check ZENDESK_SUBDOMAIN (just the subdomain, not the full URL) and ZENDESK_API_TOKEN.

**Email not scanning:**
Microsoft Graph app needs Mail.Read permission with admin consent granted.

**Free Render tier goes to sleep after 15 min of no traffic:**
Upgrade to Render Starter ($7/mo) to keep it always-on. Or set a cron job to ping /api/health every 10 minutes.

---

## FILES

- server.js          — Backend: all API integrations, scheduler, WebSocket
- public/index.html  — Frontend dashboard (auto-updates via WebSocket)
- package.json       — Node.js dependencies
- render.yaml        — Render deployment config
- .env.example       — Template for your credentials
