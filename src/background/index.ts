import type { RuntimeMessage } from "../shared/types";

const RECORDER_WINDOW_KEY = "localloom.recorderWindowId";
const PENDING_SETTINGS_KEY = "localloom.pendingSettings";

async function openRecorderWindow(): Promise<void> {
  const state = await chrome.storage.session.get(RECORDER_WINDOW_KEY);
  const existingId = state[RECORDER_WINDOW_KEY] as number | undefined;

  if (existingId) {
    try {
      await chrome.windows.update(existingId, { focused: true });
      return;
    } catch {
      // stale id, continue
    }
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("src/recorder/index.html"),
    type: "popup",
    width: 520,
    height: 760,
    focused: true
  });

  if (win.id) {
    await chrome.storage.session.set({ [RECORDER_WINDOW_KEY]: win.id });
  }
}

async function openLibraryPage(): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL("src/library/index.html") });
}

chrome.windows.onRemoved.addListener(async (windowId) => {
  const state = await chrome.storage.session.get(RECORDER_WINDOW_KEY);
  if (state[RECORDER_WINDOW_KEY] === windowId) {
    await chrome.storage.session.remove(RECORDER_WINDOW_KEY);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("LocalLoom installed");
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "start-recording") {
    await openRecorderWindow();
  }
  if (command === "open-library") {
    await openLibraryPage();
  }
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  (async () => {
    if (message.type === "POPUP_OPEN_RECORDER") {
      await chrome.storage.session.set({ [PENDING_SETTINGS_KEY]: message.payload.settings });
      await openRecorderWindow();
    }

    if (message.type === "OPEN_LIBRARY") {
      await openLibraryPage();
    }

    if (message.type === "REQUEST_INITIAL_SETTINGS") {
      const state = await chrome.storage.session.get(PENDING_SETTINGS_KEY);
      const settings = state[PENDING_SETTINGS_KEY];
      chrome.runtime.sendMessage({
        type: "INITIAL_SETTINGS",
        payload: { settings }
      } satisfies RuntimeMessage);
      await chrome.storage.session.remove(PENDING_SETTINGS_KEY);
    }

    if (message.type === "RECORDING_SAVED") {
      await chrome.notifications.create({
        type: "basic",
        iconUrl: "icon-128.png",
        title: "Recording saved",
        message: `${message.payload.title} added to local library.`
      });
    }
  })();

  return false;
});
