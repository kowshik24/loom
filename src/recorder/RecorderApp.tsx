import { useEffect, useMemo, useRef, useState } from "react";
import { createThumbnail, formatDuration, sanitizeFilename } from "../shared/media";
import { putRecording } from "../shared/db";
import { defaultRecordingSettings, getRecordingSettings, saveRecordingSettings } from "../shared/settings";
import type { RecordingItem, RecordingSettings, RuntimeMessage } from "../shared/types";

type RecorderStatus = "idle" | "countdown" | "recording" | "paused" | "processing" | "done" | "error";
type Tool = "move-camera" | "pen" | "highlighter" | "rect" | "circle" | "arrow" | "text" | "eraser";

interface Point {
  x: number;
  y: number;
}

interface ClickRipple {
  id: string;
  point: Point;
  createdAt: number;
}

type Annotation =
  | {
      id: string;
      type: "path";
      points: Point[];
      color: string;
      size: number;
      opacity: number;
    }
  | {
      id: string;
      type: "rect" | "circle" | "arrow";
      from: Point;
      to: Point;
      color: string;
      size: number;
      opacity: number;
    }
  | {
      id: string;
      type: "text";
      at: Point;
      text: string;
      color: string;
      size: number;
      opacity: number;
    };

const RESOLUTION_MAP = {
  source: null,
  "720p": { w: 1280, h: 720 },
  "1080p": { w: 1920, h: 1080 },
  "1440p": { w: 2560, h: 1440 },
  "4k": { w: 3840, h: 2160 }
} as const;

export function RecorderApp() {
  const [settings, setSettings] = useState<RecordingSettings>(defaultRecordingSettings);
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState<string>("");
  const [countdown, setCountdown] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [savedItem, setSavedItem] = useState<RecordingItem | null>(null);
  const [cameraPos, setCameraPos] = useState<Point>({ x: 0.72, y: 0.68 });
  const [cameraScale, setCameraScale] = useState(0.24);

  const [tool, setTool] = useState<Tool>("move-camera");
  const [toolColor, setToolColor] = useState("#f43f5e");
  const [toolSize, setToolSize] = useState(5);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [redoStack, setRedoStack] = useState<Annotation[]>([]);
  const [cursorSpotlight, setCursorSpotlight] = useState(true);
  const [clickEmphasis, setClickEmphasis] = useState(true);
  const [hint, setHint] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showTools, setShowTools] = useState(false);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenDisplayVideoRef = useRef<HTMLVideoElement | null>(null);
  const hiddenCameraVideoRef = useRef<HTMLVideoElement | null>(null);

  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const displayStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const composedStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const annotationsRef = useRef<Annotation[]>([]);
  const toolRef = useRef<Tool>(tool);
  const cameraPosRef = useRef<Point>(cameraPos);
  const cameraScaleRef = useRef<number>(cameraScale);
  const settingsRef = useRef<RecordingSettings>(settings);
  const draftRef = useRef<Annotation | null>(null);
  const cursorSpotlightRef = useRef(cursorSpotlight);
  const clickEmphasisRef = useRef(clickEmphasis);
  const cursorPointRef = useRef<Point>({ x: 0.5, y: 0.5 });
  const clickRipplesRef = useRef<ClickRipple[]>([]);

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    cameraPosRef.current = cameraPos;
  }, [cameraPos]);

  useEffect(() => {
    cameraScaleRef.current = cameraScale;
  }, [cameraScale]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    cursorSpotlightRef.current = cursorSpotlight;
  }, [cursorSpotlight]);

  useEffect(() => {
    clickEmphasisRef.current = clickEmphasis;
  }, [clickEmphasis]);

  useEffect(() => {
    if (!showTools && tool !== "move-camera") {
      setTool("move-camera");
    }
  }, [showTools, tool]);

  useEffect(() => {
    const active = status === "recording" || status === "paused" || status === "processing";
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!active) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (status === "recording") pauseRecording();
        else if (status === "paused") resumeRecording();
      }
      if (event.key.toLowerCase() === "s") {
        if (status === "recording" || status === "paused") void stopRecording(false);
      }
      if (event.key.toLowerCase() === "c") {
        if (status === "recording" || status === "paused") void stopRecording(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [status]);

  useEffect(() => {
    void (async () => {
      const local = await getRecordingSettings();
      setSettings(local);
      await chrome.runtime.sendMessage({ type: "REQUEST_INITIAL_SETTINGS" } satisfies RuntimeMessage);
    })();

    const listener = (msg: RuntimeMessage) => {
      if (msg.type === "INITIAL_SETTINGS" && msg.payload.settings) {
        setSettings({ ...defaultRecordingSettings, ...msg.payload.settings });
      }
    };

    chrome.runtime.onMessage.addListener(listener as never);
    return () => {
      chrome.runtime.onMessage.removeListener(listener as never);
      teardown();
    };
  }, []);

  const canRecord = useMemo(() => status === "idle" || status === "done", [status]);
  const isRecordingActive = status === "recording" || status === "paused";

  function updateSettings(patch: Partial<RecordingSettings>) {
    const next = { ...settingsRef.current, ...patch };
    setSettings(next);
    void saveRecordingSettings(next);
  }

  function resolveOutputSize(width: number, height: number) {
    const preset = RESOLUTION_MAP[settingsRef.current.resolution];
    if (!preset) return { width, height };
    return { width: preset.w, height: preset.h };
  }

  function teardown() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    rafRef.current = null;
    timerRef.current = null;

    for (const stream of [displayStreamRef.current, cameraStreamRef.current, micStreamRef.current, composedStreamRef.current]) {
      stream?.getTracks().forEach((track) => track.stop());
    }

    displayStreamRef.current = null;
    cameraStreamRef.current = null;
    micStreamRef.current = null;
    composedStreamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    draftRef.current = null;
    clickRipplesRef.current = [];
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }

  async function beginRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") return;
    setError("");
    setHint("");
    setSavedItem(null);

    try {
      if (settingsRef.current.countdownSeconds > 0) {
        setStatus("countdown");
        for (let i = settingsRef.current.countdownSeconds; i > 0; i -= 1) {
          setCountdown(i);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      setCountdown(0);
      clickRipplesRef.current = [];
      setHint("Pick tab/window/screen in Chrome chooser.");

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: settingsRef.current.fps, max: settingsRef.current.fps }
        },
        audio: settingsRef.current.systemAudioEnabled
      });
      displayStreamRef.current = displayStream;

      displayStream.getVideoTracks()[0].addEventListener("ended", () => {
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== "inactive") {
          void stopRecording(false);
        }
      });

      if (settingsRef.current.cameraEnabled) {
        cameraStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      if (settingsRef.current.micEnabled) {
        micStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      }

      const displayTrackSettings = displayStream.getVideoTracks()[0].getSettings();
      const srcW = displayTrackSettings.width ?? 1920;
      const srcH = displayTrackSettings.height ?? 1080;
      const { width: outW, height: outH } = resolveOutputSize(srcW, srcH);

      const canvas = previewCanvasRef.current;
      if (!canvas) throw new Error("Preview canvas missing");
      canvas.width = outW;
      canvas.height = outH;

      const displayVideo = document.createElement("video");
      displayVideo.srcObject = displayStream;
      displayVideo.muted = true;
      displayVideo.playsInline = true;
      hiddenDisplayVideoRef.current = displayVideo;
      await displayVideo.play();

      if (cameraStreamRef.current) {
        const camVideo = document.createElement("video");
        camVideo.srcObject = cameraStreamRef.current;
        camVideo.muted = true;
        camVideo.playsInline = true;
        hiddenCameraVideoRef.current = camVideo;
        await camVideo.play();
      } else {
        hiddenCameraVideoRef.current = null;
      }

      const composed = canvas.captureStream(settingsRef.current.fps);
      const mixedAudio = await buildAudioMix(displayStream, micStreamRef.current);
      mixedAudio.getTracks().forEach((t) => composed.addTrack(t));
      composedStreamRef.current = composed;

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm;codecs=vp8,opus";

      const recorder = new MediaRecorder(composed, {
        mimeType,
        videoBitsPerSecond: 8_000_000
      });

      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        setStatus("error");
        setError("MediaRecorder error. Recording stopped.");
        teardown();
      };

      renderFrame();
      recorder.start(500);
      setStatus("recording");
      setElapsed(0);
      setHint("Shortcuts: Space pause/resume · S stop · C cancel.");
      timerRef.current = window.setInterval(() => {
        setElapsed((v) => v + 1);
      }, 1000);
    } catch (err) {
      setStatus("error");
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Screen permission denied. Retry and click Share in chooser.");
      } else if (err instanceof DOMException && err.name === "NotFoundError") {
        setError("No capture source found. Open target tab/window and retry.");
      } else {
        setError(err instanceof Error ? err.message : "Unknown recording failure");
      }
      teardown();
    }
  }

  async function buildAudioMix(display: MediaStream, mic: MediaStream | null): Promise<MediaStream> {
    const context = new AudioContext();
    audioContextRef.current = context;
    const destination = context.createMediaStreamDestination();

    const displayAudioTracks = display.getAudioTracks();
    if (displayAudioTracks.length > 0) {
      const displayOnly = new MediaStream([displayAudioTracks[0]]);
      const source = context.createMediaStreamSource(displayOnly);
      source.connect(destination);
    }

    if (mic?.getAudioTracks().length) {
      const micOnly = new MediaStream([mic.getAudioTracks()[0]]);
      const source = context.createMediaStreamSource(micOnly);
      source.connect(destination);
    }

    return destination.stream;
  }

  function renderFrame() {
    const canvas = previewCanvasRef.current;
    const displayVideo = hiddenDisplayVideoRef.current;
    if (!canvas || !displayVideo) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      ctx.fillStyle = "#080a14";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(displayVideo, 0, 0, canvas.width, canvas.height);

      const camVideo = hiddenCameraVideoRef.current;
      if (camVideo && settingsRef.current.cameraEnabled) {
        const cameraW = canvas.width * cameraScaleRef.current;
        const cameraH = cameraW * (9 / 16);
        const cameraX = cameraPosRef.current.x * canvas.width;
        const cameraY = cameraPosRef.current.y * canvas.height;

        ctx.save();
        if (settingsRef.current.cameraShape === "circle") {
          const r = Math.min(cameraW, cameraH) / 2;
          ctx.beginPath();
          ctx.arc(cameraX + cameraW / 2, cameraY + cameraH / 2, r, 0, Math.PI * 2);
          ctx.clip();
        } else {
          drawRoundedRectPath(ctx, cameraX, cameraY, cameraW, cameraH, 18);
          ctx.clip();
        }

        ctx.drawImage(camVideo, cameraX, cameraY, cameraW, cameraH);
        ctx.restore();

        if (toolRef.current === "move-camera") {
          ctx.strokeStyle = "rgba(255,255,255,0.7)";
          ctx.lineWidth = 2;
          ctx.strokeRect(cameraX, cameraY, cameraW, cameraH);
        }
      }

      if ((status === "recording" || status === "paused") && cursorSpotlightRef.current) {
        drawCursorSpotlight(ctx, canvas.width, canvas.height, cursorPointRef.current);
      }

      drawAnnotations(ctx, canvas.width, canvas.height, annotationsRef.current);
      if (draftRef.current) {
        drawAnnotations(ctx, canvas.width, canvas.height, [draftRef.current]);
      }

      if ((status === "recording" || status === "paused") && clickEmphasisRef.current) {
        drawClickRipples(ctx, canvas.width, canvas.height, clickRipplesRef.current);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
  }

  function pauseRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.pause();
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      setStatus("paused");
      setHint("Paused. Press Space to resume.");
    }
  }

  function resumeRecording() {
    if (recorderRef.current?.state === "paused") {
      recorderRef.current.resume();
      timerRef.current = window.setInterval(() => {
        setElapsed((v) => v + 1);
      }, 1000);
      setStatus("recording");
      setHint("Recording resumed.");
    }
  }

  async function stopRecording(cancel = false) {
    const recorder = recorderRef.current;
    if (!recorder) return;

    setStatus("processing");
    if (timerRef.current !== null) window.clearInterval(timerRef.current);

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      if (recorder.state !== "inactive") recorder.stop();
      else resolve();
    });

    const blob = new Blob(chunksRef.current, { type: "video/webm" });
    teardown();

    if (cancel) {
      setStatus("idle");
      setHint("Recording canceled.");
      return;
    }

    const now = Date.now();
    const fileName = autoName(now);
    const thumbnail = await createThumbnail(blob, 2);
    const created: RecordingItem = {
      id: crypto.randomUUID(),
      title: fileName,
      createdAt: now,
      duration: elapsed,
      size: blob.size,
      resolution: settingsRef.current.resolution,
      hasCamera: settingsRef.current.cameraEnabled,
      thumbnailDataUrl: thumbnail,
      blob
    };

    await putRecording(created);
    await chrome.runtime.sendMessage({
      type: "RECORDING_SAVED",
      payload: { id: created.id, title: created.title }
    } satisfies RuntimeMessage);

    setSavedItem(created);
    setStatus("done");
    setHint("Saved to local library.");
  }

  async function downloadLatest() {
    if (!savedItem) return;
    const url = URL.createObjectURL(savedItem.blob);
    await chrome.downloads.download({
      url,
      filename: `LocalLoom/${sanitizeFilename(savedItem.title)}.webm`,
      saveAs: true
    });
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function autoName(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }

  function commitAnnotation(annotation: Annotation) {
    const next = [...annotationsRef.current, annotation];
    annotationsRef.current = next;
    setAnnotations(next);
    setRedoStack([]);
  }

  function undoAnnotation() {
    if (!annotationsRef.current.length) return;
    const next = annotationsRef.current.slice(0, -1);
    const removed = annotationsRef.current[annotationsRef.current.length - 1];
    annotationsRef.current = next;
    setAnnotations(next);
    setRedoStack((prev) => [...prev, removed]);
  }

  function redoAnnotation() {
    if (!redoStack.length) return;
    const annotation = redoStack[redoStack.length - 1];
    const redoNext = redoStack.slice(0, -1);
    const next = [...annotationsRef.current, annotation];
    annotationsRef.current = next;
    setAnnotations(next);
    setRedoStack(redoNext);
  }

  function clearAnnotations() {
    if (!annotationsRef.current.length) return;
    annotationsRef.current = [];
    setAnnotations([]);
    setRedoStack([]);
  }

  function eraseAt(point: Point) {
    const threshold = 0.028;
    const kept = annotationsRef.current.filter((annotation) => {
      if (annotation.type === "path") {
        return !annotation.points.some((p) => distance(p, point) < threshold);
      }
      if (annotation.type === "text") {
        return distance(annotation.at, point) >= threshold;
      }
      const center = {
        x: (annotation.from.x + annotation.to.x) / 2,
        y: (annotation.from.y + annotation.to.y) / 2
      };
      return distance(center, point) >= threshold;
    });

    if (kept.length === annotationsRef.current.length) return;
    annotationsRef.current = kept;
    setAnnotations(kept);
    setRedoStack([]);
  }

  function onCanvasPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (status !== "recording" && status !== "paused") return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const start = toNormPoint(e.clientX, e.clientY, rect);
    cursorPointRef.current = start;
    if (clickEmphasisRef.current) {
      clickRipplesRef.current = [
        ...clickRipplesRef.current.slice(-8),
        { id: crypto.randomUUID(), point: start, createdAt: performance.now() }
      ];
    }
    const activeTool = toolRef.current;

    if (activeTool === "text") {
      const text = prompt("Annotation text");
      if (text?.trim()) {
        commitAnnotation({
          id: crypto.randomUUID(),
          type: "text",
          at: start,
          text: text.trim(),
          color: toolColor,
          size: toolSize,
          opacity: 1
        });
      }
      return;
    }

    if (activeTool === "eraser") {
      eraseAt(start);
      return;
    }

    if (activeTool === "move-camera") {
      if (!settingsRef.current.cameraEnabled) return;
      const cameraW = cameraScaleRef.current;
      const cameraH = cameraScaleRef.current * (9 / 16);
      const insideCamera =
        start.x >= cameraPosRef.current.x &&
        start.x <= cameraPosRef.current.x + cameraW &&
        start.y >= cameraPosRef.current.y &&
        start.y <= cameraPosRef.current.y + cameraH;
      if (!insideCamera) return;
      const origin = { ...cameraPosRef.current };
      const startX = e.clientX;
      const startY = e.clientY;

      const onMove = (event: PointerEvent) => {
        const dx = (event.clientX - startX) / rect.width;
        const dy = (event.clientY - startY) / rect.height;
        setCameraPos({
          x: clamp(origin.x + dx, 0.02, 0.98 - cameraScaleRef.current),
          y: clamp(origin.y + dy, 0.02, 0.98 - cameraScaleRef.current * (9 / 16))
        });
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return;
    }

    if (activeTool === "pen" || activeTool === "highlighter") {
      draftRef.current = {
        id: crypto.randomUUID(),
        type: "path",
        points: [start],
        color: activeTool === "highlighter" ? "#facc15" : toolColor,
        size: activeTool === "highlighter" ? Math.max(toolSize + 6, 10) : toolSize,
        opacity: activeTool === "highlighter" ? 0.34 : 1
      };
    }

    if (activeTool === "rect" || activeTool === "circle" || activeTool === "arrow") {
      draftRef.current = {
        id: crypto.randomUUID(),
        type: activeTool,
        from: start,
        to: start,
        color: toolColor,
        size: toolSize,
        opacity: 1
      };
    }

    const onMove = (event: PointerEvent) => {
      const current = toNormPoint(event.clientX, event.clientY, rect);
      const draft = draftRef.current;
      if (!draft) return;
      if (draft.type === "path") {
        draft.points.push(current);
      } else if (draft.type === "rect" || draft.type === "circle" || draft.type === "arrow") {
        draft.to = current;
      }
    };

    const onUp = () => {
      const draft = draftRef.current;
      if (draft) {
        if (draft.type === "path" && draft.points.length > 1) commitAnnotation(draft);
        if (draft.type === "rect" || draft.type === "circle" || draft.type === "arrow") {
          const w = Math.abs(draft.to.x - draft.from.x);
          const h = Math.abs(draft.to.y - draft.from.y);
          if (w > 0.003 && h > 0.003) commitAnnotation(draft);
        }
      }

      draftRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <main className="recorder-page">
      <header>
        <div className="title-row">
          <h1>LocalLoom Recorder</h1>
          {isRecordingActive && (
            <span className={`recording-badge ${status === "paused" ? "paused" : ""}`}>
              {status === "paused" ? "Paused" : "Recording"}
            </span>
          )}
        </div>
        <p>{isRecordingActive ? formatDuration(elapsed) : "Ready"}</p>
      </header>

      <section className="panel">
        <div className="controls-grid">
          <label>
            <input
              type="checkbox"
              checked={settings.cameraEnabled}
              disabled={!canRecord}
              onChange={(e) => updateSettings({ cameraEnabled: e.target.checked })}
            />
            Camera
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.micEnabled}
              disabled={!canRecord}
              onChange={(e) => updateSettings({ micEnabled: e.target.checked })}
            />
            Microphone
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.systemAudioEnabled}
              disabled={!canRecord}
              onChange={(e) => updateSettings({ systemAudioEnabled: e.target.checked })}
            />
            System Audio
          </label>
          <label>
            Camera Size
            <input
              type="range"
              min={0.14}
              max={0.36}
              step={0.01}
              disabled={!canRecord && status !== "recording" && status !== "paused"}
              value={cameraScale}
              onChange={(e) => setCameraScale(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="toggle-row">
          <button className="link inline-link" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? "Hide advanced settings" : "Show advanced settings"}
          </button>
          <button className="link inline-link" onClick={() => setShowTools((v) => !v)}>
            {showTools ? "Hide annotation tools" : "Show annotation tools"}
          </button>
        </div>

        {showAdvanced && (
          <div className="controls-grid advanced-grid">
            <label>
              Resolution
              <select
                disabled={!canRecord}
                value={settings.resolution}
                onChange={(e) => updateSettings({ resolution: e.target.value as RecordingSettings["resolution"] })}
              >
                <option value="source">Source</option>
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="1440p">1440p</option>
                <option value="4k">4K</option>
              </select>
            </label>
            <label>
              FPS
              <select
                disabled={!canRecord}
                value={settings.fps}
                onChange={(e) => updateSettings({ fps: Number(e.target.value) as 15 | 30 | 60 })}
              >
                <option value={15}>15</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>
            </label>
            <label>
              Countdown
              <select
                disabled={!canRecord}
                value={settings.countdownSeconds}
                onChange={(e) => updateSettings({ countdownSeconds: Number(e.target.value) as 0 | 3 | 5 })}
              >
                <option value={0}>Off</option>
                <option value={3}>3 sec</option>
                <option value={5}>5 sec</option>
              </select>
            </label>
            <label>
              Camera Shape
              <select
                disabled={!canRecord}
                value={settings.cameraShape}
                onChange={(e) => updateSettings({ cameraShape: e.target.value as "circle" | "rectangle" })}
              >
                <option value="circle">Circle</option>
                <option value="rectangle">Rectangle</option>
              </select>
            </label>
          </div>
        )}

        {showTools && (
          <div className="tool-row">
            <button className={tool === "move-camera" ? "active" : ""} onClick={() => setTool("move-camera")}>Move Cam</button>
            <button className={tool === "pen" ? "active" : ""} onClick={() => setTool("pen")}>Pen</button>
            <button className={tool === "text" ? "active" : ""} onClick={() => setTool("text")}>Text</button>
            <button className={tool === "eraser" ? "active" : ""} onClick={() => setTool("eraser")}>Eraser</button>
            <input
              type="color"
              value={toolColor}
              onChange={(e) => setToolColor(e.target.value)}
              title="Annotation color"
              disabled={tool === "move-camera" || tool === "eraser"}
            />
            <label className="tool-size">
              Size
              <input type="range" min={2} max={22} step={1} value={toolSize} onChange={(e) => setToolSize(Number(e.target.value))} />
            </label>
            <button onClick={undoAnnotation} disabled={!annotations.length}>Undo</button>
            <button onClick={redoAnnotation} disabled={!redoStack.length}>Redo</button>
            <button onClick={clearAnnotations} disabled={!annotations.length}>Clear</button>
            <button className={cursorSpotlight ? "active" : ""} onClick={() => setCursorSpotlight((v) => !v)}>
              Spotlight
            </button>
            <button className={clickEmphasis ? "active" : ""} onClick={() => setClickEmphasis((v) => !v)}>
              Click FX
            </button>
          </div>
        )}

        <div className="button-row">
          <button disabled={!canRecord} className="start" onClick={() => void beginRecording()}>
            Start
          </button>
          <button disabled={status !== "recording"} onClick={pauseRecording}>
            Pause
          </button>
          <button disabled={status !== "paused"} onClick={resumeRecording}>
            Resume
          </button>
          <button disabled={status !== "recording" && status !== "paused"} className="stop" onClick={() => void stopRecording(false)}>
            Stop
          </button>
          <button disabled={status !== "recording" && status !== "paused"} onClick={() => void stopRecording(true)}>
            Cancel
          </button>
        </div>

        {countdown > 0 && status === "countdown" && <div className="countdown">{countdown}</div>}
        {hint && <p className="hint">{hint}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="preview-wrap">
        <canvas
          ref={previewCanvasRef}
          className="preview"
          onPointerDown={onCanvasPointerDown}
          onPointerMove={(e) => {
            const canvas = previewCanvasRef.current;
            if (!canvas) return;
            cursorPointRef.current = toNormPoint(e.clientX, e.clientY, canvas.getBoundingClientRect());
          }}
        />
      </section>

      {status === "done" && savedItem && (
        <section className="done-panel">
          <p>Saved: {savedItem.title}</p>
          <div className="button-row">
            <button onClick={downloadLatest}>Export WebM</button>
            <button onClick={() => chrome.runtime.sendMessage({ type: "OPEN_LIBRARY" } satisfies RuntimeMessage)}>
              Open Library
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

function drawAnnotations(ctx: CanvasRenderingContext2D, width: number, height: number, list: Annotation[]) {
  for (const annotation of list) {
    ctx.save();
    ctx.globalAlpha = annotation.opacity;
    ctx.strokeStyle = annotation.color;
    ctx.fillStyle = annotation.color;
    ctx.lineWidth = annotation.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (annotation.type === "path") {
      if (annotation.points.length < 2) {
        ctx.restore();
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(annotation.points[0].x * width, annotation.points[0].y * height);
      for (let i = 1; i < annotation.points.length; i += 1) {
        ctx.lineTo(annotation.points[i].x * width, annotation.points[i].y * height);
      }
      ctx.stroke();
      ctx.restore();
      continue;
    }

    if (annotation.type === "text") {
      ctx.font = `${Math.max(16, annotation.size * 4)}px ui-sans-serif`;
      ctx.fillText(annotation.text, annotation.at.x * width, annotation.at.y * height);
      ctx.restore();
      continue;
    }

    const x1 = annotation.from.x * width;
    const y1 = annotation.from.y * height;
    const x2 = annotation.to.x * width;
    const y2 = annotation.to.y * height;

    if (annotation.type === "rect") {
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      ctx.restore();
      continue;
    }

    if (annotation.type === "circle") {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      continue;
    }

    if (annotation.type === "arrow") {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = 12 + annotation.size;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      continue;
    }

    ctx.restore();
  }
}

function drawCursorSpotlight(ctx: CanvasRenderingContext2D, width: number, height: number, point: Point) {
  const cx = point.x * width;
  const cy = point.y * height;
  const radius = Math.max(60, Math.min(width, height) * 0.09);
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.34)";
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawClickRipples(ctx: CanvasRenderingContext2D, width: number, height: number, ripples: ClickRipple[]) {
  const now = performance.now();
  const life = 600;
  const active = ripples.filter((r) => now - r.createdAt <= life);
  ripples.length = 0;
  ripples.push(...active);

  for (const ripple of active) {
    const age = now - ripple.createdAt;
    const t = age / life;
    const x = ripple.point.x * width;
    const y = ripple.point.y * height;
    const radius = 10 + 42 * t;
    const alpha = 0.75 * (1 - t);

    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawRoundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
}

function toNormPoint(clientX: number, clientY: number, rect: DOMRect): Point {
  return {
    x: clamp((clientX - rect.left) / rect.width, 0, 1),
    y: clamp((clientY - rect.top) / rect.height, 0, 1)
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
