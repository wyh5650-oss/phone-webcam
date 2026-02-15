# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PhoneWebcam is an Electron-based desktop application that turns smartphones into wireless webcams for Windows PCs. It uses WebRTC for low-latency video streaming over local Wi-Fi and includes a native virtual camera driver (DirectShow) that allows the phone's video feed to appear as a standard webcam in applications like Zoom, Teams, and OBS.

## Architecture

### Three-Layer System

1. **Electron Desktop App** (`electron/main.cjs`)
   - Main process that orchestrates the entire application
   - Loads and manages the virtual camera driver via Koffi FFI
   - Handles IPC communication between renderer and native code
   - Starts the Express/Socket.IO server on app launch

2. **Express/Socket.IO Server** (`server/server.cjs`)
   - HTTPS server with self-signed certificates for secure local connections
   - WebRTC signaling server for phone-PC video streaming
   - Serves the React frontend in production mode
   - Proxies to Vite dev server in development mode
   - Runs on port 3000, auto-detects LAN IP address

3. **React Frontend** (`src/`)
   - Two main routes: `/` (PC receiver) and `/mobile` (phone sender)
   - `Receiver.jsx`: PC-side UI with QR code, video preview, quality controls
   - `Sender.jsx`: Mobile-side camera capture and WebRTC streaming
   - Uses Socket.IO client for signaling, WebRTC for video transport

### Native Components

- **softcam.dll** (`native/softcam/`): Third-party DirectShow virtual camera driver
- **vcam_helper.dll** (`native/vcam_helper.c`): Custom C library for fast RGBA→BGR pixel format conversion (~50x faster than JavaScript)
- Both DLLs are loaded via Koffi FFI in the Electron main process

### Data Flow

1. Phone captures video via `getUserMedia()` → WebRTC peer connection
2. PC receives WebRTC stream → renders to hidden canvas → extracts RGBA pixels
3. RGBA buffer sent to main process via IPC (`vcam-frame` event)
4. Main process calls `rgba_to_bgr_flip()` from vcam_helper.dll
5. BGR buffer sent to softcam.dll via `scSendFrame()`
6. Virtual camera appears in Windows as "Softcam"

## Development Commands

### Start Development Server
```bash
npm run dev
```
Starts Vite dev server on port 5173 and launches Electron. The Express server proxies frontend requests to Vite for HMR support.

### Build Production Bundle
```bash
npm run build
```
Builds React app to `dist/` using Vite.

### Package Application
```bash
npm run pack
```
Builds and packages the app without creating an installer (output: `release/win-unpacked/`).

### Create Installer
```bash
npm run dist
```
Builds and creates NSIS installer (output: `release/PhoneWebcam Setup x.x.x.exe`).

## Key Configuration

### Electron Builder (`package.json`)
- Packages `electron/`, `server/`, and `dist/` into app.asar
- Copies `native/` DLLs to `resources/native/` as extraResources
- NSIS installer runs `build/installer.nsh` to register softcam.dll via regsvr32

### Path Resolution
- **Development**: DLLs loaded from `native/softcam/dist/bin/x64/`
- **Production**: DLLs loaded from `process.resourcesPath/native/softcam/dist/bin/x64/`

### Server Behavior
- Development: Proxies all requests to Vite dev server at `http://localhost:5173`
- Production: Serves static files from `dist/` directory

## Important Notes

- The app requires Windows x64 (DirectShow virtual camera is Windows-only)
- Self-signed HTTPS certificates are generated on each server start (required for mobile camera access)
- The installer automatically registers softcam.dll as a system-wide DirectShow filter
- Virtual camera resolution must match the incoming video stream dimensions
- Frame conversion happens synchronously in the main process for performance
