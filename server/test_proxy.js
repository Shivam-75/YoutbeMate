import axios from "axios";
import { execSync } from "child_process";

async function getWorkingProxy() {
  try {
    console.log("Fetching geonode proxy list...");
    const url = "https://proxylist.geonode.com/api/proxy-list?limit=25&page=1&sort_by=lastChecked&sort_type=desc&protocols=http";
    const response = await axios.get(url, { timeout: 8000 });
    const data = response.data.data || [];
    
    // Filter and sort by latency (lower is better) and uptime (higher is better)
    const sorted = data
      .filter(p => p.ip && p.port)
      .sort((a, b) => (a.latency || 9999) - (b.latency || 9999));
      
    const list = sorted.map(p => `${p.ip}:${p.port}`);
    console.log(`Fetched and sorted ${list.length} proxies from Geonode.`);
    return list.slice(0, 10);
  } catch (err) {
    console.error("Failed to fetch proxies:", err.message);
    return [];
  }
}

async function run() {
  const proxies = await getWorkingProxy();
  console.log("PROXIES TO TRY:", proxies);
  
  const videoUrl = "https://www.youtube.com/watch?v=5mzZdAiWvCs";
  
  for (const proxy of proxies) {
    try {
      console.log(`Testing proxy: ${proxy}...`);
      const cmd = `C:\\Users\\shiva\\OneDrive\\Desktop\\ss\\server\\bin\\yt-dlp.exe --proxy "http://${proxy}" --dump-json "${videoUrl}"`;
      // Use 3000ms timeout to skip dead proxies fast
      const stdout = execSync(cmd, { timeout: 3500, stdio: "ignore" });
      console.log(`SUCCESS: Proxy ${proxy} worked!`);
      return;
    } catch (err) {
      console.log(`Proxy ${proxy} failed: ${err.message}`);
    }
  }
  console.log("All proxies failed.");
}

run();
