import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  useRef,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { Alert, Button, Input, Spin, Tooltip } from "antd";
import {
  SearchOutlined,
  DownloadOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  CloseOutlined,
  UpOutlined,
  DownOutlined,
} from "@ant-design/icons";
import type {
  FileViewerHandle,
  ViewerState,
  ViewerOptions,
} from "@file-viewer/react";

import viewerFormats from "./generated/viewer-formats.json";

const supportedDescription = `当前支持：${viewerFormats.extensions.join("、")}。`;
const Viewer = lazy(() => import("@file-viewer/react"));
const options: ViewerOptions = {
  locale: "zh-CN",
  theme: "light",
  styleIsolation: "scoped",
  ui: { surfaceBackground: "#e7e9ec" },
  messages: {
    "state.unsupported.description": supportedDescription,
    "state.unsupported.install.description": supportedDescription,
  },
  docx: {
    externalLinkPolicy: "block",
    externalResourcePolicy: "block",
    renderAltChunks: false,
  },
  toolbar: {
    position: "bottom-right",
    download: false,
    print: false,
    exportHtml: false,
    zoom: false,
    search: false,
    theme: false,
  },
};

class PreviewBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Alert
        type="error"
        title="预览组件加载失败"
        description="请刷新页面重试。"
        action={<Button onClick={() => window.location.reload()}>刷新</Button>}
      />
    ) : (
      this.props.children
    );
  }
}
/** Only authenticated original bytes enter the local, format-lazy viewer. */
export function FilePreview({
  src,
  kind,
  name,
  canDownload = true,
}: {
  src: string;
  kind: string;
  name?: string;
  canDownload?: boolean;
}) {
  const viewer = useRef<FileViewerHandle>(null);
  const container = useRef<HTMLDivElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const [searchTop, setSearchTop] = useState(0);
  const [state, setState] = useState<ViewerState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [actionError, setActionError] = useState("");
  const run = async (action: () => unknown) => {
    setActionError("");
    try {
      await action();
    } catch {
      setActionError("操作失败，请重试");
    }
  };
  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  useLayoutEffect(() => {
    if (!searchOpen) return;
    const align = () => {
      const button = searchButton.current?.getBoundingClientRect();
      const host = container.current?.getBoundingClientRect();
      if (button && host)
        setSearchTop(button.top + button.height / 2 - host.top);
    };
    align();
    const observer = new ResizeObserver(align);
    if (container.current) observer.observe(container.current);
    window.addEventListener("resize", align);
    document.addEventListener("fullscreenchange", align);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", align);
      document.removeEventListener("fullscreenchange", align);
    };
  }, [searchOpen]);
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const downloadOriginal = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([data]));
    const link = document.createElement("a");
    link.href = url;
    link.download = name || `preview.${kind}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    setReady(false);
    setState(null);
    setSearchOpen(false);
    setQuery("");
    setActionError("");
    fetch(src, { credentials: "same-origin", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("文件加载失败或无权访问，请刷新重试");
        return response.arrayBuffer();
      })
      .then(setData)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [src]);
  return (
    <div
      ref={container}
      className="unified-file-preview"
      aria-label="文档在线预览"
      data-preview-ready={ready ? "true" : "false"}
    >
      {error && <Alert type="error" title={error} />}
      {data ? (
        <PreviewBoundary key={src}>
          <Suspense fallback={<Spin description="正在加载预览组件" />}>
            <Viewer
              ref={viewer}
              key={src}
              buffer={data}
              type={kind}
              filename={encodeURIComponent(name || `preview.${kind}`)}
              name={name || `preview.${kind}`}
              options={options}
              style={{ width: "100%", height: "100%", minHeight: 0 }}
              onStateChange={(state) => {
                setReady(state.ready);
                setState(state);
              }}
            />
          </Suspense>
        </PreviewBoundary>
      ) : (
        !error && <Spin description="正在加载文件" />
      )}
      {ready && !state?.error && (
        <>
          <div
            className="preview-side-tools"
            role="toolbar"
            aria-label="文档操作"
          >
            <Tooltip title="搜索">
              <Button
                type="text"
                ref={searchButton}
                aria-label="搜索文档"
                aria-expanded={searchOpen}
                icon={<SearchOutlined />}
                onClick={() => setSearchOpen(!searchOpen)}
              />
            </Tooltip>
            {canDownload && (
              <Tooltip title="下载">
                <Button
                  type="text"
                  aria-label="下载"
                  icon={<DownloadOutlined />}
                  onClick={() => run(downloadOriginal)}
                />
              </Tooltip>
            )}
            <span className="preview-tool-divider" role="separator" />
            <Tooltip title="放大">
              <Button
                type="text"
                aria-label="放大预览"
                disabled={!state?.zoom?.canZoomIn}
                icon={<ZoomInOutlined />}
                onClick={() => run(() => viewer.current?.zoomIn())}
              />
            </Tooltip>
            <Tooltip title="恢复到 100%">
              <Button
                type="text"
                className="preview-zoom-value"
                aria-label="恢复到 100%"
                disabled={!state?.zoom?.canReset || state.zoom.scale === 1}
                onClick={() => run(() => viewer.current?.resetZoom())}
              >
                {state?.zoom?.label || "—"}
              </Button>
            </Tooltip>
            <Tooltip title="缩小">
              <Button
                type="text"
                aria-label="缩小预览"
                disabled={!state?.zoom?.canZoomOut}
                icon={<ZoomOutOutlined />}
                onClick={() => run(() => viewer.current?.zoomOut())}
              />
            </Tooltip>
            <span className="preview-tool-divider" role="separator" />
            <Tooltip title={fullscreen ? "退出全屏" : "全屏"}>
              <Button
                type="text"
                aria-label={fullscreen ? "退出全屏" : "全屏"}
                icon={
                  fullscreen ? (
                    <FullscreenExitOutlined />
                  ) : (
                    <FullscreenOutlined />
                  )
                }
                onClick={() =>
                  run(() =>
                    fullscreen
                      ? document.exitFullscreen()
                      : container.current?.requestFullscreen(),
                  )
                }
              />
            </Tooltip>
          </div>
          {searchOpen && (
            <form
              className="preview-search-panel"
              style={{ top: searchTop }}
              role="search"
              aria-label="文档搜索"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() =>
                  query.trim()
                    ? viewer.current?.searchDocument(query.trim())
                    : viewer.current?.clearDocumentSearch(),
                );
              }}
            >
              <Input
                autoFocus
                aria-label="搜索内容"
                placeholder="搜索文档内容"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button
                htmlType="submit"
                type="text"
                aria-label="搜索"
                icon={<SearchOutlined />}
              />
              <span className="preview-search-count" aria-live="polite">
                {state?.search?.total ? state.search.currentIndex + 1 : 0}/
                {state?.search?.total || 0}
              </span>
              <Button
                type="text"
                aria-label="上一个结果"
                disabled={!state?.search?.total}
                icon={<UpOutlined />}
                onClick={() =>
                  run(() => viewer.current?.previousSearchResult())
                }
              />
              <Button
                type="text"
                aria-label="下一个结果"
                disabled={!state?.search?.total}
                icon={<DownOutlined />}
                onClick={() => run(() => viewer.current?.nextSearchResult())}
              />
              <Button
                type="text"
                aria-label="关闭搜索"
                icon={<CloseOutlined />}
                onClick={() => {
                  setSearchOpen(false);
                  void run(() => viewer.current?.clearDocumentSearch());
                }}
              />
            </form>
          )}
        </>
      )}
      {actionError && (
        <Alert
          className="preview-action-error"
          type="error"
          title={actionError}
          closable
          onClose={() => setActionError("")}
        />
      )}
    </div>
  );
}
