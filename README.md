# LocalLoom

Chrome MV3 extension for local-first screen recording.

## What is implemented

- Popup quick-start with saved settings:
  - Camera on/off
  - Mic on/off
  - System audio on/off
  - Countdown (0/3/5)
  - FPS (15/30/60)
- Recorder window:
  - Start screen capture (`getDisplayMedia`)
  - Optional mic/camera capture
  - Live camera overlay composited into canvas
  - Camera shape: circle/rectangle
  - Camera drag + size slider during record
  - Pause / Resume / Stop / Cancel
  - Auto-stop when shared screen stream ends
  - Live annotation tools: pen, highlighter, rectangle, circle, arrow, text
  - Annotation editing: undo, redo, clear, eraser
  - Cursor spotlight and click ripple emphasis (toggleable)
- Local library page:
  - IndexedDB storage for blob + metadata + thumbnail
  - Search by title
  - Playback preview
  - Rename / Delete
  - Trim start/end and save back to recording
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
