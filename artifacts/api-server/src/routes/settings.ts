import { Router } from "express";
import { getSettings, saveSettings } from "../services/data.js";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// GET /api/settings
router.get("/settings", requireAuth, (req, res) => {
  res.json(getSettings());
});

// PATCH /api/settings
router.patch("/settings", requireAuth, (req, res) => {
  const current = getSettings();
  const patch = req.body as Partial<typeof current>;
  const updated = { ...current, ...patch };
  saveSettings(updated);
  res.json(updated);
});

export default router;
