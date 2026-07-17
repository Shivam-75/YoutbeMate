import mongoose from "mongoose";

const downloadSchema = new mongoose.Schema(
  {
    videoId: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    thumbnail: {
      type: String,
      default: "",
    },
    channel: {
      type: String,
      default: "",
    },
    duration: {
      type: Number,
      default: 0,
    },
    resolution: {
      type: String,
      default: "720p",
    },
    format: {
      type: String,
      default: "mp4",
    },
    fileSize: {
      type: Number,
      default: 0,
    },
    filePath: {
      type: String,
      default: "",
    },
    url: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "downloading", "paused", "completed", "failed"],
      default: "pending",
    },
    progress: {
      type: Number,
      default: 0,
    },
    error: {
      type: String,
      default: "",
    },
    deviceId: {
      type: String,
      default: "",
      index: true,
    },
  },
  { timestamps: true }
);

const Download = mongoose.model("Download", downloadSchema);

export default Download;
