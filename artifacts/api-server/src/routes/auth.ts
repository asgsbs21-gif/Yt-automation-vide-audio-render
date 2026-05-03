import { Router } from "express";
import {
  generateAuthUrl,
  exchangeCode,
  isOAuthConfigured,
} from "../services/auth.js";
import { createAuthenticatedClient } from "../services/auth.js";
import { checkDriveConnected } from "../services/drive.js";
import { checkYouTubeConnected } from "../services/youtube.js";
import { addLog } from "../services/data.js";

const router = Router();

// GET /api/auth/status
router.get("/auth/status", async (req, res) => {
  const session = req.session as any;
  const tokens = session.tokens;
  const user = session.user;

  if (!tokens || !user) {
    // Not authenticated — return auth URL if OAuth is configured
    const authUrl = isOAuthConfigured()
      ? generateAuthUrl(req.headers.host)
      : null;

    res.json({
      authenticated: false,
      user: null,
      authUrl,
    });
    return;
  }

  // Check connectivity
  let driveConnected = false;
  let youtubeConnected = false;

  try {
    const auth = createAuthenticatedClient(tokens, req.headers.host);
    [driveConnected, youtubeConnected] = await Promise.all([
      checkDriveConnected(auth),
      checkYouTubeConnected(auth),
    ]);
  } catch {
    // tokens may be expired — clear session
    session.tokens = undefined;
    session.user = undefined;
    const authUrl = isOAuthConfigured()
      ? generateAuthUrl(req.headers.host)
      : null;
    res.json({ authenticated: false, user: null, authUrl });
    return;
  }

  res.json({
    authenticated: true,
    user: {
      email: user.email,
      name: user.name,
      picture: user.picture ?? null,
      driveConnected,
      youtubeConnected,
      driveVideoFolderId: session.driveVideoFolderId ?? null,
      driveAudioFolderId: session.driveAudioFolderId ?? null,
      driveOutputFolderId: session.driveOutputFolderId ?? null,
    },
    authUrl: null,
  });
});

// GET /api/auth/google — redirect to Google
router.get("/auth/google", (req, res) => {
  const url = generateAuthUrl(req.headers.host);
  res.redirect(url);
});

// GET /api/auth/callback — handle OAuth callback
router.get("/auth/callback", async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).json({ error: "No code provided" });
    return;
  }

  try {
    const { tokens, user } = await exchangeCode(code, req.headers.host);
    const session = req.session as any;
    session.tokens = tokens;
    session.user = user;

    addLog("upload", "success", `User authenticated: ${user.email}`);

    // Redirect to frontend root
    res.redirect("/");
  } catch (err) {
    addLog("upload", "error", "OAuth callback failed", String(err));
    res.redirect("/?error=auth_failed");
  }
});

// POST /api/auth/logout
router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "Logged out successfully" });
  });
});

export default router;
