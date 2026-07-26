import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function install() {
  const binDir = path.join(__dirname, "bin");
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const isWindows = process.platform === "win32";
  const binaryName = isWindows ? "yt-dlp.exe" : "yt-dlp";
  const url = isWindows
    ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

  const dest = path.join(binDir, binaryName);

  console.log(`[install_ytdlp] Downloading ${binaryName} from ${url}...`);
  try {
    await downloadFile(url, dest);
    console.log(`[install_ytdlp] Download complete: ${dest}`);

    if (!isWindows) {
      try {
        fs.chmodSync(dest, "755");
        console.log(`[install_ytdlp] Set executable permissions for ${binaryName}`);
      } catch (_) {}

      try {
        execSync("pip3 install -U yt-dlp || pip install -U yt-dlp || python3 -m pip install -U yt-dlp", { stdio: "ignore" });
        console.log("[install_ytdlp] Successfully updated yt-dlp via pip");
      } catch (_) {}
    }
  } catch (err) {
    console.error(`[install_ytdlp] Error downloading yt-dlp:`, err.message);
    process.exit(1);
  }
}

install();
