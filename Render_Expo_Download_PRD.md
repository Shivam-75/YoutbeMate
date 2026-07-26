# PRD -- Render Backend + Expo Download Module

## Objective

Create a production-ready download system where: - Node.js + Express
backend is deployed on Render. - Backend authenticates requests and
returns an authorized direct download URL (or serves a file owned by the
application). - Expo React Native downloads the file with progress
reporting. - Video is saved into the user's gallery.

> This design is intended for files you own or are authorized to
> distribute.

------------------------------------------------------------------------

# Architecture

``` text
React Native (Expo)
        |
 HTTPS API
        |
Render (Express)
        |
Generate/Return Authorized Download URL
        |
Direct Video File
        |
Expo FileSystem
        |
Media Library
        |
Gallery
```

------------------------------------------------------------------------

# Components

## Backend

-   Express
-   Helmet
-   CORS
-   Morgan
-   dotenv

Optional: - Redis + BullMQ (jobs) - Cloud storage (S3/R2)

## Mobile

-   expo-file-system
-   expo-media-library

------------------------------------------------------------------------

# Backend API

## POST /api/download

Purpose: Validate the request and return a downloadable file URL.

Example response

``` json
{
  "success": true,
  "fileName": "video.mp4",
  "downloadUrl": "https://cdn.example.com/videos/video.mp4"
}
```

Errors

-   400 Invalid request
-   401 Unauthorized
-   404 File not found
-   500 Internal error

------------------------------------------------------------------------

# Mobile Flow

1.  User taps Download.
2.  Request Media Library permission.
3.  Call POST /api/download.
4.  Receive JSON.
5.  Validate downloadUrl.
6.  Download using FileSystem.createDownloadResumable().
7.  Show progress.
8.  Save asset to gallery.
9.  Display success.

------------------------------------------------------------------------

# State Management

Idle → Requesting → Downloading → Saving → Completed

Any failure: → Error

------------------------------------------------------------------------

# Error Handling

  Scenario            Action
  ------------------- ---------------------------
  Permission denied   Stop and show message
  Timeout             Retry option
  HTTP error          Show server message
  Save failed         Keep temp file and notify

------------------------------------------------------------------------

# Security

-   HTTPS only
-   Validate request payloads
-   Never expose private server paths
-   Log failures
-   Return only authorized file URLs

------------------------------------------------------------------------

# Render Deployment

Environment variables

    NODE_ENV=production
    PORT=10000

Requirements

-   Enable CORS for the mobile app.
-   Health endpoint: GET /health
-   Do not rely on Render local disk for permanent storage.
-   Use cloud object storage for persistent downloadable files.

------------------------------------------------------------------------

# Acceptance Criteria

-   Backend returns a valid authorized download URL.
-   Expo downloads with visible progress.
-   Video is saved to gallery.
-   Graceful handling of permission, network, and server failures.
-   No application crashes.
