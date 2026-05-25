import { useEffect, useMemo, useState } from "react";
import {
  deleteRecording,
  listRecordings,
  putRecording,
  renameRecording
} from "../shared/db";
import { getRecordingSettings } from "../shared/settings";
import { createThumbnail, formatBytes, formatDuration, sanitizeFilename, trimBlob } from "../shared/media";
import type { RecordingItem, RuntimeMessage } from "../shared/types";

export function LibraryApp() {
  const [items, setItems] = useState<RecordingItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [busy, setBusy] = useState(false);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void refresh();
  }, []);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0],
    [items, selectedId]
  );

  const filtered = useMemo(() => {
    const needle = query.toLowerCase().trim();
    if (!needle) return items;
    return items.filter((item) => item.title.toLowerCase().includes(needle));
  }, [items, query]);

  useEffect(() => {
    if (selected && !selectedId) {
      setSelectedId(selected.id);
    }
  }, [selected, selectedId]);

  useEffect(() => {
    setTrimStart(0);
    setTrimEnd(0);
  }, [selectedId]);

  useEffect(() => {
    if (!notice && !error) return;
    const id = window.setTimeout(() => {
      setNotice("");
      setError("");
    }, 2500);
    return () => window.clearTimeout(id);
  }, [notice, error]);

  useEffect(() => {
    if (!selected) {
      setSelectedVideoUrl("");
      return;
    }
    const url = URL.createObjectURL(selected.blob);
    setSelectedVideoUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [selected]);

  async function refresh() {
    const rows = await listRecordings();
    setItems(rows);
    if (!selectedId && rows[0]) {
      setSelectedId(rows[0].id);
    }
  }

  async function exportSelected() {
    if (!selected) return;
    setError("");
    try {
      const url = URL.createObjectURL(selected.blob);
      await chrome.downloads.download({
        url,
        filename: `LocalLoom/${sanitizeFilename(selected.title)}.webm`,
        saveAs: true
      });
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      setNotice("Export started.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    }
  }

  async function renameSelected() {
    if (!selected) return;
    const next = prompt("Rename recording", selected.title);
    const clean = next?.trim();
    if (!clean || clean === selected.title) return;
    await renameRecording(selected.id, clean);
    setNotice("Recording renamed.");
    await refresh();
  }

  async function deleteSelected() {
    if (!selected) return;
    const confirmed = confirm(`Delete recording \"${selected.title}\"?`);
    if (!confirmed) return;
    await deleteRecording(selected.id);
    setSelectedId("");
    setNotice("Recording deleted.");
    await refresh();
  }

  async function trimSelected(saveAsCopy: boolean) {
    if (!selected) return;
    if (!saveAsCopy) {
      const confirmed = confirm("Trim will replace original recording. Continue?");
      if (!confirmed) return;
    }
    setError("");
    setBusy(true);
    try {
      const trimmedBlob = await trimBlob(selected.blob, trimStart, trimEnd);
      const thumb = await createThumbnail(trimmedBlob);
      const updated: RecordingItem = {
        ...selected,
        id: saveAsCopy ? crypto.randomUUID() : selected.id,
        title: saveAsCopy ? `${selected.title} (trimmed)` : selected.title,
        createdAt: saveAsCopy ? Date.now() : selected.createdAt,
        blob: trimmedBlob,
        size: trimmedBlob.size,
        duration: Math.max(selected.duration - trimStart - trimEnd, 0.1),
        thumbnailDataUrl: thumb
      };
      await putRecording(updated);
      if (saveAsCopy) setSelectedId(updated.id);
      setTrimStart(0);
      setTrimEnd(0);
      setNotice(saveAsCopy ? "Trim saved as copy." : "Trim applied.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trim failed.");
    } finally {
      setBusy(false);
    }
  }

  async function openRecorder() {
    const settings = await getRecordingSettings();
    await chrome.runtime.sendMessage({
      type: "POPUP_OPEN_RECORDER",
      payload: { settings }
    } satisfies RuntimeMessage);
  }

  return (
    <main className="library-page">
      <header>
        <h1>LocalLoom Library</h1>
        <div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recordings"
          />
        </div>
      </header>

      <section className="layout">
        <aside>
          {filtered.length === 0 && (
            <div className="empty-state">
              <p className="muted">
                {items.length === 0 ? "No recordings yet." : "No recordings match search."}
              </p>
              <div className="empty-actions">
                {items.length === 0 ? (
                  <button onClick={() => void openRecorder()}>Open Recorder</button>
                ) : (
                  <button onClick={() => setQuery("")}>Clear Search</button>
                )}
              </div>
            </div>
          )}
          {filtered.map((item) => (
            <button
              key={item.id}
              className={`record-card ${selected?.id === item.id ? "active" : ""}`}
              onClick={() => setSelectedId(item.id)}
            >
              <img src={item.thumbnailDataUrl} alt={item.title} />
              <div>
                <strong>{item.title}</strong>
                <p>
                  {formatDuration(item.duration)} · {formatBytes(item.size)}
                </p>
              </div>
            </button>
          ))}
        </aside>

        <article className="viewer">
          {!selected && <p className="muted">Select recording.</p>}
          {selected && (
            <>
              {notice && <p className="notice">{notice}</p>}
              {error && <p className="error">{error}</p>}
              <h2>{selected.title}</h2>
              <video controls src={selectedVideoUrl} />
              <p className="meta">
                {new Date(selected.createdAt).toLocaleString()} · {selected.resolution} · {formatDuration(selected.duration)}
              </p>

              <div className="actions">
                <button disabled={busy} onClick={exportSelected}>Export</button>
                <button disabled={busy} onClick={renameSelected}>Rename</button>
                <button disabled={busy} className="danger" onClick={deleteSelected}>
                  Delete
                </button>
              </div>

              <section className="trim-box">
                <h3>Trim</h3>
                <label>
                  Cut from start: {trimStart.toFixed(1)}s
                  <input
                    type="range"
                    min={0}
                    max={Math.max(selected.duration - 0.1, 0)}
                    step={0.1}
                    value={trimStart}
                    onChange={(e) => setTrimStart(Number(e.target.value))}
                  />
                </label>
                <label>
                  Cut from end: {trimEnd.toFixed(1)}s
                  <input
                    type="range"
                    min={0}
                    max={Math.max(selected.duration - trimStart - 0.1, 0)}
                    step={0.1}
                    value={trimEnd}
                    onChange={(e) => setTrimEnd(Number(e.target.value))}
                  />
                </label>
                <div className="trim-actions">
                  <button disabled={busy || trimStart + trimEnd <= 0} onClick={() => void trimSelected(true)}>
                    {busy ? "Processing..." : "Save Trim As Copy"}
                  </button>
                  <button disabled={busy || trimStart + trimEnd <= 0} onClick={() => void trimSelected(false)}>
                    Replace Original
                  </button>
                </div>
              </section>
            </>
          )}
        </article>
      </section>
    </main>
  );
}
