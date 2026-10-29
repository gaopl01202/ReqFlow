import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileViewerRenderers } from "@file-viewer/vite-plugin";
import formats from "./document-preview-formats.json";
import attachmentFormats from "./work-item-attachment-formats.json";
export default defineConfig({
  cacheDir: "node_modules/.vite/reqflow-app",
  plugins: [
    react(),
    fileViewerRenderers({
      formats: [...new Set([...formats, ...attachmentFormats])],
      autoPresets: false,
      copyAssets: { baseDir: "file-viewer" },
    }),
  ],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
