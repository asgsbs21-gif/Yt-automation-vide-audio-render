import { Router } from "express";
import { getAudios } from "../services/data.js";

const router = Router();

// GET /api/audios
router.get("/audios", (req, res) => {
  res.json(getAudios());
});

export default router;
