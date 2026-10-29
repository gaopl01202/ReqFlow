import { useEffect, useState } from "react";
import { api, type Row } from "./api";
import { routeQuery } from "./routes";
import { canAction } from "./permissions";
import { Alert, Button, Typography } from "antd";
import { CloseOutlined, DownloadOutlined } from "@ant-design/icons";
import { FilePreview } from "./file-preview";
import formats from "./generated/viewer-formats.json";

export function attachmentPreviewHref(file: Record<string, unknown>) {
  return `/attachments/${encodeURIComponent(String(file.id))}`;
}
export function AttachmentPreviewPage({ user }: { user: Row }) {
  const id = routeQuery().get("attachment_preview") || "";
  const [metadata, setMetadata] = useState<Row | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api(`attachments/${encodeURIComponent(id)}/metadata`)
      .then((record) => {
        if (!active) return;
        setMetadata(record);
        window.history.replaceState(
          null,
          "",
          `/attachments/${encodeURIComponent(id)}`,
        );
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  const name = metadata?.original_name || "附件";
  const kind = name.split(".").pop()?.toLowerCase() || "";
  const src = `/api/v1/attachments/${encodeURIComponent(id)}`;
  const download = metadata && canAction(user, metadata.scope, "download");
  return (
    <main className="attachment-preview-page">
      <header className="item-titlebar document-titlebar">
        <Button
          aria-label="关闭"
          title="关闭标签页"
          icon={<CloseOutlined />}
          onClick={() => window.close()}
        />
        <Typography.Title level={3}>{name}</Typography.Title>
        <Typography.Text type="secondary">{kind}</Typography.Text>
      </header>
      {error ? (
        <Alert type="error" title={error} />
      ) : !metadata ? (
        <Typography.Text>正在加载附件…</Typography.Text>
      ) : formats.extensions.includes(kind) ? (
        <FilePreview
          src={src + "?preview=1"}
          name={name}
          kind={kind}
          canDownload={!!download}
        />
      ) : (
        <div className="attachment-preview-fallback">
          <Alert
            type="info"
            title="此附件暂不支持在线预览"
            description={`当前支持：${formats.extensions.join("、")}。`}
          />
          {download && (
            <Button href={src} icon={<DownloadOutlined />}>
              下载原文件
            </Button>
          )}
        </div>
      )}
    </main>
  );
}
