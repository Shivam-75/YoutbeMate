import express from "express";
import {
  getVideoInfo,
  getStreamUrl,
  searchVideos,
  getTrending,
  getCategories,
  startDownload,
  getJobStatus,
  pauseDownload,
  resumeDownload,
  getHistory,
  deleteHistory,
  clearHistory,
  getStorageInfo,
  getDownloadDir,
  setDownloadDir,
  getQuickPaths,
  streamFile,
  openStorageFolder,
} from "../controller/videoController.js";

const router = express.Router();

// YouTube Data API
router.get("/trending", getTrending);
router.get("/search", searchVideos);
router.get("/categories", getCategories);

// Video info (yt-dlp)
router.post("/info", getVideoInfo);

// Stream URL for client-side download (mobile app)
router.post("/stream-url", getStreamUrl);

// Download — job based (polling)
router.post("/download", startDownload);
router.get("/download/:jobId/status", getJobStatus);
router.post("/download/:jobId/pause", pauseDownload);
router.post("/download/:jobId/resume", resumeDownload);

// Downloaded files streaming
router.get("/file/:filename", streamFile);

// History
router.get("/history", getHistory);
router.delete("/history/clear", clearHistory);
router.delete("/history/:id", deleteHistory);

// Storage & directory management
router.get("/storage", getStorageInfo);
router.get("/storage/dir", getDownloadDir);
router.post("/storage/dir", setDownloadDir);
router.get("/storage/quick-paths", getQuickPaths);
router.post("/storage/open", openStorageFolder);

export default router;
