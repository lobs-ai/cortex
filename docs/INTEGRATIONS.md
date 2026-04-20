# Integrations — setup guide

Cortex wires external systems (calendar, chat, code hosting) through OAuth or
API tokens. Today **Google Calendar** is the only provider with a real OAuth
flow; the rest are record-only placeholders in the Settings → Integrations tab.

This doc walks through connecting Google Calendar end-to-end.

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

### 5. Paste credentials into `.env`

In the repo root, edit `.env` (copy from `.env.example` if you haven't):

```env
GOOGLE_CLIENT_ID=<paste client id>
GOOGLE_CLIENT_SECRET=<paste client secret>
GOOGLE_REDIRECT_URI=http://localhost:9009/api/integrations/google/callback
ENCRYPTION_KEY=<any string — tokens are AES-GCM encrypted with this key>
```

Restart the backend so the new env vars are loaded.

### 6. Connect

1. Open the app, click the gear icon, open **Settings → Integrations**.
2. Click **Connect Google Calendar**. A Google popup opens.
3. Pick your Google account, grant the read-only calendar + email scopes.
4. The popup closes; the integration row shows your email and status
   `connected`.
5. An initial sync kicks off in the background. Events from the next 60 days
   (and last 24h) will appear in Cortex within a few seconds.

The background worker re-syncs every 15 minutes. You can also click
**Sync now** on the integration row to force a pull.

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

## Other integrations

Gmail, Google Drive, Discord, GitHub, Slack, Notion, and Linear are currently
**record-only** in the Settings UI. You can track that an integration exists
and toggle its status, but Cortex doesn't actually call those services yet.
OAuth flows for them will land as individual phases.
