import { exec, execSync, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import ffmpegPath from "ffmpeg-static";

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function os_homedir() {
  return process.env.USERPROFILE || process.env.HOME || "C:\\Users\\Default";
}

// ─── Find executable helper ───────────────────────────────────────────────────
function findExecutable(name) {
  // 1. Try command directly in case it is already in global system PATH
  try {
    const versionArg = name === "ffmpeg" ? "-version" : "--version";
    execSync(`"${name}" ${versionArg}`, { stdio: "ignore", timeout: 2000 });
    console.log(`✅ ${name} is globally available via PATH`);
    return name;
  } catch (_) {}

  // 2. List of standard candidates
  const candidates = [];
  
  // Prioritize imported static path for ffmpeg
  if (name === "ffmpeg" && ffmpegPath) {
    candidates.push(ffmpegPath);
  }

  // Prioritize relative bin folder inside server package
  const relativeBinDir = path.join(__dirname, "..", "..", "bin");

  candidates.push(
    path.join(relativeBinDir, name),
    path.join(relativeBinDir, `${name}.exe`),
    path.join(process.cwd(), "bin", name),
    path.join(process.cwd(), "bin", `${name}.exe`),
    name,
    `${name}.exe`
  );

  // standard candidates fallback
  candidates.push(
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312", "Scripts", `${name}.exe`),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python311", "Scripts", `${name}.exe`),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python310", "Scripts", `${name}.exe`),
    `C:\\Python312\\Scripts\\${name}.exe`,
    `C:\\Python311\\Scripts\\${name}.exe`,
    `C:\\Python310\\Scripts\\${name}.exe`,
    path.join(os_homedir(), "AppData", "Local", "Microsoft", "WindowsApps", `${name}.exe`),
    path.join(os_homedir(), "AppData", "Roaming", "Python", "Python312", "Scripts", `${name}.exe`),
  );

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
    // Trust absolute paths if they exist to avoid PyInstaller startup timeout on slow VMs
    if (path.isAbsolute(cmd) && fs.existsSync(cmd)) {
      console.log(`✅ ${name} detected successfully (trusted absolute path):`, cmd);
      return cmd;
    }
    try {
      const versionArg = name === "ffmpeg" ? "-version" : "--version";
      execSync(`"${cmd}" ${versionArg}`, { stdio: "ignore", timeout: 8000 });
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

/**
 * Get video info from YouTube URL
 */
export const getVideoInfo = async (url) => {
  const { stdout } = await execAsync(
    `"${YTDLP_CMD}" --dump-json --no-check-certificate --no-playlist --socket-timeout 30 --user-agent "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36" --extractor-args "youtube:player-client=ios,tv_embedded,mweb" "${url}"`,
    { timeout: 60000 }
  );
  const info = JSON.parse(stdout.trim());

  const formats = [];
  const seen = new Set();

  if (info.formats) {
    for (const fmt of info.formats) {
      // Do not restrict to pre-merged mp4 (acodec !== 'none').
      // DASH/Adaptive streams (only video) can be merged with audio dynamically by ffmpeg.
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

  // Sort resolutions ascending (e.g. 144p, 360p, 480p, 720p, 1080p, 1440p, 2160p)
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
};

/**
 * Download video — returns the spawn process to support pausing/resuming
 */
export const downloadVideo = (url, resolution, outputDir, outputFilename, audioLang, onProgress, onComplete, onError) => {
  const outputPath = path.join(outputDir, outputFilename);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Prioritize selected language track, fallback to default bestaudio
  const langFilter = audioLang && audioLang !== "default" ? `[language=${audioLang}]` : "";
  
  let formatSelector = "";
  if (resolution === "best") {
    formatSelector = langFilter
      ? `bestvideo+bestaudio${langFilter}/bestvideo+bestaudio/best`
      : "bestvideo+bestaudio/best";
  } else {
    const res = parseInt(resolution);
    // Tiered fallback: try exact res → any lower res → best available
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
    // ios client is most reliable in 2025 (android_vr is deprecated/blocked)
    "--extractor-args", "youtube:player-client=ios,tv_embedded,mweb",
    "--compat-options", "no-youtube-unavailable-videos",
  ];

  // Pass custom detected ffmpeg path to yt-dlp
  if (FFMPEG_CMD && path.isAbsolute(FFMPEG_CMD)) {
    args.push("--ffmpeg-location", path.dirname(FFMPEG_CMD));
  }

  console.log(`[downloadVideo] running yt-dlp with arguments:`, args);
  const proc = spawn(YTDLP_CMD, args);
  let lastProgress = -1;
  let filePath = outputPath;

  proc.stdout.on("data", (data) => {
    const text = data.toString();
    // Parse all progress percentages in the chunk and take the last/most recent one
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

  proc.stderr.on("data", (d) => console.error("[yt-dlp]", d.toString()));

  proc.on("close", (code) => {
    if (code === 0) {
      const mp4 = filePath.endsWith(".mp4") ? filePath : filePath + ".mp4";
      const final = fs.existsSync(mp4) ? mp4 : filePath;
      const fileSize = fs.existsSync(final) ? fs.statSync(final).size : 0;
      onComplete?.({ filePath: final, fileSize });
    } else {
      onError?.(new Error(`yt-dlp exited with code ${code}`));
    }
  });

  proc.on("error", (e) => onError?.(new Error(`Cannot start yt-dlp: ${e.message}`)));

  return proc;
};
