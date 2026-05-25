import { useEffect, useMemo, useState } from "react";
import { getRecordingSettings, saveRecordingSettings } from "../shared/settings";
import { listRecordings } from "../shared/db";
import { formatDuration } from "../shared/media";
import type { RecordingItem, RecordingSettings, RuntimeMessage } from "../shared/types";

export function PopupApp() {
  const [settings, setSettings] = useState<RecordingSettings | null>(null);
  const [recent, setRecent] = useState<RecordingItem[]>([]);

  useEffect(() => {
    void (async () => {
      setSettings(await getRecordingSettings());
      setRecent((await listRecordings()).slice(0, 3));
    })();
  }, []);

  const canStart = useMemo(() => Boolean(settings), [settings]);

  async function updateSettings(patch: Partial<RecordingSettings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveRecordingSettings(next);
  }

  async function startRecording() {
    if (!settings) return;
    await saveRecordingSettings(settings);
    await chrome.runtime.sendMessage({
      type: "POPUP_OPEN_RECORDER",
      payload: { settings }
    } satisfies RuntimeMessage);
    window.close();
  }

  if (!settings) return <main className="popup loading">Loading...</main>;

  return (
    <main className="popup">
      <header>
        <h1>LocalLoom</h1>
        <button
          className="link"
          onClick={() => chrome.runtime.sendMessage({ type: "OPEN_LIBRARY" } satisfies RuntimeMessage)}
        >
          Library
        </button>
      </header>

      <section className="card">
        <h2>Quick Start</h2>
        <label>
          <input
            type="checkbox"
            checked={settings.cameraEnabled}
            onChange={(e) => updateSettings({ cameraEnabled: e.target.checked })}
          />
          Camera
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.micEnabled}
            onChange={(e) => updateSettings({ micEnabled: e.target.checked })}
          />
          Microphone
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.systemAudioEnabled}
            onChange={(e) => updateSettings({ systemAudioEnabled: e.target.checked })}
          />
          System audio
        </label>

        <div className="row">
          <label>
            Countdown
            <select
              value={settings.countdownSeconds}
              onChange={(e) => updateSettings({ countdownSeconds: Number(e.target.value) as 0 | 3 | 5 })}
            >
              <option value={0}>Off</option>
              <option value={3}>3 sec</option>
              <option value={5}>5 sec</option>
            </select>
          </label>
          <label>
            FPS
            <select
              value={settings.fps}
              onChange={(e) => updateSettings({ fps: Number(e.target.value) as 15 | 30 | 60 })}
            >
              <option value={15}>15</option>
              <option value={30}>30</option>
              <option value={60}>60</option>
            </select>
          </label>
        </div>

        <button className="record" disabled={!canStart} onClick={startRecording}>
          Start Recording
        </button>
      </section>

      <section className="card">
        <h2>Recent</h2>
        {recent.length === 0 && <p className="muted">No recordings yet.</p>}
        {recent.map((item) => (
          <article key={item.id} className="recent-row">
            <img src={item.thumbnailDataUrl} alt="thumb" />
            <div>
              <strong>{item.title}</strong>
              <p>{formatDuration(item.duration)}</p>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
