# Integrations — setup guide

The easiest way to set up any integration is **in the app**: open Settings →
Integrations, expand the provider you want, follow the numbered steps, paste
your credentials, and hit Save. Each provider has the full walkthrough
(including direct links to the vendor's setup pages) inline.

This doc is the same walkthrough in text form, useful for reference or if you
need to bring up an integration before the UI is available.

## What's actually live vs. saved-only

| Provider | Status |
|---|---|
| Google Calendar | **Live** — OAuth + 15-min sync |
| Gmail | Saved-only (consent granted; sync coming) |
| Google Drive | Saved-only (consent granted; sync coming) |
| Discord | Saved-only |
| GitHub | Saved-only |
| Slack | Saved-only |
| Notion | Saved-only |
| Linear | Saved-only |

**Saved-only** means: credentials are accepted, encrypted, and stored. The
worker will start using them once per-provider sync ships.

Credentials are AES-256-GCM encrypted with `ENCRYPTION_KEY` before being
written. If you change `ENCRYPTION_KEY` you'll need to re-enter them.

---

## Google Calendar (OAuth)

### 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/>.
2. Click the project picker (top bar) → **New Project**. Name it anything — e.g.
   `cortex-dev`.

### 2. Enable the APIs

In the project, open **APIs & Services → Library** and enable:

- **Google Calendar API** — required for event sync.
- **People API** — required so we can read the authed user's email (shown in
  the integration row as the "detail").

### 3. Configure the OAuth consent screen

**APIs & Services → OAuth consent screen**:

- **User type**: *External*
- **App name**: `Cortex` (or whatever you like)
- **User support email**: your email
- **Developer contact**: your email
- **Scopes**: click **Add or remove scopes** and add:
  - `.../auth/calendar.readonly`
  - `.../auth/userinfo.email`
  - `openid`
- **Test users**: add your own Google account. Until the app is published
  ("production"), only listed test users can sign in.

### 4. Create the OAuth client

**APIs & Services → Credentials → Create credentials → OAuth client ID**:

- **Application type**: *Web application*
- **Name**: `Cortex local`
- **Authorized redirect URIs**: add exactly

  ```
  http://localhost:9009/api/integrations/google/callback
  ```

  If you run the backend on a different port/host, update
  `GOOGLE_REDIRECT_URI` below to match and add the corresponding URI here.

Hit **Create**. Copy the **Client ID** and **Client secret**.

### 5. Paste credentials in the app

Open **Settings → Integrations → Google**, paste the **Client ID** and
**Client Secret** into the fields, and hit **Save credentials**. No backend
restart needed — config lives in the database, AES-GCM encrypted.

(If you prefer, you can also set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
in `.env` — the app uses env values as a fallback when no per-user config
is saved.)

### 6. Connect

1. Click **Connect Google**. A popup opens.
2. Pick your Google account, grant the calendar + gmail + drive + email
   scopes.
3. The popup closes; the card shows your email and status `connected`.
4. An initial calendar sync kicks off in the background — events from the
   last day and the next 60 days appear within a few seconds.

The background worker re-syncs every 15 minutes. Use **Sync calendar now**
to force a pull. Use the per-product toggles (Calendar / Gmail / Drive) to
turn individual features off without revoking OAuth.

---

## How tokens are stored

- Access + refresh tokens are AES-256-GCM encrypted with `ENCRYPTION_KEY`
  before being written to `integrations.access_token_encrypted` /
  `refresh_token_encrypted`.
- Silent refresh is handled by the Google OAuth client; refreshed access
  tokens are re-encrypted and persisted so we never re-consent unnecessarily.
- **Disconnect** calls Google's revoke endpoint and clears both columns.

---

## Troubleshooting

- **`redirect_uri_mismatch`** — the URI in the OAuth client doesn't exactly
  match `GOOGLE_REDIRECT_URI`. Check scheme, host, port, and path (no trailing
  slash).
- **Popup blocked** — allow popups for `localhost:9009` (or your dev host).
- **`This app isn't verified`** — expected for an External/Testing app. Click
  *Advanced → Continue*. Only users in your test-users list can sign in until
  the app is published.
- **No events show up** — the sync window is 1 day back → 60 days ahead on the
  **primary** calendar. Secondary calendars aren't synced yet. Click **Sync
  now** and check the backend logs for a `calendar:` line.
- **Refresh token missing** — if you previously consented without
  `prompt=consent`, Google may not issue a refresh token. Disconnect and
  reconnect; the flow forces `prompt=consent` so you'll always get one.
- **Nothing happens on click, no error** — open the browser devtools console.
  Cross-origin `postMessage` issues usually show up there.

---

## Other integrations (Discord, GitHub, Slack, Notion, Linear)

Each has a setup wizard in **Settings → Integrations**. The in-app steps are
the source of truth, but briefly:

- **Discord** — Developer Portal → new app → add a bot → copy the bot token
  and your Discord user ID.
- **GitHub** — fine-grained personal access token with Issues/PRs/Contents
  read access to the repos you care about.
- **Slack** — new Slack app → add bot scopes (`chat:write`, etc.) → install
  to workspace → copy the `xoxb-` bot token.
- **Notion** — create an internal integration, share the pages/databases
  you want to expose, copy the `secret_` token.
- **Linear** — Settings → API → new personal API key (`lin_api_…`).

Credentials are stored encrypted. Active sync for these lands per-provider
in a later release; the wizards exist so your creds are ready the moment it
ships.
