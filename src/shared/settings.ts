import type { RecordingSettings } from "./types";

export const SETTINGS_STORAGE_KEY = "localloom.settings.v1";

export const defaultRecordingSettings: RecordingSettings = {
  cameraEnabled: true,
  micEnabled: true,
  systemAudioEnabled: true,
  countdownSeconds: 3,
  fps: 30,
  resolution: "1080p",
  cameraShape: "circle"
};

export async function getRecordingSettings(): Promise<RecordingSettings> {
  const result = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  return {
    ...defaultRecordingSettings,
    ...(result[SETTINGS_STORAGE_KEY] ?? {})
  };
}

export async function saveRecordingSettings(settings: RecordingSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
}
