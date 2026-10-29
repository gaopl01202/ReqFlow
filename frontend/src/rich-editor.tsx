import { attachmentPreviewHref } from "./attachment-preview";
import { useEffect, useRef, useState } from "react";
import Vditor from "vditor";
import { Alert, Spin, message } from "antd";
import "vditor/dist/index.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
const colorSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    span: [["style", /^color:\s*#[0-9a-f]{6};?$/i]],
  },
};
const textColors = [
  ["红色", "#f5222d"],
  ["橙色", "#fa8c16"],
  ["黄色", "#ad8b00"],
  ["绿色", "#389e0d"],
  ["蓝色", "#1677ff"],
  ["紫色", "#722ed1"],
  ["灰色", "#8c8c8c"],
  ["黑色", "#262626"],
];
export type PendingFile = { file: File; token: string };
const previewUrls = new Map<string, string>();
export function restoreFilePreviews(files: PendingFile[]) {
  for (const { token, file } of files)
    if (file.type.startsWith("image/") && !previewUrls.has(token))
      previewUrls.set(token, URL.createObjectURL(file));
}
export function clearFilePreviews() {
  for (const url of previewUrls.values()) URL.revokeObjectURL(url);
  previewUrls.clear();
}
export function RichContent({ value }: { value: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, colorSchema]]}
        components={{
          a: ({ href, children }) => {
            const match = href?.match(
              /^\/api\/v1\/attachments\/([a-zA-Z0-9-]+)(?:\?.*)?$/,
            );
            return match ? (
              <a
                href={attachmentPreviewHref({
                  id: match[1],
                  original_name:
                    typeof children === "string" ? children : "附件",
                })}
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            ) : (
              <a href={href}>{children}</a>
            );
          },
          img: ({ src, alt }) =>
            src?.startsWith("/api/v1/attachments/") ? (
              <img src={src} alt={alt || "图片"} />
            ) : null,
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}
let runtime: Promise<void> | null = null;
function loadRuntime() {
  if (!runtime)
    runtime = Promise.all(
      [
        ["vditorI18nScriptzh_CN", "/vendor/vditor/dist/js/i18n/zh_CN.js"],
        ["vditorLuteScript", "/vendor/vditor/dist/js/lute/lute.min.js"],
      ].map(
        ([id, src]) =>
          new Promise<void>((resolve, reject) => {
            if (document.getElementById(id)) {
              resolve();
              return;
            }
            const script = document.createElement("script");
            script.src = src;
            script.onload = () => {
              script.id = id;
              resolve();
            };
            script.onerror = () => {
              script.remove();
              reject(new Error("编辑器加载失败，请刷新重试"));
            };
            document.head.appendChild(script);
          }),
      ),
    )
      .then(() => {})
      .catch((error) => {
        runtime = null;
        throw error;
      });
  return runtime;
}
export function RichEditor({
  value = "",
  onChange,
  id,
  "aria-label": label,
  onAddFile,
  placeholder,
  compact = false,
}: {
  compact?: boolean;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  id?: string;
  "aria-label"?: string;
  onAddFile?: (file: File) => string | null;
}) {
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState("");
  const host = useRef<HTMLDivElement>(null),
    instance = useRef<Vditor | null>(null);
  const props = useRef({ onChange, onAddFile, value });
  props.current = { onChange, onAddFile, value };
  const ready = useRef(false);
  const preview = (text: string) => {
    for (const [token, url] of previewUrls) text = text.replaceAll(token, url);
    return text;
  };
  const stored = (text: string) => {
    for (const [token, url] of previewUrls) text = text.replaceAll(url, token);
    return text;
  };
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let disposed = false;
    const emit = () => {
      if (ready.current && instance.current)
        props.current.onChange?.(stored(instance.current.getValue()));
    };
    const insert = (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const token = props.current.onAddFile?.(file);
      if (!token) return;
      const url = URL.createObjectURL(file);
      previewUrls.set(token, url);
      instance.current?.insertValue(
        `\n![${file.name.replace(/[\[\]\n]/g, "")}](${url})\n`,
      );
      emit();
    };
    const capture = (event: ClipboardEvent | DragEvent) => {
      const data =
        "clipboardData" in event ? event.clipboardData : event.dataTransfer;
      const files = Array.from(data?.files || []).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (!files.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      files.forEach(insert);
    };
    node.addEventListener("input", emit);
    node.addEventListener("blur", emit, true);
    node.addEventListener("keyup", emit);
    node.addEventListener("paste", capture, true);
    node.addEventListener("drop", capture, true);
    let editor: Vditor | null = null;
    loadRuntime()
      .then(() => {
        if (disposed) return;
        editor = new Vditor(node, {
          cdn: "/vendor/vditor",
          lang: "zh_CN",
          mode: "ir",
          icon: "ant",
          height: "auto",
          minHeight: compact ? 120 : 380,
          placeholder,
          value: preview(props.current.value),
          cache: { enable: false },
          toolbar: [
            "headings",
            "bold",
            "italic",
            "strike",
            {
              name: "text-color",
              tip: "文字颜色",
              icon: '<svg viewBox="0 0 24 24"><path d="M5 18h14v3H5z" fill="#1677ff"/><path d="m8 16 4-11 4 11m-6.5-4h5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
              toolbar: textColors.map(([name, color]) => ({
                name: `text-color-${color.slice(1)}`,
                tip: name,
                click: (event) => {
                  event.preventDefault();
                  const selected = instance.current?.getSelection();
                  if (!selected) {
                    message.info("请先选中要调整颜色的文字");
                    return;
                  }
                  const escaped = selected
                    .replaceAll("&", "&amp;")
                    .replaceAll("<", "&lt;")
                    .replaceAll(">", "&gt;");
                  instance.current?.insertMD(
                    `<span style="color: ${color}">${escaped}</span>`,
                  );
                  emit();
                },
              })),
            },
            "|",
            "list",
            "ordered-list",
            "check",
            "quote",
            "code",
            "inline-code",
            "link",
            "table",
            "upload",
            "|",
            "undo",
            "redo",
          ],
          toolbarConfig: { pin: false },
          counter: { enable: false },
          resize: { enable: false },
          outline: { enable: false, position: "left" },
          preview: {
            hljs: { enable: false },
            markdown: {
              sanitize: true,
              codeBlockPreview: false,
              mathBlockPreview: false,
              inlineMath: false,
            },
            render: { media: { enable: false } },
            theme: {
              current: "light",
              path: "/vendor/vditor/dist/css/content-theme",
            },
          },
          upload: {
            accept: "image/png,image/jpeg",
            handler: (files) => {
              Array.from(files).forEach(insert);
              return null;
            },
          },
          input: emit,
          after: () => {
            if (disposed) {
              editor?.destroy();
              return;
            }
            ready.current = true;
            setLoading(false);
            const input = node.querySelector<HTMLElement>(
              ".vditor-ir .vditor-reset",
            );
            if (input) {
              input.setAttribute("role", "textbox");
              input.setAttribute("aria-label", label || "内容编辑器");
              input.setAttribute("aria-multiline", "true");
              if (id) input.id = id;
            }
          },
        });
        instance.current = editor;
      })
      .catch((error) => {
        if (!disposed) {
          setLoadError(error.message);
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
      node.removeEventListener("input", emit);
      node.removeEventListener("blur", emit, true);
      node.removeEventListener("keyup", emit);
      node.removeEventListener("paste", capture, true);
      node.removeEventListener("drop", capture, true);
      if (ready.current) editor?.destroy();
      ready.current = false;
      instance.current = null;
    };
  }, [id, label]);
  useEffect(() => {
    const editor = instance.current;
    if (ready.current && editor && stored(editor.getValue()) !== value)
      editor.setValue(preview(value), true);
  }, [value]);
  return (
    <div
      className={"markdown-editor-shell" + (compact ? " compact-editor" : "")}
    >
      {loadError && <Alert type="error" title={loadError} />}
      <div ref={host} className="markdown-editor" />
      {loading && (
        <div className="editor-loading">
          <Spin description="正在加载编辑器" />
        </div>
      )}
    </div>
  );
}
