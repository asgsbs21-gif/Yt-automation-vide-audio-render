import { Router } from "express";
import { getLogs } from "../services/data.js";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// GET /api/logs
router.get("/logs", requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const jobType = req.query.jobType as string | undefined;

  let logs = getLogs();
  if (jobType) logs = logs.filter((l) => l.jobType === jobType);
  res.json(logs.slice(0, limit));
});

export default router;
