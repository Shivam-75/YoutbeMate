import { exec, execSync, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

function os_homedir() {
  return process.env.USERPROFILE || process.env.HOME || "C:\\Users\\Default";
}

// ─── Find executable helper ───────────────────────────────────────────────────
function findExecutable(name) {
  // 1. Try local bin folder first (downloaded during postinstall)
  const localBin = path.join(__dirname, "..", "..", "bin", process.platform === "win32" ? `${name}.exe` : name);
  if (fs.existsSync(localBin)) {
    console.log(`✅ ${name} detected successfully at local bin:`, localBin);
    return localBin;
  }

  // 2. Try command directly in case it is already in global system PATH
  try {
    const versionArg = name === "ffmpeg" ? "-version" : "--version";
    execSync(`"${name}" ${versionArg}`, { stdio: "ignore", timeout: 2000 });
    console.log(`✅ ${name} is globally available via PATH`);
    return name;
  } catch (_) {}

  // 3. List of standard candidates
  const candidates = [
    // ── Linux/Render pip install paths ────────────────────────────────
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    path.join(os_homedir(), ".local", "bin", name),
    `/opt/render/.local/bin/${name}`,
    `/opt/venv/bin/${name}`,
    // ── Windows pip/Python paths ──────────────────────────────────────
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312", "Scripts", `${name}.exe`),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python311", "Scripts", `${name}.exe`),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python310", "Scripts", `${name}.exe`),
    `C:\\Python312\\Scripts\\${name}.exe`,
    `C:\\Python311\\Scripts\\${name}.exe`,
    `C:\\Python310\\Scripts\\${name}.exe`,
    path.join(os_homedir(), "AppData", "Local", "Microsoft", "WindowsApps", `${name}.exe`),
    path.join(os_homedir(), "AppData", "Roaming", "Python", "Python312", "Scripts", `${name}.exe`),
  ];

  // 3. Dynamic Winget package folder scanner
  const wingetBase = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
  if (fs.existsSync(wingetBase)) {
    try {
      const dirs = fs.readdirSync(wingetBase);
      for (const d of dirs) {
        if (d.toLowerCase().includes(name.toLowerCase())) {
          // Direct check
          const direct = path.join(wingetBase, d, `${name}.exe`);
          if (fs.existsSync(direct)) candidates.push(direct);

          // Bin check
          const binPath = path.join(wingetBase, d, "bin", `${name}.exe`);
          if (fs.existsSync(binPath)) candidates.push(binPath);

          // Subfolders check (e.g. ffmpeg-version-win64-gpl/bin/ffmpeg.exe)
          const pkgDir = path.join(wingetBase, d);
          const subs = fs.readdirSync(pkgDir);
          for (const sub of subs) {
            const subPath = path.join(pkgDir, sub);
            try {
              if (fs.statSync(subPath).isDirectory()) {
                const subBin = path.join(subPath, "bin", `${name}.exe`);
                if (fs.existsSync(subBin)) candidates.push(subBin);

                const subDirect = path.join(subPath, `${name}.exe`);
                if (fs.existsSync(subDirect)) candidates.push(subDirect);
              }
            } catch (_) {}
          }
        }
      }
    } catch (_) {}
  }

  // 4. Test candidates and return the first working path
  for (const cmd of candidates) {
    try {
      const versionArg = name === "ffmpeg" ? "-version" : "--version";
      execSync(`"${cmd}" ${versionArg}`, { stdio: "ignore", timeout: 3000 });
      console.log(`✅ ${name} detected successfully at:`, cmd);
      return cmd;
    } catch (_) {}
  }

  return null;
}

const YTDLP_CMD = findExecutable("yt-dlp") || "yt-dlp";
const FFMPEG_CMD = findExecutable("ffmpeg");

// Fallback format configurations
export const DEFAULT_FORMATS = [
  { formatId: "bestvideo[height<=360]+bestaudio/best[height<=360]", label: "360p", height: 360, filesize: 0, ext: "mp4" },
  { formatId: "bestvideo[height<=480]+bestaudio/best[height<=480]", label: "480p", height: 480, filesize: 0, ext: "mp4" },
  { formatId: "bestvideo[height<=720]+bestaudio/best[height<=720]", label: "720p", height: 720, filesize: 0, ext: "mp4" },
  { formatId: "bestvideo[height<=1080]+bestaudio/best[height<=1080]", label: "1080p", height: 1080, filesize: 0, ext: "mp4" },
];

// ─── Cobalt & Invidious Fallbacks ─────────────────────────────────────────────

async function getHealthyInvidiousInstances() {
  try {
    console.log("[Invidious] Fetching active instances from invidious.io...");
    const res = await axios.get("https://api.invidious.io/instances.json", { timeout: 10000 });
    const data = res.data;
    
    const active = [];
    if (Array.isArray(data)) {
      for (const entry of data) {
        const info = entry[1];
        if (info && info.type === "https" && info.monitor && info.monitor.down === false && info.monitor.enabled === true) {
          active.push({
            uri: info.uri,
            uptime: info.monitor.uptime || 0
          });
        }
      }
    }
    active.sort((a, b) => b.uptime - a.uptime);
    return active.slice(0, 10).map(i => i.uri);
  } catch (err) {
    console.warn("[Invidious] Failed to fetch live instances, falling back to defaults:", err.message);
    return [
      "https://invidious.projectsegfau.lt",
      "https://invidious.nerdvpn.de",
      "https://invidious.tiekoetter.com",
      "https://yewtu.be"
    ];
  }
}

async function getInvidiousVideoInfo(videoId) {
  const instances = await getHealthyInvidiousInstances();
  for (const instance of instances) {
    try {
      console.log(`[Invidious] Fetching metadata from ${instance} for video ${videoId}...`);
      const response = await axios.get(`${instance}/api/v1/videos/${videoId}?local=true`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        timeout: 10000
      });
      const info = response.data;
      if (info && info.title) {
        return {
          videoId: info.videoId,
          title: info.title,
          thumbnail: info.videoThumbnails?.find(t => t.quality === "high" || t.quality === "medium")?.url || info.videoThumbnails?.[0]?.url || "",
          channel: info.author || "",
          duration: info.lengthSeconds || 0,
          viewCount: info.viewCount || 0,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          formats: info.formatStreams?.map(f => ({
            formatId: f.itag,
            label: f.qualityLabel,
            height: parseInt(f.qualityLabel) || 360,
            filesize: 0,
            ext: "mp4"
          })) || DEFAULT_FORMATS,
          streamUrl: ""
        };
      }
    } catch (err) {
      console.warn(`[Invidious] Instance ${instance} metadata failed:`, err.message);
    }
  }
  throw new Error("All public Invidious instances failed to fetch video metadata.");
}

async function getCobaltDownloadUrl(videoUrl, resolution) {
  const payload = {
    url: videoUrl,
    vQuality: resolution || "720",
    filenamePattern: "classic"
  };
  const endpoints = [
    "https://api.cobalt.tools/api/json",
    "https://co.wuk.sh/api/json"
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await axios.post(endpoint, payload, {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        timeout: 15000
      });
      if (response.data && response.data.url) {
        return response.data.url;
      }
    } catch (err) {
      console.warn(`[Cobalt] endpoint ${endpoint} failed:`, err.message);
    }
  }
  throw new Error("All fallback extraction APIs failed to parse the video link.");
}

async function getInvidiousDownloadUrl(videoUrl, resolution) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = videoUrl.match(regExp);
  const videoId = (match && match[2].length === 11) ? match[2] : null;
  if (!videoId) {
    throw new Error("Could not extract YouTube video ID from URL");
  }

  const instances = await getHealthyInvidiousInstances();
  for (const instance of instances) {
    try {
      console.log(`[Invidious] Querying stream from ${instance} for video ${videoId}...`);
      const response = await axios.get(`${instance}/api/v1/videos/${videoId}?local=true`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        timeout: 10000
      });
      const info = response.data;
      if (info && info.formatStreams && info.formatStreams.length > 0) {
        const targetLabel = `${resolution}p`;
        let matchStream = info.formatStreams.find(s => s.qualityLabel === targetLabel);
        if (!matchStream) {
          matchStream = info.formatStreams.find(s => s.type.includes("mp4")) || info.formatStreams[0];
        }
        if (matchStream && matchStream.url) {
          let finalUrl = matchStream.url;
          if (finalUrl.startsWith("/")) {
            finalUrl = `${instance}${finalUrl}`;
          }
          return finalUrl;
        }
      }
    } catch (err) {
      console.warn(`[Invidious] Instance ${instance} stream failed:`, err.message);
    }
  }
  throw new Error("All public Invidious instances failed to extract direct video stream.");
}

async function downloadFromUrl(streamUrl, destPath, onProgress, onComplete, onError, mockProc) {
  const controller = new AbortController();
  mockProc.abortController = controller;

  try {
    const response = await axios({
      method: "get",
      url: streamUrl,
      responseType: "stream",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    const totalBytes = parseInt(response.headers["content-length"], 10) || 0;
    let downloadedBytes = 0;
    const file = fs.createWriteStream(destPath);
    
    response.data.pipe(file);

    response.data.on("data", (chunk) => {
      downloadedBytes += chunk.length;
      if (totalBytes > 0) {
        const percent = (downloadedBytes / totalBytes) * 100;
        onProgress?.(parseFloat(percent.toFixed(1)));
      }
    });

    file.on("finish", () => {
      file.close();
      const fileSize = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;
      onComplete?.({ filePath: destPath, fileSize });
    });

    file.on("error", (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      onError?.(err);
    });

  } catch (err) {
    fs.unlink(destPath, () => {});
    onError?.(err);
  }
}

async function runFallbackDownloader(url, resolution, outputPath, onProgress, onComplete, onError, mockProc) {
  console.log("[downloadVideo] Starting Cobalt API extraction...");
  try {
    const cobaltUrl = await getCobaltDownloadUrl(url, resolution);
    console.log(`[downloadVideo] Cobalt extraction success, downloading from: ${cobaltUrl}`);
    await downloadFromUrl(cobaltUrl, outputPath, onProgress, onComplete, async (fallbackErr) => {
      console.warn(`[downloadVideo] Cobalt download failed: ${fallbackErr.message}. Trying Invidious fallback...`);
      await tryInvidiousFallback();
    }, mockProc);
  } catch (err) {
    console.warn(`[downloadVideo] Cobalt extraction failed: ${err.message}. Trying Invidious fallback...`);
    await tryInvidiousFallback();
  }

  async function tryInvidiousFallback() {
    try {
      const invidiousUrl = await getInvidiousDownloadUrl(url, resolution);
      console.log(`[downloadVideo] Invidious extraction success, downloading from: ${invidiousUrl}`);
      await downloadFromUrl(invidiousUrl, outputPath, onProgress, onComplete, (invErr) => {
        onError?.(new Error(`All download methods failed. Last error: ${invErr.message}`));
      }, mockProc);
    } catch (invErr) {
      onError?.(new Error(`All extraction methods failed. Last error: ${invErr.message}`));
    }
  }
}

/**
 * Get video info from YouTube URL
 */
export const getVideoInfo = async (url) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  const videoId = (match && match[2].length === 11) ? match[2] : null;

  try {
    const { stdout } = await execAsync(
      `"${YTDLP_CMD}" --dump-json --no-check-certificate --no-playlist --socket-timeout 30 --user-agent "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36" --extractor-args "youtube:player-client=ios,tv_embedded,mweb" "${url}"`,
      { timeout: 60000 }
    );
    const info = JSON.parse(stdout.trim());

    const formats = [];
    const seen = new Set();

    if (info.formats) {
      for (const fmt of info.formats) {
        if (fmt.vcodec !== "none" && fmt.height) {
          const label = `${fmt.height}p`;
          if (!seen.has(label)) {
            seen.add(label);
            formats.push({
              formatId: fmt.format_id,
              label,
              height: fmt.height,
              filesize: fmt.filesize || fmt.filesize_approx || 0,
              ext: fmt.ext || "mp4",
            });
          }
        }
      }
    }

    const finalFormats = formats.length > 0
      ? formats.sort((a, b) => a.height - b.height)
      : DEFAULT_FORMATS;

    const bestCombined = info.formats
      ? info.formats.find(f => f.vcodec !== "none" && f.acodec !== "none" && f.url)
      : null;
    const streamUrl = bestCombined ? bestCombined.url : "";

    return {
      videoId: info.id,
      title: info.title,
      thumbnail: info.thumbnail || (info.thumbnails?.at(-1)?.url) || "",
      channel: info.uploader || info.channel || "",
      duration: info.duration || 0,
      viewCount: info.view_count || 0,
      url: info.webpage_url || url,
      formats: finalFormats,
      streamUrl,
    };
  } catch (err) {
    console.warn(`[getVideoInfo] yt-dlp failed: ${err.message}. Attempting Invidious fallback...`);
    if (videoId) {
      try {
        const info = await getInvidiousVideoInfo(videoId);
        return info;
      } catch (fallbackErr) {
        console.error(`[getVideoInfo] Invidious fallback also failed:`, fallbackErr.message);
      }
    }
    return {
      videoId: videoId || "",
      title: "YouTube Video",
      thumbnail: "",
      channel: "",
      duration: 0,
      viewCount: 0,
      url,
      formats: DEFAULT_FORMATS,
      streamUrl: "",
    };
  }
};

/**
 * Download video — returns the spawn process to support pausing/resuming
 */
export const downloadVideo = (url, resolution, outputDir, outputFilename, audioLang, onProgress, onComplete, onError) => {
  const outputPath = path.join(outputDir, outputFilename);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let useFallback = false;
  if (path.isAbsolute(YTDLP_CMD)) {
    if (!fs.existsSync(YTDLP_CMD)) {
      console.log(`[downloadVideo] yt-dlp binary at ${YTDLP_CMD} does not exist. Forcing fallback...`);
      useFallback = true;
    }
  } else {
    try {
      execSync(`"${YTDLP_CMD}" --version`, { stdio: "ignore", timeout: 3000 });
    } catch (_) {
      console.log("[downloadVideo] Global yt-dlp not found or not executable. Forcing fallback...");
      useFallback = true;
    }
  }

  const mockProc = {
    kill: () => {
      if (mockProc.abortController) {
        try { mockProc.abortController.abort(); } catch (_) {}
      }
    }
  };

  if (useFallback) {
    setTimeout(async () => {
      try {
        await runFallbackDownloader(url, resolution, outputPath, onProgress, onComplete, onError, mockProc);
      } catch (err) {
        onError?.(err);
      }
    }, 0);
    return mockProc;
  }

  const langFilter = audioLang && audioLang !== "default" ? `[language=${audioLang}]` : "";
  let formatSelector = "";
  if (resolution === "best") {
    formatSelector = langFilter
      ? `bestvideo+bestaudio${langFilter}/bestvideo+bestaudio/best`
      : "bestvideo+bestaudio/best";
  } else {
    const res = parseInt(resolution);
    formatSelector = langFilter
      ? `bestvideo[height<=${res}]+bestaudio${langFilter}/bestvideo[height<=${res}]+bestaudio/bestvideo+bestaudio/best`
      : `bestvideo[height<=${res}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${res}]+bestaudio/bestvideo+bestaudio/best`;
  }

  const args = [
    url,
    "-f", formatSelector,
    "--merge-output-format", "mp4",
    "-o", outputPath,
    "--no-playlist",
    "--newline",
    "--no-check-certificate",
    "--socket-timeout", "30",
    "--buffer-size", "1024K",
    "--retries", "10",
    "--fragment-retries", "10",
    "--no-part",
    "--force-overwrites",
    "--user-agent", "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
    "--extractor-args", "youtube:player-client=ios,tv_embedded,mweb",
    "--compat-options", "no-youtube-unavailable-videos",
  ];

  if (FFMPEG_CMD && path.isAbsolute(FFMPEG_CMD)) {
    args.push("--ffmpeg-location", path.dirname(FFMPEG_CMD));
  }

  console.log(`[downloadVideo] running yt-dlp with arguments:`, args);
  const proc = spawn(YTDLP_CMD, args);
  let lastProgress = -1;
  let filePath = outputPath;

  proc.stdout.on("data", (data) => {
    const text = data.toString();
    const matches = [...text.matchAll(/(\d+\.?\d*)%/g)];
    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      const p = parseFloat(lastMatch[1]);
      if (p !== lastProgress) {
        lastProgress = p;
        onProgress?.(p);
      }
    }
    const destMatch = text.match(/\[download\] Destination: (.+)/);
    if (destMatch) filePath = destMatch[1].trim();
    const mergeMatch = text.match(/\[Merger\] Merging formats into "(.+)"/);
    if (mergeMatch) filePath = mergeMatch[1].trim();
  });

  let stderrBuffer = "";
  proc.stderr.on("data", (d) => {
    const text = d.toString();
    stderrBuffer += text;
    console.error("[yt-dlp]", text);
  });

  proc.on("close", async (code) => {
    if (code === 0) {
      const mp4 = filePath.endsWith(".mp4") ? filePath : filePath + ".mp4";
      const final = fs.existsSync(mp4) ? mp4 : filePath;
      const fileSize = fs.existsSync(final) ? fs.statSync(final).size : 0;
      onComplete?.({ filePath: final, fileSize });
    } else {
      const cleanErr = stderrBuffer.trim().split("\n").pop() || "";
      console.log(`[downloadVideo] yt-dlp execution failed (code ${code}: ${cleanErr}). Triggering fallbacks...`);
      try {
        await runFallbackDownloader(url, resolution, outputPath, onProgress, onComplete, onError, mockProc);
      } catch (err) {
        onError?.(new Error(`yt-dlp failed: ${cleanErr}. Fallback also failed: ${err.message}`));
      }
    }
  });

  proc.on("error", async (e) => {
    console.log(`[downloadVideo] yt-dlp failed to spawn: ${e.message}. Triggering fallbacks...`);
    try {
      await runFallbackDownloader(url, resolution, outputPath, onProgress, onComplete, onError, mockProc);
    } catch (err) {
      onError?.(new Error(`Spawn failed: ${e.message}. Fallback also failed: ${err.message}`));
    }
  });

  mockProc.kill = () => {
    if (proc && typeof proc.kill === "function") {
      try { proc.kill("SIGINT"); } catch (_) {}
    }
    if (mockProc.abortController) {
      try { mockProc.abortController.abort(); } catch (_) {}
    }
  };

  return mockProc;
};
