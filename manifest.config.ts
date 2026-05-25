import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "LocalLoom",
  description: "Local-first Loom-like screen recorder. No cloud upload.",
  version: "0.1.0",
  action: {
    default_title: "LocalLoom",
    default_popup: "src/popup/index.html",
    default_icon: "icon-128.png"
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module"
  },
  options_page: "src/library/index.html",
  icons: {
    "128": "icon-128.png"
  },
  permissions: ["storage", "downloads", "notifications", "offscreen"],
  commands: {
    "start-recording": {
      suggested_key: { default: "Ctrl+Shift+R", mac: "Command+Shift+R" },
      description: "Open recorder"
    },
    "open-library": {
      suggested_key: { default: "Ctrl+Shift+L", mac: "Command+Shift+L" },
      description: "Open video library"
    }
  },
  web_accessible_resources: [
    {
      resources: ["src/recorder/index.html", "src/library/index.html"],
      matches: ["<all_urls>"]
    }
  ]
});
