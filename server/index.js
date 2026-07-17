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

app.get("/", (req, res) => {
  res.json({ success: true, message: "🎬 Video Downloader API Running!" });
});

// Start server immediately — DB connects in background (no blocking)
app.listen(PORT, "0.0.0.0", () =>
  console.log("🚀 Server running at http://localhost:" + PORT)
);
Db().catch((err) => console.error("⚠️ DB connect failed:", err.message));
