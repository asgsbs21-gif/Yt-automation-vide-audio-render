import { Router } from "express";
import { getAudios } from "../services/data.js";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// GET /api/audios
router.get("/audios", requireAuth, (req, res) => {
  const audios = getAudios();
  res.json(audios);
});

export default router;
