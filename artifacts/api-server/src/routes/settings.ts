import { Router } from "express";
import { getSettings, saveSettings } from "../services/data.js";

const router = Router();

// GET /api/settings
router.get("/settings", (req, res) => {
  res.json(getSettings());
});

// PATCH /api/settings
router.patch("/settings", (req, res) => {
  const current = getSettings();
  const patch = req.body as Partial<typeof current>;
  const updated = { ...current, ...patch };
  saveSettings(updated);
  res.json(updated);
});

export default router;
