// Declarative specs that drive the Integrations UI. Each provider has:
//   - display metadata
//   - an ordered list of setup steps the user does on the vendor's side
//   - an ordered list of credential fields to collect in-app
//   - a hint about whether sync is actually implemented today
//
// Adding a new provider is just another entry — the UI wizard is generic.

export type ConfigField = {
  key: string;
  label: string;
  type: "text" | "secret" | "textarea";
  required: boolean;
  placeholder?: string;
  help?: string;
};

export type SetupStep = {
  title: string;
  body: string;
  // Optional direct link to the vendor page for this step.
  link?: { label: string; href: string };
};

export type IntegrationImplStatus = "live" | "saved-only" | "not-started";

export type IntegrationSpec = {
  id: string;
  label: string;
  summary: string;
  // Config lives under this key. Multiple features can share one (all
  // Google products share provider="google").
  configProvider: string;
  // Features render as per-product rows. For single-feature integrations
  // this is one item with id === configProvider.
  features: {
    id: string;
    label: string;
    description: string;
    implementation: IntegrationImplStatus;
    implementationNote?: string;
  }[];
  steps: SetupStep[];
  fields: ConfigField[];
  // Whether this provider uses a real OAuth connect button after config is
  // saved. When false, saving credentials is the "connected" state.
  oauth: boolean;
  docsLink?: { label: string; href: string };
};

export const INTEGRATION_SPECS: IntegrationSpec[] = [
  {
    id: "google",
    label: "Google",
    summary:
      "One OAuth consent covers Calendar, Gmail, and Drive (read-only). Toggle individual products off anytime.",
    configProvider: "google",
    oauth: true,
    features: [
      {
        id: "google_calendar",
        label: "Google Calendar",
        description: "Syncs events from your primary calendar into Cortex.",
        implementation: "live",
      },
      {
        id: "gmail",
        label: "Gmail",
        description: "Read-only access for future context features.",
        implementation: "saved-only",
        implementationNote: "OAuth consent is granted; sync lands in a later release.",
      },
      {
        id: "google_drive",
        label: "Google Drive",
        description: "Metadata-only access for future document awareness.",
        implementation: "saved-only",
        implementationNote: "OAuth consent is granted; sync lands in a later release.",
      },
    ],
    steps: [
      {
        title: "Create a Google Cloud project",
        body: "Open the Cloud Console and create a new project (any name).",
        link: { label: "Google Cloud Console", href: "https://console.cloud.google.com/" },
      },
      {
        title: "Enable the APIs",
        body: "In APIs & Services → Library, enable: Google Calendar API, Gmail API, Google Drive API, People API.",
        link: { label: "Enable APIs", href: "https://console.cloud.google.com/apis/library" },
      },
      {
        title: "Configure the OAuth consent screen",
        body: "Type: External. Add your own Google account as a test user. Add scopes: calendar.readonly, gmail.readonly, drive.metadata.readonly, userinfo.email, openid.",
        link: {
          label: "OAuth consent screen",
          href: "https://console.cloud.google.com/apis/credentials/consent",
        },
      },
      {
        title: "Create OAuth client credentials",
        body:
          "Credentials → Create credentials → OAuth client ID → Web application. Add this exact redirect URI:\nhttp://localhost:9009/api/integrations/google/callback",
        link: {
          label: "Credentials",
          href: "https://console.cloud.google.com/apis/credentials",
        },
      },
      {
        title: "Paste the client ID and secret below, then Connect",
        body:
          "Hit Save, then click Connect Google. A popup opens — pick your account, grant the scopes, and you're done.",
      },
    ],
    fields: [
      {
        key: "client_id",
        label: "OAuth Client ID",
        type: "text",
        required: true,
        placeholder: "123456789-abc.apps.googleusercontent.com",
      },
      {
        key: "client_secret",
        label: "OAuth Client Secret",
        type: "secret",
        required: true,
        placeholder: "GOCSPX-…",
      },
      {
        key: "redirect_uri",
        label: "Redirect URI",
        type: "text",
        required: false,
        placeholder: "http://localhost:9009/api/integrations/google/callback",
        help: "Must exactly match an authorized redirect URI in your OAuth client. Leave blank for the default.",
      },
    ],
    docsLink: { label: "Full walkthrough", href: "/docs/INTEGRATIONS.md" },
  },

  {
    id: "discord",
    label: "Discord",
    summary:
      "Post reminders and nudges to yourself via a personal bot. You own the bot; Cortex never sees your account.",
    configProvider: "discord",
    oauth: false,
    features: [
      {
        id: "discord",
        label: "Discord bot",
        description: "Send messages to a channel or your DMs.",
        implementation: "saved-only",
        implementationNote: "Credentials are stored; the worker is not yet wired to send.",
      },
    ],
    steps: [
      {
        title: "Create a Discord application",
        body: "Go to the Developer Portal → New Application. Give it a name like 'Cortex'.",
        link: {
          label: "Discord Developer Portal",
          href: "https://discord.com/developers/applications",
        },
      },
      {
        title: "Add a bot user",
        body: "In your app, go to Bot → Reset Token → copy the token. Enable 'Message Content Intent' if you want the bot to read replies.",
      },
      {
        title: "Invite the bot to a server",
        body: "OAuth2 → URL generator → scope: bot → permissions: Send Messages. Open the URL, add it to your server.",
      },
      {
        title: "Find your Discord user ID",
        body:
          "In Discord, enable Developer Mode (Settings → Advanced), then right-click your name → Copy User ID.",
      },
    ],
    fields: [
      {
        key: "bot_token",
        label: "Bot Token",
        type: "secret",
        required: true,
        placeholder: "MTAxxxxxxxxxxxxxxx.xxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      },
      {
        key: "default_user_id",
        label: "Default User ID",
        type: "text",
        required: false,
        placeholder: "123456789012345678",
        help: "Who should receive DMs by default.",
      },
    ],
  },

  {
    id: "github",
    label: "GitHub",
    summary:
      "Pull issue/PR context to inform planning. Personal access token with read-only scopes is enough.",
    configProvider: "github",
    oauth: false,
    features: [
      {
        id: "github",
        label: "GitHub",
        description: "Issues, pull requests, and commit activity for context.",
        implementation: "saved-only",
      },
    ],
    steps: [
      {
        title: "Create a fine-grained personal access token",
        body:
          "GitHub → Settings → Developer settings → Personal access tokens → Fine-grained. Pick the repos you want Cortex to see. Permissions: Issues (read), Pull requests (read), Contents (read), Metadata (read).",
        link: {
          label: "Fine-grained tokens",
          href: "https://github.com/settings/tokens?type=beta",
        },
      },
      {
        title: "Paste the token below and save",
        body: "Tokens start with github_pat_. Keep the expiry reasonable — you'll rotate from this same screen.",
      },
    ],
    fields: [
      {
        key: "personal_access_token",
        label: "Personal access token",
        type: "secret",
        required: true,
        placeholder: "github_pat_…",
      },
      {
        key: "default_owner",
        label: "Default owner/org",
        type: "text",
        required: false,
        placeholder: "rsymonds",
      },
    ],
  },

  {
    id: "slack",
    label: "Slack",
    summary:
      "Post digests and plan summaries into a Slack workspace via an app-level bot token.",
    configProvider: "slack",
    oauth: false,
    features: [
      {
        id: "slack",
        label: "Slack",
        description: "Send messages to channels you invite the bot to.",
        implementation: "saved-only",
      },
    ],
    steps: [
      {
        title: "Create a Slack app",
        body: "From Scratch → pick your workspace.",
        link: { label: "Slack API apps", href: "https://api.slack.com/apps" },
      },
      {
        title: "Add bot scopes",
        body:
          "OAuth & Permissions → Bot Token Scopes: chat:write, chat:write.public, channels:read, users:read.",
      },
      {
        title: "Install the app to your workspace",
        body: "OAuth & Permissions → Install to Workspace. Copy the Bot User OAuth Token (xoxb-…).",
      },
      {
        title: "Grab the signing secret",
        body:
          "Basic Information → App Credentials → Signing Secret. Used to verify inbound webhooks (for future /slash command support).",
      },
    ],
    fields: [
      {
        key: "bot_token",
        label: "Bot User OAuth Token",
        type: "secret",
        required: true,
        placeholder: "xoxb-…",
      },
      {
        key: "signing_secret",
        label: "Signing secret",
        type: "secret",
        required: false,
      },
      {
        key: "default_channel",
        label: "Default channel",
        type: "text",
        required: false,
        placeholder: "#cortex",
      },
    ],
  },

  {
    id: "notion",
    label: "Notion",
    summary:
      "Read or write to selected Notion pages/databases using an internal integration token.",
    configProvider: "notion",
    oauth: false,
    features: [
      {
        id: "notion",
        label: "Notion",
        description: "Access pages and databases you share with the integration.",
        implementation: "saved-only",
      },
    ],
    steps: [
      {
        title: "Create an internal integration",
        body: "Notion → Settings → Integrations → Develop your own → New integration. Capabilities: Read + optionally Update/Insert.",
        link: {
          label: "Notion integrations",
          href: "https://www.notion.so/my-integrations",
        },
      },
      {
        title: "Share pages with it",
        body:
          "On each page/database you want Cortex to see, click ••• → Connect to → select your integration.",
      },
      {
        title: "Paste the internal integration token",
        body: "Starts with secret_. Rotate from the same screen if it leaks.",
      },
    ],
    fields: [
      {
        key: "integration_token",
        label: "Internal integration token",
        type: "secret",
        required: true,
        placeholder: "secret_…",
      },
      {
        key: "default_database_id",
        label: "Default database ID",
        type: "text",
        required: false,
        placeholder: "e.g. 1a2b3c4d5e6f…",
      },
    ],
  },

  {
    id: "linear",
    label: "Linear",
    summary:
      "Pull issue + project state from your Linear workspace. A personal API key is enough for read access.",
    configProvider: "linear",
    oauth: false,
    features: [
      {
        id: "linear",
        label: "Linear",
        description: "Issues, projects, and cycle status for planning.",
        implementation: "saved-only",
      },
    ],
    steps: [
      {
        title: "Create a personal API key",
        body: "Linear → Settings → API → Personal API keys → New key. Name it 'Cortex'.",
        link: {
          label: "Linear API keys",
          href: "https://linear.app/settings/api",
        },
      },
      {
        title: "Paste the key below and save",
        body: "Keys start with lin_api_. Rotating invalidates the old one immediately.",
      },
    ],
    fields: [
      {
        key: "api_key",
        label: "API key",
        type: "secret",
        required: true,
        placeholder: "lin_api_…",
      },
      {
        key: "default_team",
        label: "Default team key",
        type: "text",
        required: false,
        placeholder: "CTX",
      },
    ],
  },
];

export function findSpec(id: string): IntegrationSpec | null {
  return INTEGRATION_SPECS.find((s) => s.id === id) ?? null;
}
