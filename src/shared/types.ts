export type ResolutionPreset = "source" | "720p" | "1080p" | "1440p" | "4k";

export interface RecordingSettings {
  cameraEnabled: boolean;
  micEnabled: boolean;
  systemAudioEnabled: boolean;
  countdownSeconds: number;
  fps: 15 | 30 | 60;
  resolution: ResolutionPreset;
  cameraShape: "circle" | "rectangle";
  cameraCompatibilityMode: boolean;
}

export interface RecordingItem {
  id: string;
  title: string;
  createdAt: number;
  duration: number;
  size: number;
  resolution: string;
  hasCamera: boolean;
  thumbnailDataUrl: string;
  blob: Blob;
}

export type RuntimeMessage =
  | { type: "POPUP_OPEN_RECORDER"; payload: { settings: RecordingSettings } }
  | { type: "OPEN_LIBRARY" }
  | { type: "RECORDING_SAVED"; payload: { id: string; title: string } }
  | { type: "REQUEST_INITIAL_SETTINGS" }
  | { type: "INITIAL_SETTINGS"; payload: { settings: RecordingSettings } };
