import express from "express";
import { config } from "dotenv";
import compression from "compression";
import cookieParser from "cookie-parser";
import Db from "./src/database/Db.js";
import cors from "cors";
import morgan from "morgan";
import videoRoutes from "./src/routes/videoRoutes.js";

config();

const PORT = process.env.PORT || 5000;

const app = express();

app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan("dev"));

// Routes
app.use("/api/video", videoRoutes);

import { fileURLToPath } from "url";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import ffmpegPath from "ffmpeg-static";

app.get("/api/diagnostics", (req, res) => {
  const currentFilename = fileURLToPath(import.meta.url);
  const currentDirname = path.dirname(currentFilename);

  const result = {
    platform: process.platform,
    cwd: process.cwd(),
    __dirname: currentDirname,
    binExists: false,
    binFiles: [],
    ytdlpPath: "",
    ytdlpRun: "",
    ffmpegPath: "",
    ffmpegRun: "",
    errors: {}
  };

  try {
    const relativeBinDir = path.join(currentDirname, "bin");
    result.binPathTested = relativeBinDir;
    if (fs.existsSync(relativeBinDir)) {
      result.binExists = true;
      result.binFiles = fs.readdirSync(relativeBinDir).map(file => {
        const filePath = path.join(relativeBinDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          size: stats.size,
          mode: stats.mode.toString(8)
        };
      });
    }
  } catch (e) {
    result.errors.binDir = e.message;
  }

  // Search ytdlp
  try {
    const relativeBinDir = path.join(currentDirname, "bin");
    const paths = [
      path.join(relativeBinDir, "yt-dlp"),
      path.join(relativeBinDir, "yt-dlp.exe"),
      "yt-dlp",
    ];
    for (const p of paths) {
      if (fs.existsSync(p) || p === "yt-dlp") {
        try {
          const out = execSync(`"${p}" --version`, { timeout: 3000 }).toString().trim();
          result.ytdlpPath = p;
          result.ytdlpRun = out;
          break;
        } catch (err) {
          result.errors[`ytdlp_${p}`] = err.message;
        }
      }
    }
  } catch (e) {
    result.errors.ytdlpGeneral = e.message;
  }

  // Search ffmpeg
  try {
    const paths = [
      ffmpegPath,
      "ffmpeg"
    ];
    for (const p of paths) {
      if (p) {
        try {
          const out = execSync(`"${p}" -version`, { timeout: 3000 }).toString().split("\n")[0].trim();
          result.ffmpegPath = p;
          result.ffmpegRun = out;
          break;
        } catch (err) {
          result.errors[`ffmpeg_${p}`] = err.message;
        }
      }
    }
  } catch (e) {
    result.errors.ffmpegGeneral = e.message;
  }

  res.json(result);
});

app.get("/", (req, res) => {
  res.json({ success: true, message: "🎬 Video Downloader API Running!" });
});

// Start server immediately — DB connects in background (no blocking)
app.listen(PORT, "0.0.0.0", () =>
  console.log("🚀 Server running at http://localhost:" + PORT)
);
Db().catch((err) => console.error("⚠️ DB connect failed:", err.message));
