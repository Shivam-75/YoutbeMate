import fs from "fs";
import path from "path";
import https from "https";

// Helper to download a file with redirect support
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      // Handle HTTP redirects (3xx)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(dest);
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
      file.on("error", (err) => {
        file.close();
        fs.unlink(dest, () => reject(err));
      });
    }).on("error", (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

async function install() {
  const binDir = path.join(process.cwd(), "bin");
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const isWindows = process.platform === "win32";
  const filename = isWindows ? "yt-dlp.exe" : "yt-dlp";
  const destPath = path.join(binDir, filename);

  // If binary already exists, skip download
  if (fs.existsSync(destPath)) {
    console.log(`✅ yt-dlp already exists at: ${destPath}`);
    return;
  }

  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${filename}`;
  console.log(`⏳ Downloading yt-dlp binary from: ${url}`);
  try {
    await downloadFile(url, destPath);
    if (!isWindows) {
      fs.chmodSync(destPath, "755"); // Make executable on Linux/Mac
    }
    console.log(`✅ yt-dlp binary downloaded successfully: ${destPath}`);
  } catch (err) {
    console.error("❌ Failed to download yt-dlp binary:", err.message);
  }
}

install();
