import axios from "axios";

const YT_API_BASE = "https://www.googleapis.com/youtube/v3";

function getApiKey() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || key === "YOUR_YOUTUBE_API_KEY_HERE") {
    throw new Error(
      "YouTube API key not configured. Add YOUTUBE_API_KEY to .env",
    );
  }
  return key;
}

function parseDuration(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] || 0);
  const m = parseInt(match[2] || 0);
  const s = parseInt(match[3] || 0);
  return h * 3600 + m * 60 + s;
}

function formatVideoItem(snippet, stats, contentDetails, videoId) {
  const thumbnails = snippet.thumbnails;
  const thumb =
    thumbnails?.maxres?.url ||
    thumbnails?.high?.url ||
    thumbnails?.medium?.url ||
    thumbnails?.default?.url ||
    "";

  return {
    videoId,
    title: snippet.title,
    thumbnail: thumb,
    channel: snippet.channelTitle || "",
    channelId: snippet.channelId || "",
    publishedAt: snippet.publishedAt || "",
    duration: contentDetails ? parseDuration(contentDetails.duration) : 0,
    viewCount: stats ? parseInt(stats.viewCount || 0) : 0,
    likeCount: stats ? parseInt(stats.likeCount || 0) : 0,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    description: snippet.description?.substring(0, 200) || "",
  };
}

/**
 * Fetch trending / popular videos (YouTube home page style)
 */
export const getTrendingVideos = async ({
  regionCode = "IN",
  categoryId = "",
  maxResults = 20,
} = {}) => {
  const key = getApiKey();

  const params = {
    part: "snippet,contentDetails,statistics",
    chart: "mostPopular",
    regionCode,
    maxResults,
    key,
  };
  if (categoryId) params.videoCategoryId = categoryId;

  const { data } = await axios.get(`${YT_API_BASE}/videos`, { params });

  return data.items.map((item) =>
    formatVideoItem(
      item.snippet,
      item.statistics,
      item.contentDetails,
      item.id,
    ),
  );
};

/**
 * Get video categories
 */
export const getVideoCategories = async (regionCode = "IN") => {
  const key = getApiKey();
  const { data } = await axios.get(`${YT_API_BASE}/videoCategories`, {
    params: { part: "snippet", regionCode, key },
  });

  return data.items
    .filter((c) => c.snippet.assignable)
    .map((c) => ({ id: c.id, name: c.snippet.title }));
};

/**
 * Search YouTube videos
 */
export const searchYouTubeAPI = async (query, maxResults = 30) => {
  const key = getApiKey();

  // Step 1: search for video IDs
  const searchRes = await axios.get(`${YT_API_BASE}/search`, {
    params: {
      part: "snippet",
      q: query,
      type: "video",
      maxResults,
      key,
    },
  });

  if (!searchRes.data.items?.length) return [];

  // Step 2: get video details (duration, stats) using videos endpoint
  const ids = searchRes.data.items.map((i) => i.id.videoId).join(",");
  const detailsRes = await axios.get(`${YT_API_BASE}/videos`, {
    params: {
      part: "snippet,contentDetails,statistics",
      id: ids,
      key,
    },
  });

  const detailsMap = {};
  for (const item of detailsRes.data.items) {
    detailsMap[item.id] = item;
  }

  return searchRes.data.items
    .map((item) => {
      const videoId = item.id.videoId;
      const detail = detailsMap[videoId];
      if (detail) {
        return formatVideoItem(
          detail.snippet,
          detail.statistics,
          detail.contentDetails,
          videoId,
        );
      }
      return formatVideoItem(item.snippet, null, null, videoId);
    })
    .filter(Boolean);
};
