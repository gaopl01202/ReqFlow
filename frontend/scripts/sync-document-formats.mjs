import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const { DEFAULT_RENDERER_DEFINITIONS: definitions } =
  await import("../node_modules/@file-viewer/core/dist/registry/formats.generated.js");
const { version } = JSON.parse(
  readFileSync(
    new URL("../node_modules/@file-viewer/react/package.json", import.meta.url),
    "utf8",
  ),
);
const extensions = JSON.parse(
  readFileSync(
    new URL("../document-preview-formats.json", import.meta.url),
    "utf8",
  ),
).sort();
const attachmentExtensions = JSON.parse(
  readFileSync(
    new URL("../work-item-attachment-formats.json", import.meta.url),
    "utf8",
  ),
).sort();
const viewerExtensions = [
  ...new Set([...extensions, ...attachmentExtensions]),
].sort();
for (const extension of viewerExtensions) {
  if (
    !definitions.some((definition) => definition.extensions.includes(extension))
  ) {
    throw new Error(`Unknown preview format: ${extension}`);
  }
}
const output = JSON.stringify({ version, extensions }, null, 2) + "\n";
for (const path of [
  "../src/generated/document-formats.json",
  "../../backend/core/document_formats.json",
])
  writeFileSync(fileURLToPath(new URL(path, import.meta.url)), output);
const attachmentOutput =
  JSON.stringify(
    {
      version,
      extensions: attachmentExtensions.map((extension) => `.${extension}`),
    },
    null,
    2,
  ) + "\n";
writeFileSync(
  fileURLToPath(
    new URL("../../backend/core/attachment_formats.json", import.meta.url),
  ),
  attachmentOutput,
);
const viewerOutput =
  JSON.stringify({ version, extensions: viewerExtensions }, null, 2) + "\n";
writeFileSync(
  fileURLToPath(
    new URL("../src/generated/viewer-formats.json", import.meta.url),
  ),
  viewerOutput,
);
console.log(
  `File Viewer ${version}: ${extensions.length} document imports, ${attachmentExtensions.length} work-item attachments, ${viewerExtensions.length} browser previews`,
);
const lines = [
  `# 导入与预览格式清单`,
  ``,
  `File Viewer ${version} 按需渲染器，${extensions.length} 个导入扩展名。此表为组件内置可尝试预览的白名单，不代表所有文件都能完整还原。Office、XMind等实测范围见 verification.md。`,
  ``,
  `资源本地部署，按格式加载，不使用后端转换。旧PPT公开引擎保留上游水印。`,
  ``,
  `| 组件格式组 | 扩展名 |`,
  `| --- | --- |`,
];
for (const definition of definitions) {
  const types = definition.extensions.filter((extension) =>
    extensions.includes(extension),
  );
  if (types.length)
    lines.push(
      `| ${definition.label} | ${types.map((extension) => `\`${extension}\``).join("、")} |`,
    );
}
writeFileSync(
  fileURLToPath(new URL("../../docs/document-formats.md", import.meta.url)),
  lines.join("\n") + "\n",
);
