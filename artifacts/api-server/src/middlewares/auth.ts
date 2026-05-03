import type { Request, Response, NextFunction } from "express";
import type { TokenSet } from "../services/auth.js";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = req.session as any;
  if (!session?.tokens?.access_token) {
    res.status(401).json({ error: "Not authenticated. Please login with Google." });
    return;
  }
  next();
}

export function getSessionTokens(req: Request): TokenSet | null {
  const session = req.session as any;
  return session?.tokens ?? null;
}
