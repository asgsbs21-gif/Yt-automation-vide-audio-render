import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { getSettings } from "./data.js";

// ── Scopes ────────────────────────────────────────────────────────────────────

export const SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
];

// ── Global tokens (for scheduler use) ────────────────────────────────────────

export interface TokenSet {
  access_token: string;
  refresh_token?: string | null;
  expiry_date?: number | null;
}

let _globalTokens: TokenSet | null = null;

export function setGlobalTokens(tokens: TokenSet | null): void {
  _globalTokens = tokens;
}

export function getGlobalTokens(): TokenSet | null {
  return _globalTokens;
}

// ── Resolve credentials (settings.json first, then env vars) ─────────────────

function resolveCredentials(): { clientId: string; clientSecret: string } {
  const settings = getSettings();
  const clientId =
    (settings.googleClientId && settings.googleClientId.trim()) ||
    process.env["YOUTUBE_CLIENT_ID"] ||
    "";
  const clientSecret =
    (settings.googleClientSecret && settings.googleClientSecret.trim()) ||
    process.env["YOUTUBE_CLIENT_SECRET"] ||
    "";
  return { clientId, clientSecret };
}

// ── Build redirect URI ────────────────────────────────────────────────────────

export function getRedirectUri(host?: string): string {
  if (process.env["GOOGLE_REDIRECT_URI"]) {
    return process.env["GOOGLE_REDIRECT_URI"];
  }
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) {
    const primary = domains.split(",")[0].trim();
    return `https://${primary}/api/auth/callback`;
  }
  const port = process.env["PORT"] || "3000";
  return `http://localhost:${port}/api/auth/callback`;
}

// ── Create OAuth2 client ──────────────────────────────────────────────────────

export function createOAuth2Client(host?: string): OAuth2Client {
  const { clientId, clientSecret } = resolveCredentials();
  const redirectUri = getRedirectUri(host);
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// ── Generate auth URL ─────────────────────────────────────────────────────────

export function generateAuthUrl(host?: string): string {
  const client = createOAuth2Client(host);
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

// ── Exchange code for tokens ──────────────────────────────────────────────────

export interface UserInfo {
  email: string;
  name: string;
  picture: string | null;
}

export async function exchangeCode(
  code: string,
  host?: string
): Promise<{ tokens: TokenSet; user: UserInfo }> {
  const client = createOAuth2Client(host);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();

  const tokenSet: TokenSet = {
    access_token: tokens.access_token ?? "",
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
  };

  setGlobalTokens(tokenSet);

  return {
    tokens: tokenSet,
    user: {
      email: data.email ?? "",
      name: data.name ?? "",
      picture: data.picture ?? null,
    },
  };
}

// ── Create authenticated client from stored tokens ────────────────────────────

export function createAuthenticatedClient(
  tokens: TokenSet,
  host?: string
): OAuth2Client {
  const client = createOAuth2Client(host);
  client.setCredentials(tokens);
  return client;
}

// ── Check if credentials are configured ──────────────────────────────────────

export function isOAuthConfigured(): boolean {
  const { clientId, clientSecret } = resolveCredentials();
  return Boolean(clientId && clientSecret);
}
