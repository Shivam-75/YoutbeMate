import axios from "axios";

async function run() {
  try {
    console.log("Fetching active instances...");
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
    const topInstances = active.slice(0, 30).map(i => i.uri);
    console.log(`Testing top ${topInstances.length} instances...`);
    
    const videoId = "5mzZdAiWvCs";
    const working = [];
    
    for (const instance of topInstances) {
      try {
        console.log(`Testing: ${instance}...`);
        const response = await axios.get(`${instance}/api/v1/videos/${videoId}?local=true`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          },
          timeout: 6000
        });
        const info = response.data;
        if (info && info.title && info.formatStreams && info.formatStreams.length > 0) {
          console.log(`✅ WORKING: ${instance} (Title: ${info.title}, streams: ${info.formatStreams.length})`);
          working.push(instance);
        } else {
          console.log(`❌ FAILED (no streams/title): ${instance}`);
        }
      } catch (err) {
        console.log(`❌ FAILED: ${instance} - ${err.message}`);
      }
    }
    
    console.log("FINAL WORKING LIST:", working);
  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();
