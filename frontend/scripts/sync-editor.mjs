import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Serve the locked editor runtime locally; no CDN or remote document transfer.
for (const file of [
  "js/lute/lute.min.js",
  "js/i18n/zh_CN.js",
  "js/icons/ant.js",
  "css/content-theme/light.css",
]) {
  const target = resolve(root, "public/vendor/vditor/dist", file);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(resolve(root, "node_modules/vditor/dist", file), target);
}
