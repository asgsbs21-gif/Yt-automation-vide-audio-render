import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import videosRouter from "./videos.js";
import audiosRouter from "./audios.js";
import downloadRouter from "./download.js";
import processRouter from "./process.js";
import queueRouter from "./queue.js";
import settingsRouter from "./settings.js";
import statusRouter from "./status.js";
import logsRouter from "./logs.js";
import uploadRouter from "./upload.js";
import statsRouter from "./stats.js";
import proxyRouter from "./proxy.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(videosRouter);
router.use(audiosRouter);
router.use(downloadRouter);
router.use(processRouter);
router.use(queueRouter);
router.use(settingsRouter);
router.use(statusRouter);
router.use(logsRouter);
router.use(uploadRouter);
router.use(statsRouter);
router.use(proxyRouter);

export default router;
