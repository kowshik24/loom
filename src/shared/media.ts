export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export async function createThumbnail(
  blob: Blob,
  atSecond = 2,
  width = 360,
  height = 202
): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Could not decode video"));
    });

    video.currentTime = Math.min(atSecond, Math.max(video.duration - 0.1, 0));

    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("Could not seek video"));
    });

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");

    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, width, height);

    const ratio = Math.min(width / video.videoWidth, height / video.videoHeight);
    const drawW = video.videoWidth * ratio;
    const drawH = video.videoHeight * ratio;
    const dx = (width - drawW) / 2;
    const dy = (height - drawH) / 2;

    ctx.drawImage(video, dx, dy, drawW, drawH);
    return canvas.toDataURL("image/jpeg", 0.84);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function trimBlob(
  blob: Blob,
  startSeconds: number,
  endSeconds: number
): Promise<Blob> {
  if (startSeconds <= 0 && endSeconds <= 0) return blob;

  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Could not load video for trim"));
  });

  const duration = video.duration;
  const start = Math.min(Math.max(startSeconds, 0), duration - 0.1);
  const end = Math.max(Math.min(duration - endSeconds, duration), start + 0.1);

  const stream = (video as HTMLVideoElement & { captureStream: () => MediaStream }).captureStream();
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9,opus" });
  const chunks: BlobPart[] = [];

  await new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recorder.onerror = () => reject(new Error("Trim recorder failed"));

    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: "video/webm" }));
    };

    const onTimeUpdate = () => {
      if (video.currentTime >= end) {
        video.pause();
        video.removeEventListener("timeupdate", onTimeUpdate);
        recorder.stop();
      }
    };

    video.addEventListener("timeupdate", onTimeUpdate);

    video.currentTime = start;
    video.onseeked = async () => {
      recorder.start(300);
      await video.play();
    };
  });

  URL.revokeObjectURL(url);
  return new Blob(chunks, { type: "video/webm" });
}
