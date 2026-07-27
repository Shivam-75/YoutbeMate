import Download from "../models/Download.js";
import {
  getVideoInfo as ytGetInfo,
  downloadVideo as ytDownload,
  getDirectStreamUrl as ytGetStreamUrl,
  spawnYtDlp,
  DEFAULT_FORMATS,
} from "../utils/ytdlp.js";
import {
  getTrendingVideos,
  searchYouTubeAPI,
  getVideoCategories,
} from "../utils/youtube.js";
import path from "path";
import os from "os";
import fs from "fs";
import mongoose from "mongoose";
import { exec } from "child_process";
import axios from "axios";

// ─── Download directory (mutable, persists while server runs) ─────────────────
let DOWNLOAD_DIR = path.join(os.homedir(), "Downloads", "VideoDownloader");

// ─── In-memory job tracking for polling ──────────────────────────────────────
// jobId → { progress, status, filePath, fileSize, error, downloadId }
const jobs = new Map();

// ─── Video Info ───────────────────────────────────────────────────────────────
export const getVideoInfo = async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, message: "URL required" });

  try {
    const info = await ytGetInfo(url);
    res.json({ success: true, data: info });
  } catch (err) {
    console.error("[getVideoInfo]", err.message);
    // Return fallback so frontend can still show quality picker
    res.json({
      success: false,
      message: err.message,
      data: {
        formats: DEFAULT_FORMATS,
        title: "",
        thumbnail: "",
        channel: "",
        duration: 0,
        url,
      },
    });
  }
};

// ─── Get Direct Stream URL (for client-side download) ─────────────────────────
export const getStreamUrl = async (req, res) => {
  const { url, resolution = "720" } = req.body || {};
  if (!url) return res.status(400).json({ success: false, message: "URL required" });

  const host = req.get("host") || "youtbemate.onrender.com";
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const encodedUrl = encodeURIComponent(url);
  const fallbackUrl = `${protocol}://${host}/api/video/file/video_${resolution}p.mp4?url=${encodedUrl}&res=${resolution}`;

  try {
    // 1. Try yt-dlp based extraction first
    let result = null;
    try {
      result = await ytGetStreamUrl(url, resolution);
    } catch (_) {}

    if (result && result.streamUrl) {
      return res.json({
        success: true,
        data: {
          streamUrl: result.streamUrl,
          title: result.title || "",
          thumbnail: result.thumbnail || "",
          channel: result.channel || "",
          duration: result.duration || 0,
          videoId: result.videoId || "",
        },
      });
    }

    // 2. Try Piped API directly (fast, no yt-dlp needed)
    const videoIdMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/))([\w-]{11})/i);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;

    if (videoId) {
      const pipedInstances = [
        "https://pipedapi.kavin.rocks",
        "https://pipedapi.mha.fi",
        "https://api.piped.privacydev.net",
      ];
      const targetHeight = parseInt(resolution) || 720;

      for (const inst of pipedInstances) {
        try {
          const pipedRes = await axios.get(`${inst}/streams/${videoId}`, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
            timeout: 6000,
          });
          const data = pipedRes.data;
          if (data && data.videoStreams && data.videoStreams.length > 0) {
            // Prefer combined audio+video streams
            let streams = data.videoStreams.filter(s => s.videoOnly === false && s.url);
            if (streams.length === 0) streams = data.videoStreams.filter(s => s.url);

            if (streams.length > 0) {
              let selected = streams.find(s => s.height === targetHeight);
              if (!selected) {
                const sorted = streams.sort((a, b) => (b.height || 0) - (a.height || 0));
                selected = sorted.find(s => (s.height || 0) <= targetHeight) || sorted[0];
              }
              if (selected && selected.url) {
                console.log(`[getStreamUrl] Got stream from Piped (${inst})`);
                return res.json({
                  success: true,
                  data: {
                    streamUrl: selected.url,
                    title: data.title || "",
                    thumbnail: data.thumbnailUrl || "",
                    channel: data.uploader || "",
                    duration: data.duration || 0,
                    videoId: videoId,
                  },
                });
              }
            }
          }
        } catch (pipedErr) {
          console.warn(`[getStreamUrl] Piped ${inst} failed:`, pipedErr.message);
        }
      }
    }

    // 3. Final fallback — return server proxy URL
    res.json({
      success: true,
      data: {
        streamUrl: fallbackUrl,
        title: "",
        thumbnail: "",
        channel: "",
        duration: 0,
        videoId: videoId || "",
      },
    });
  } catch (err) {
    res.json({
      success: true,
      data: {
        streamUrl: fallbackUrl,
        title: "",
        thumbnail: "",
        channel: "",
        duration: 0,
        videoId: "",
      },
    });
  }
};

// ─── Search ───────────────────────────────────────────────────────────────────
export const searchVideos = async (req, res) => {
  try {
    const { query, limit = 20 } = req.query;
    if (!query) return res.status(400).json({ success: false, message: "Query required" });
    const results = await searchYouTubeAPI(query, parseInt(limit));
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Trending ─────────────────────────────────────────────────────────────────
export const getTrending = async (req, res) => {
  try {
    const { regionCode = "IN", categoryId = "", maxResults = 20 } = req.query;
    const results = await getTrendingVideos({ regionCode, categoryId, maxResults: parseInt(maxResults) });
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Categories ───────────────────────────────────────────────────────────────
export const getCategories = async (req, res) => {
  try {
    const { regionCode = "IN" } = req.query;
    const categories = await getVideoCategories(regionCode);
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Start Download (Job-based & Render PRD Compliant) ──────────────────────
export const startDownload = async (req, res) => {
  const { url, resolution = "720", title, thumbnail, channel, duration, videoId, audioLang = "default", deviceId = "" } = req.body || {};
  
  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ success: false, message: "Invalid request. Parameter 'url' is required." });
  }

  const safeTitle = (title || "video").replace(/[^a-zA-Z0-9\u0900-\u097F ]/g, "").replace(/\s+/g, "_").slice(0, 60);
  const fileName = `${safeTitle}_${resolution}p.mp4`;

  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  let downloadId = null;

  try {
    const downloadRecord = await Download.create({
      videoId: videoId || Date.now().toString(),
      title: title || "Unknown",
      thumbnail: thumbnail || "",
      channel: channel || "",
      duration: duration || 0,
      resolution: `${resolution}p`,
      url,
      status: "downloading",
      deviceId: deviceId || "",
    });
    downloadId = downloadRecord._id.toString();
  } catch (dbErr) {
    console.warn("⚠️ Database log failed (proceeding with download):", dbErr.message);
  }

  // Set the job in-memory to track download progress regardless of DB status
  const jobContext = {
    progress: 0,
    status: "downloading",
    filePath: "",
    fileSize: 0,
    error: "",
    downloadId,
    proc: null,
    audioLang,
    lastDbProgress: 0,
    lastDbTime: 0,
    videoId: videoId || "",
    title: title || "Unknown",
    thumbnail: thumbnail || "",
    channel: channel || "",
    duration: duration || 0,
    resolution: `${resolution}p`,
    deviceId: deviceId || "",
  };
  jobs.set(jobId, jobContext);

  // Start download async (non-blocking)
  const outputFilename = `${downloadId || Date.now()}_${resolution}p.%(ext)s`;
  
  const proc = ytDownload(
    url,
    resolution,
    DOWNLOAD_DIR,
    outputFilename,
    audioLang,
    async (progress) => {
      const job = jobs.get(jobId);
      if (job) {
        job.progress = progress;
        // Throttled database writes: write every 5% progress or every 2 seconds to avoid overloading DB
        const now = Date.now();
        if (downloadId && (progress - job.lastDbProgress >= 5 || now - job.lastDbTime > 2000)) {
          job.lastDbProgress = progress;
          job.lastDbTime = now;
          try {
            await Download.findByIdAndUpdate(downloadId, { progress: Math.round(progress) });
          } catch (_) {}
        }
      }
    },
    async ({ filePath, fileSize }) => {
      if (downloadId) {
        try {
          await Download.findByIdAndUpdate(downloadId, {
            status: "completed", filePath, fileSize, progress: 100,
          });
        } catch (_) {}
      }
      const job = jobs.get(jobId);
      if (job) Object.assign(job, { progress: 100, status: "completed", filePath, fileSize, proc: null });
    },
    async (err) => {
      // If manually killed/paused, we don't treat it as a hard failure
      const job = jobs.get(jobId);
      if (job && job.status === "paused") return;

      if (downloadId) {
        try {
          await Download.findByIdAndUpdate(downloadId, {
            status: "failed", error: err.message,
          });
        } catch (_) {}
      }
      if (job) Object.assign(job, { status: "failed", error: err.message, proc: null });
    }
  );

  jobContext.proc = proc;

  // Construct instant Render stream URL per PRD spec
  const host = req.get("host") || "youtbemate.onrender.com";
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const encodedUrl = encodeURIComponent(url);
  const directUrl = `${protocol}://${host}/api/video/file/${encodeURIComponent(fileName)}?url=${encodedUrl}&res=${resolution}`;

  // Return Render PRD compliant response format instantly
  res.status(200).json({
    success: true,
    fileName,
    downloadUrl: directUrl,
    jobId,
    downloadId,
    streamUrl: directUrl,
  });
};

// ─── Pause Download ──────────────────────────────────────────────────────────
export const pauseDownload = async (req, res) => {
  const { jobId } = req.params; // Can be jobId or downloadId (_id)
  let job = jobs.get(jobId);
  let targetJobId = jobId;

  if (!job) {
    // Fallback to find by downloadId
    for (const [id, j] of jobs.entries()) {
      if (j.downloadId === jobId) {
        job = j;
        targetJobId = id;
        break;
      }
    }
  }

  if (!job) return res.status(404).json({ success: false, message: "Job not found" });
  if (job.status !== "downloading") return res.status(400).json({ success: false, message: "Job is not downloading" });

  if (job.proc) {
    try {
      job.status = "paused";
      job.proc.kill("SIGINT"); // Kill process gracefully so it saves partial files
      job.proc = null;
      if (job.downloadId) {
        await Download.findByIdAndUpdate(job.downloadId, { status: "paused" });
      }
      return res.json({ success: true, message: "Download paused", data: { progress: job.progress, status: job.status } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
  res.status(500).json({ success: false, message: "Process handle missing" });
};

// ─── Resume Download ─────────────────────────────────────────────────────────
export const resumeDownload = async (req, res) => {
  const { jobId } = req.params; // Can be jobId or downloadId (_id)
  let job = jobs.get(jobId);
  let targetJobId = jobId;

  if (!job) {
    // Fallback to find by downloadId
    for (const [id, j] of jobs.entries()) {
      if (j.downloadId === jobId) {
        job = j;
        targetJobId = id;
        break;
      }
    }
  }

  if (!job) return res.status(404).json({ success: false, message: "Job not found" });
  if (job.status !== "paused") return res.status(400).json({ success: false, message: "Job is not paused" });

  try {
    let url = "";
    let resolution = "720";
    if (job.downloadId) {
      const record = await Download.findById(job.downloadId);
      if (record) {
        url = record.url;
        resolution = record.resolution.replace("p", "");
      }
    }

    if (!url) return res.status(400).json({ success: false, message: "Could not retrieve download URL" });

    job.status = "downloading";
    if (job.downloadId) {
      await Download.findByIdAndUpdate(job.downloadId, { status: "downloading" });
    }

    const outputFilename = `${job.downloadId || Date.now()}_${resolution}p.%(ext)s`;
    
    const proc = ytDownload(
      url,
      resolution,
      DOWNLOAD_DIR,
      outputFilename,
      job.audioLang || "default",
      async (progress) => {
        job.progress = progress;
        const now = Date.now();
        if (job.downloadId && (progress - job.lastDbProgress >= 5 || now - job.lastDbTime > 2000)) {
          job.lastDbProgress = progress;
          job.lastDbTime = now;
          try {
            await Download.findByIdAndUpdate(job.downloadId, { progress: Math.round(progress) });
          } catch (_) {}
        }
      },
      async ({ filePath, fileSize }) => {
        if (job.downloadId) {
          try {
            await Download.findByIdAndUpdate(job.downloadId, {
              status: "completed", filePath, fileSize, progress: 100,
            });
          } catch (_) {}
        }
        Object.assign(job, { progress: 100, status: "completed", filePath, fileSize, proc: null });
      },
      async (err) => {
        if (job.status === "paused") return;
        if (job.downloadId) {
          try {
            await Download.findByIdAndUpdate(job.downloadId, {
              status: "failed", error: err.message,
            });
          } catch (_) {}
        }
        Object.assign(job, { status: "failed", error: err.message, proc: null });
      }
    );

    job.proc = proc;
    res.json({ success: true, message: "Download resumed", data: { progress: job.progress, status: job.status } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Poll Download Progress ───────────────────────────────────────────────────
export const getJobStatus = (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ success: false, message: "Job not found" });
  res.json({ success: true, data: job });
};

// ─── History ──────────────────────────────────────────────────────────────────
export const getHistory = async (req, res) => {
  const { page = 1, limit = 20, status, deviceId } = req.query;
  try {
    const filter = {};
    if (status) filter.status = status;
    if (deviceId) filter.deviceId = deviceId;
    
    // Check if database is fully connected (1 = connected)
    const isConnected = mongoose.connection.readyState === 1;

    let downloads = [];
    if (isConnected) {
      // Find history items from MongoDB. Wrap in a fast timeout fallback
      downloads = await Promise.race([
        Download.find(filter)
          .sort({ createdAt: -1 })
          .limit(parseInt(limit))
          .skip((parseInt(page) - 1) * parseInt(limit)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000))
      ]);
    }

    // Merge active in-memory jobs so they show up immediately
    const activeJobs = [];
    for (const [jobId, job] of jobs.entries()) {
      if (status && job.status !== status) continue;
      if (deviceId && job.deviceId && job.deviceId !== deviceId) continue;
      const alreadyListed = downloads.some((d) => d._id.toString() === job.downloadId);
      if (!alreadyListed) {
        activeJobs.push({
          _id: job.downloadId || jobId,
          videoId: job.videoId || "video",
          title: job.title || (job.filePath ? path.basename(job.filePath) : "Active Download"),
          thumbnail: job.thumbnail || "",
          channel: job.channel || "",
          duration: job.duration || 0,
          resolution: job.resolution || "720p",
          fileSize: job.fileSize || 0,
          filePath: job.filePath || "",
          status: job.status,
          progress: job.progress || 0,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Merge active jobs to the top of the history list
    const combined = [...activeJobs, ...downloads];
    res.json({
      success: true,
      data: combined,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: combined.length },
    });
  } catch (err) {
    // If DB is offline or times out, gracefully return in-memory jobs only
    const activeJobs = [];
    for (const [jobId, job] of jobs.entries()) {
      if (status && job.status !== status) continue;
      if (deviceId && job.deviceId && job.deviceId !== deviceId) continue;
      activeJobs.push({
        _id: job.downloadId || jobId,
        videoId: job.videoId || "video",
        title: job.title || (job.filePath ? path.basename(job.filePath) : "Active Download"),
        thumbnail: job.thumbnail || "",
        channel: job.channel || "",
        duration: job.duration || 0,
        resolution: job.resolution || "720p",
        fileSize: job.fileSize || 0,
        filePath: job.filePath || "",
        status: job.status,
        progress: job.progress || 0,
        createdAt: new Date().toISOString(),
      });
    }
    res.json({
      success: true,
      data: activeJobs,
      pagination: { page: 1, limit: 20, total: activeJobs.length },
    });
  }
};

export const deleteHistory = async (req, res) => {
  try {
    const { id } = req.params;
    let deleted = false;
    
    // 1. Terminate and clean up active download job if running
    let foundJobKey = null;
    for (const [jobId, job] of jobs.entries()) {
      if (jobId === id || job.downloadId === id) {
        foundJobKey = jobId;
        break;
      }
    }
    
    if (foundJobKey) {
      const activeJob = jobs.get(foundJobKey);
      if (activeJob) {
        if (activeJob.proc) {
          try {
            activeJob.proc.kill("SIGKILL");
          } catch (_) {}
        }
        if (activeJob.filePath && fs.existsSync(activeJob.filePath)) {
          try {
            fs.unlinkSync(activeJob.filePath);
          } catch (_) {}
        }
      }
      jobs.delete(foundJobKey);
      deleted = true;
    }

    // 2. Clean up database record
    try {
      const isConnected = mongoose.connection.readyState === 1;
      if (isConnected) {
        const item = await Download.findById(id);
        if (item) {
          if (item.filePath && fs.existsSync(item.filePath)) {
            try {
              fs.unlinkSync(item.filePath);
            } catch (_) {}
          }
          await Download.findByIdAndDelete(id);
          deleted = true;
        }
      }
    } catch (dbErr) {
      console.warn("Database record delete failed:", dbErr.message);
    }

    if (deleted) {
      res.json({ success: true, message: "Deleted successfully" });
    } else {
      res.status(404).json({ success: false, message: "Download not found" });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const clearHistory = async (req, res) => {
  try {
    await Download.deleteMany({});
    res.json({ success: true, message: "History cleared" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Storage ──────────────────────────────────────────────────────────────────
export const getStorageInfo = async (req, res) => {
  try {
    const { execSync } = await import("child_process");
    let drives = [];

    if (process.platform === "win32") {
      let success = false;
      try {
        const result = execSync("wmic logicaldisk get Caption,FreeSpace,Size,VolumeName /format:csv", { encoding: "utf8" });
        const lines = result.trim().split("\n").filter(l => l.trim() && !l.startsWith("Node"));
        for (const line of lines) {
          const parts = line.split(",");
          if (parts.length >= 5) {
            const [, caption, freeSpace, size, volumeName] = parts;
            if (caption && size && parseInt(size) > 0) {
              drives.push({
                path: caption.trim() + "\\",
                name: volumeName?.trim() || caption.trim(),
                totalSize: parseInt(size) || 0,
                freeSize: parseInt(freeSpace) || 0,
                usedSize: (parseInt(size) || 0) - (parseInt(freeSpace) || 0),
              });
              success = true;
            }
          }
        }
      } catch (_) {}

      if (!success) {
        try {
          const psResult = execSync(
            'powershell -Command "Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter, SizeRemaining, Size, FriendlyName | ConvertTo-Json -Compress"',
            { encoding: "utf8" }
          );
          if (psResult.trim()) {
            let volumes = JSON.parse(psResult.trim());
            if (!Array.isArray(volumes)) volumes = [volumes];
            for (const vol of volumes) {
              if (vol.DriveLetter && vol.Size > 0) {
                const total = vol.Size;
                const free = vol.SizeRemaining;
                drives.push({
                  path: vol.DriveLetter + ":\\",
                  name: vol.FriendlyName || (vol.DriveLetter + ":"),
                  totalSize: total,
                  freeSize: free,
                  usedSize: total - free,
                });
              }
            }
          }
        } catch (_) {}
      }
    } else {
      try {
        const result = execSync("df -B1 /", { encoding: "utf8" });
        const parts = result.trim().split("\n")[1].split(/\s+/);
        drives.push({ path: "/", name: "Internal", totalSize: parseInt(parts[1]) || 0, freeSize: parseInt(parts[3]) || 0, usedSize: parseInt(parts[2]) || 0 });
      } catch (_) {}
    }

    let downloadFolderStats = { exists: false, fileCount: 0, totalSize: 0 };
    if (fs.existsSync(DOWNLOAD_DIR)) {
      const files = fs.readdirSync(DOWNLOAD_DIR);
      let totalSize = 0;
      for (const file of files) {
        try { totalSize += fs.statSync(path.join(DOWNLOAD_DIR, file)).size; } catch (_) {}
      }
      downloadFolderStats = { exists: true, fileCount: files.length, totalSize };
    }

    res.json({ success: true, data: { drives, downloadDir: DOWNLOAD_DIR, downloadFolderStats } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Download Directory Management ───────────────────────────────────────────
export const getDownloadDir = (req, res) => {
  res.json({ success: true, data: { path: DOWNLOAD_DIR } });
};

export const setDownloadDir = (req, res) => {
  try {
    const { dirPath } = req.body;
    if (!dirPath) return res.status(400).json({ success: false, message: "dirPath required" });
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    DOWNLOAD_DIR = dirPath;
    res.json({ success: true, message: "Download directory updated", data: { path: DOWNLOAD_DIR } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getQuickPaths = (req, res) => {
  const home = os.homedir();
  const quickPaths = [
    { name: "🎬 VideoDownloader (Default)", path: path.join(home, "Downloads", "VideoDownloader") },
    { name: "📥 Downloads", path: path.join(home, "Downloads") },
    { name: "🖥 Desktop", path: path.join(home, "Desktop") },
    { name: "📄 Documents", path: path.join(home, "Documents") },
    { name: "🎞 Videos", path: path.join(home, "Videos") },
    { name: "🖼 Pictures", path: path.join(home, "Pictures") },
  ];
  res.json({ success: true, data: quickPaths, current: DOWNLOAD_DIR });
};

// ─── Stream Downloaded File (Disk or Dynamic Proxy Stream) ───────────────────
export const streamFile = async (req, res) => {
  const { filename } = req.params;
  const videoUrl = req.query.url;
  const resolution = req.query.res || "720";

  const filePath = path.join(DOWNLOAD_DIR, filename);

  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Accept-Ranges", "bytes");
    return res.sendFile(filePath);
  }

  // Fallback search in DOWNLOAD_DIR for matching filenames or downloadId prefix
  if (fs.existsSync(DOWNLOAD_DIR)) {
    try {
      const files = fs.readdirSync(DOWNLOAD_DIR);
      const cleanName = filename.split(/[?#]/)[0];
      const nameWithoutExt = cleanName.replace(/\.[^/.]+$/, "");

      const matched = files.find(f => 
        f === cleanName || 
        f.startsWith(nameWithoutExt) || 
        cleanName.startsWith(f.replace(/\.[^/.]+$/, ""))
      );

      if (matched) {
        const matchedPath = path.join(DOWNLOAD_DIR, matched);
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Disposition", `attachment; filename="${matched}"`);
        return res.sendFile(matchedPath);
      }
    } catch (_) {}
  }

  // Live stream proxy fallback if file not pre-saved on disk yet
  if (videoUrl) {
    try {
      console.log(`[streamFile] Proxying live video stream for ${videoUrl}...`);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Accept-Ranges", "bytes");

      // 1. Try Piped API for direct stream URL
      let directUrl = "";
      const videoIdMatch = videoUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/))([\w-]{11})/i);
      const vid = videoIdMatch ? videoIdMatch[1] : null;

      if (vid) {
        const pipedInstances = [
          "https://pipedapi.kavin.rocks",
          "https://pipedapi.mha.fi",
          "https://api.piped.privacydev.net",
        ];
        const targetH = parseInt(resolution) || 720;
        for (const inst of pipedInstances) {
          try {
            const pipedRes = await axios.get(`${inst}/streams/${vid}`, {
              headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
              timeout: 6000,
            });
            if (pipedRes.data && pipedRes.data.videoStreams) {
              let streams = pipedRes.data.videoStreams.filter(s => s.videoOnly === false && s.url);
              if (streams.length === 0) streams = pipedRes.data.videoStreams.filter(s => s.url);
              if (streams.length > 0) {
                let sel = streams.find(s => s.height === targetH);
                if (!sel) {
                  const sorted = streams.sort((a, b) => (b.height || 0) - (a.height || 0));
                  sel = sorted.find(s => (s.height || 0) <= targetH) || sorted[0];
                }
                if (sel && sel.url) {
                  directUrl = sel.url;
                  console.log(`[streamFile] Got Piped stream from ${inst}`);
                  break;
                }
              }
            }
          } catch (_) {}
        }
      }

      // 2. Try yt-dlp stream URL extraction
      if (!directUrl) {
        try {
          const streamResult = await ytGetStreamUrl(videoUrl, resolution);
          if (streamResult && streamResult.streamUrl) {
            directUrl = streamResult.streamUrl;
          }
        } catch (_) {}
      }

      if (directUrl) {
        const streamResponse = await axios({
          method: "get",
          url: directUrl,
          responseType: "stream",
          timeout: 30000,
          headers: {
            "User-Agent": "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
          }
        });
        if (streamResponse.headers["content-length"]) {
          res.setHeader("Content-Length", streamResponse.headers["content-length"]);
        }
        return streamResponse.data.pipe(res);
      }

      // 3. Pipe yt-dlp stdout directly into res
      console.log(`[streamFile] Spawning yt-dlp stdout stream for ${videoUrl}...`);
      const proc = spawnYtDlp([
        videoUrl,
        "-f", `bestvideo[height<=${resolution}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${resolution}]+bestaudio/best`,
        "--no-playlist",
        "--no-check-certificate",
        "-o", "-"
      ]);

      proc.stdout.pipe(res);

      proc.on("error", (e) => {
        console.error("[streamFile] yt-dlp spawn error:", e.message);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: "Video stream failed" });
        }
      });
      return;
    } catch (err) {
      console.warn("[streamFile] Live stream proxy error:", err.message);
    }
  }

  res.status(404).json({ success: false, message: "File not found. Try a different resolution or video." });
};

export const openStorageFolder = (req, res) => {
  try {
    const { folderPath } = req.body;
    const targetDir = folderPath || DOWNLOAD_DIR;
    
    if (!fs.existsSync(targetDir)) {
      return res.status(400).json({ success: false, message: "Folder does not exist" });
    }

    let command = "";
    if (process.platform === "win32") {
      command = `explorer "${targetDir}"`;
    } else if (process.platform === "darwin") {
      command = `open "${targetDir}"`;
    } else {
      command = `xdg-open "${targetDir}"`;
    }

    exec(command);
    res.json({ success: true, message: "Folder opened successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
