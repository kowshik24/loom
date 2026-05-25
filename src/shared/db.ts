import { openDB } from "idb";
import type { DBSchema } from "idb";
import type { RecordingItem } from "./types";

interface LocalLoomDB extends DBSchema {
  recordings: {
    key: string;
    value: RecordingItem;
    indexes: {
      byCreatedAt: number;
      byTitle: string;
    };
  };
}

const DB_NAME = "localloom-db";
const DB_VERSION = 1;

async function db() {
  return openDB<LocalLoomDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      const store = database.createObjectStore("recordings", { keyPath: "id" });
      store.createIndex("byCreatedAt", "createdAt");
      store.createIndex("byTitle", "title");
    }
  });
}

export async function putRecording(item: RecordingItem): Promise<void> {
  await (await db()).put("recordings", item);
}

export async function getRecording(id: string): Promise<RecordingItem | undefined> {
  return (await db()).get("recordings", id);
}

export async function listRecordings(): Promise<RecordingItem[]> {
  const rows = await (await db()).getAll("recordings");
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteRecording(id: string): Promise<void> {
  await (await db()).delete("recordings", id);
}

export async function renameRecording(id: string, title: string): Promise<void> {
  const database = await db();
  const item = await database.get("recordings", id);
  if (!item) return;
  item.title = title;
  await database.put("recordings", item);
}

export async function duplicateRecording(id: string): Promise<RecordingItem | undefined> {
  const database = await db();
  const item = await database.get("recordings", id);
  if (!item) return undefined;
  const clone: RecordingItem = {
    ...item,
    id: crypto.randomUUID(),
    title: `${item.title} (copy)`,
    createdAt: Date.now()
  };
  await database.put("recordings", clone);
  return clone;
}
