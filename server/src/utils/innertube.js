import { Innertube, UniversalCache } from "youtubei.js";

let innertubeInstance = null;

export async function getInnertube() {
  if (!innertubeInstance) {
    innertubeInstance = await Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
    });
  }
  return innertubeInstance;
}

export async function getInnertubeVideoInfo(urlOrId) {
  const yt = await getInnertube();
  
  // Extract video ID
  const match = urlOrId.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/))([\w-]{11})/i);
  const videoId = match ? match[1] : (urlOrId.length === 11 ? urlOrId : null);
  
  if (!videoId) {
    throw new Error("Invalid YouTube Video ID or URL");
  }

  const info = await yt.getInfo(videoId);
  const basic = info.basic_info;

  // Extract formats
  const formatNodes = info.streaming_data?.formats || [];
  const adaptiveNodes = info.streaming_data?.adaptive_formats || [];
  const allFormats = [...formatNodes, ...adaptiveNodes];

  const formats = [];
  const seenHeights = new Set();

  for (const fmt of allFormats) {
    if (fmt.has_video && fmt.height) {
      const label = `${fmt.height}p`;
      if (!seenHeights.has(label)) {
        seenHeights.add(label);
        formats.push({
          formatId: fmt.itag?.toString() || label,
          label,
          height: fmt.height,
          filesize: fmt.content_length ? parseInt(fmt.content_length) : 0,
          ext: fmt.mime_type?.includes("mp4") ? "mp4" : "webm",
          hasAudio: fmt.has_audio,
          quality: fmt.quality_label,
        });
      }
    }
  }

  formats.sort((a, b) => a.height - b.height);

  // Get direct stream URL for best muxed format or audio/video stream
  let directStreamUrl = "";
  try {
    // try downloading/deciphering URL via Innertube
    const format = info.chooseFormat({ quality: "best", type: "video+audio" }) ||
                   info.chooseFormat({ quality: "best", type: "video" });
    if (format) {
      directStreamUrl = format.decipher(yt.session.player);
    }
  } catch (decipherErr) {
    console.warn("[Innertube] Decipher direct URL warning:", decipherErr.message);
  }

  return {
    videoId,
    title: basic.title || "YouTube Video",
    thumbnail: basic.thumbnail?.at(-1)?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    channel: basic.author || basic.channel?.name || "",
    duration: basic.duration || 0,
    viewCount: basic.view_count || 0,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    formats: formats.length > 0 ? formats : [
      { formatId: "360", label: "360p", height: 360, filesize: 0, ext: "mp4" },
      { formatId: "720", label: "720p", height: 720, filesize: 0, ext: "mp4" },
    ],
    streamUrl: directStreamUrl,
    infoObj: info, // raw Innertube info for streaming
  };
}
