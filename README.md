# LocalLoom

Chrome MV3 extension for local-first screen recording.

![LocalLoom Logo](./public/loom.png)

## What is implemented

- Popup quick-start with saved settings:
  - Camera on/off
  - Mic on/off
  - System audio on/off
  - Advanced section for countdown and FPS
- Recorder window:
  - Start screen capture (`getDisplayMedia`)
  - Optional mic/camera capture
  - Live camera overlay composited into canvas
  - Camera drag + size slider during record
  - Pause / Resume / Stop / Cancel
  - Auto-stop when shared screen stream ends
  - Optional advanced settings section (resolution, fps, countdown, camera shape)
  - Optional annotation section with simple tools: move camera, pen, text, eraser
  - Annotation editing: undo, redo, clear
  - Cursor spotlight and click ripple emphasis (toggleable)
  - Recording status badge + keyboard hints
- Local library page:
  - IndexedDB storage for blob + metadata + thumbnail
  - Search by title
  - Playback preview
  - Rename / Delete
  - Trim start/end with safe copy flow (`Save Trim As Copy`) or replace flow (`Replace Original`)
  - Export `.webm`
- Background service worker:
  - Opens recorder window
  - Opens library page
  - Keyboard shortcuts (`chrome.commands`)
  - Notification on save

## Architecture

- `src/popup/*` popup UI
- `src/recorder/*` recorder UI + recording pipeline
- `src/library/*` local library + trim/editor-lite
- `src/background/index.ts` message routing + window/tab management
- `src/shared/*` settings, IndexedDB, media helpers, types

## Run

```bash
npm install
npm run dev
```

Load unpacked extension from `.output/chrome-mv3-dev` in `chrome://extensions`.

## Build

```bash
npm run typecheck
npm run build
```

Production output in `dist/`.

## CI/CD

- Workflow: `.github/workflows/release-on-main.yml`
- Trigger: push to `main`
- Pipeline: `npm ci` -> `npm run typecheck` -> `npm run build`
- CD: creates GitHub Release with tag `v<package-version>-build.<run-number>`
- Asset: zipped extension bundle from `dist/`
- PR CI workflow: `.github/workflows/ci-pr.yml` (runs checks on pull requests to `main`, no release)

## Current scope vs long plan

This repo now covers Phase 1 + core Phase 2 + part of Phase 3.
Not implemented yet:

- Split/merge timeline editor
- MP4 export via ffmpeg.wasm
- Offscreen document worker pipeline
- File System Access API save directory mode
- OCR blur/watermark
- Post-edit audio track mixing
- Automated tests (Vitest/Playwright)
