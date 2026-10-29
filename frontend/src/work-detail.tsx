import { copyDetailLink } from "./routes";
import { canAction } from "./permissions";
import { attachmentPreviewHref } from "./attachment-preview";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dropdown,
  App,
  Input,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  LinkOutlined,
  MoreOutlined,
  CopyOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  PlusOutlined,
  DownloadOutlined,
  EditOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { RichContent, RichEditor, type PendingFile } from "./rich-editor";
import { DocumentIcon } from "./document-icon";
import {
  WorkTypeBadge,
  AttachmentPicker,
  attachmentError,
  PriorityTag,
  actionNames,
  localizedSnapshot,
} from "./ui";
import { time, type Row } from "./api";
const { Title, Text, Paragraph } = Typography;
export function WorkDetail({
  item,
  user,
  members,
  attachments,
  comments,
  history,
  states,
  transitions,
  metadata,
  writable,
  canEdit,
  manager,
  onEdit,
  onCopy,
  onRenameTitle,
  onDelete,
  onUpload,
  onDeleteAttachment,
  onComment,
  onEditComment,
  onDeleteComment,
  onTransition,
}: {
  item: Row;
  user: Row;
  members: Row[];
  attachments: Row[];
  comments: Row[];
  history: Row[];
  states: Row[];
  transitions: Row[];
  metadata: { key: string; label: string; children: React.ReactNode }[];
  writable: boolean;
  canEdit: boolean;
  manager: boolean;
  onEdit: () => void;
  onCopy: () => void;
  onRenameTitle: (title: string) => Promise<boolean>;
  onDelete: () => void;
  onUpload: (files: File[]) => Promise<void>;
  onDeleteAttachment: (file: Row) => void;
  onComment: (data: Row | FormData) => Promise<boolean>;
  onEditComment: (comment: Row, data: Row | FormData) => Promise<boolean>;
  onDeleteComment: (comment: Row) => void;
  onTransition: (data: Row | FormData) => Promise<boolean>;
}) {
  const { message, modal } = App.useApp();
  const permitted = (operation: string) => canAction(user, "items", operation);
  const canCopy = writable && permitted("create");
  const canDelete =
    writable && permitted("delete") && (manager || item.created_by === user.id);
  const canTransition = writable && permitted("transition");
  const [target, setTarget] = useState("");
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(item.title);
  const [titleSaving, setTitleSaving] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const workflowSection = useRef<HTMLElement>(null);
  useEffect(() => {
    if (reactivating)
      workflowSection.current?.scrollIntoView({ block: "start" });
  }, [reactivating]);
  const [handlers, setHandlers] = useState<string[]>(
    item.handlers?.length
      ? item.handlers
      : item.assignee
        ? [item.assignee]
        : [],
  );
  const [transitionAttempted, setTransitionAttempted] = useState(false);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState("");
  const [commentOpen, setCommentOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attachmentOpen, setAttachmentOpen] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingComment, setEditingComment] = useState<Row | null>(null);
  const [editBody, setEditBody] = useState("");
  const [files, setFiles] = useState<Record<string, PendingFile[]>>({});
  const addImage = (key: string) => (file: File) => {
    if (!permitted("upload")) {
      message.warning("没有添加图片的权限");
      return null;
    }
    const error = attachmentError(file, user);
    if (error) {
      message.warning(error);
      return null;
    }
    if ((files[key]?.length || 0) >= 20) {
      message.warning("单次最多添加20张图片");
      return null;
    }
    const token = "reqflow-upload:" + crypto.randomUUID();
    setFiles((previous) => ({
      ...previous,
      [key]: [...(previous[key] || []), { file, token }],
    }));
    return token;
  };
  const payload = (data: Row, key: string): Row | FormData => {
    if (!files[key]?.length) return data;
    const form = new FormData();
    form.append(
      "payload",
      JSON.stringify({
        ...data,
        upload_tokens: files[key].map((file) => file.token),
      }),
    );
    for (const entry of files[key]) form.append("files", entry.file);
    return form;
  };
  const people = members
    .filter((m) => m.role !== "readonly")
    .map((m) => ({ value: m.user, label: m.display_name }));
  const allowed = transitions.filter(
    (t) => t.from === item.status && t.enabled,
  );
  const pending = states.filter(
    (state) => state.category === "pending" && state.code !== item.status,
  );
  const canReactivate = !allowed.length && pending.length > 0;
  const choices = reactivating
    ? pending
    : states.filter((state) => allowed.some((edge) => edge.to === state.code));
  const showFields = canTransition && (allowed.length > 0 || reactivating);
  const saveTitle = async () => {
    const title = titleDraft.trim();
    if (!title) {
      message.warning("标题不能为空");
      return;
    }
    if (title === item.title) {
      setTitleEditing(false);
      return;
    }
    setTitleSaving(true);
    try {
      if (await onRenameTitle(title)) setTitleEditing(false);
    } finally {
      setTitleSaving(false);
    }
  };
  return (
    <div className="item-detail-layout">
      <header className="item-titlebar">
        <WorkTypeBadge type={item.type} />
        {titleEditing ? (
          <div className="item-title-edit">
            <Input
              aria-label="工作项标题"
              autoFocus
              maxLength={200}
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onPressEnter={() => void saveTitle()}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setTitleDraft(item.title);
                  setTitleEditing(false);
                }
              }}
            />
            <Button
              type="primary"
              loading={titleSaving}
              onClick={() => void saveTitle()}
            >
              保存
            </Button>
            <Button
              disabled={titleSaving}
              onClick={() => {
                setTitleDraft(item.title);
                setTitleEditing(false);
              }}
            >
              取消
            </Button>
          </div>
        ) : (
          <div className="item-title-heading">
            <Title level={3}>{item.title}</Title>
            {canEdit && (
              <Button
                type="text"
                size="small"
                aria-label="编辑标题"
                title="编辑标题"
                icon={<EditOutlined />}
                onClick={() => {
                  setTitleDraft(item.title);
                  setTitleEditing(true);
                }}
              />
            )}
          </div>
        )}
        <Text type="secondary" className="item-number">
          {item.number}
        </Text>
        <Space className="item-title-actions">
          <Button
            type="text"
            aria-label="复制链接"
            title="复制链接"
            icon={<LinkOutlined />}
            onClick={() => {
              copyDetailLink(item.web_url)
                .then(() =>
                  message.success("链接已复制，对方需登录并具有访问权限"),
                )
                .catch(() => message.info("请复制浏览器地址栏中的链接"));
            }}
          />
          {canEdit && (
            <Button
              type="primary"
              aria-label="编辑"
              title="编辑"
              icon={<EditOutlined />}
              onClick={onEdit}
            >
              编辑
            </Button>
          )}
          {(canCopy || canDelete) && (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  ...(canCopy
                    ? [
                        {
                          key: "copy",
                          label: "复制",
                          icon: <CopyOutlined aria-hidden />,
                        },
                      ]
                    : []),
                  ...(canDelete
                    ? [
                        {
                          key: "delete",
                          label: "删除",
                          danger: true,
                          icon: <DeleteOutlined aria-hidden />,
                        },
                      ]
                    : []),
                ],
                onClick: ({ key }) => {
                  if (key === "copy") onCopy();
                  else
                    modal.confirm({
                      title: "确认删除？关联项将保留历史引用。",
                      okText: "删除",
                      cancelText: "取消",
                      okButtonProps: { danger: true },
                      onOk: onDelete,
                    });
                },
              }}
            >
              <Button
                type="text"
                aria-label="更多"
                title="更多"
                icon={<MoreOutlined />}
              />
            </Dropdown>
          )}
        </Space>
      </header>
      <div className="item-detail-columns">
        <div className="item-detail-left">
          <section className="detail-description">
            <RichContent value={item.description || "暂无描述"} />
          </section>
          <section className="detail-attachments">
            <div className="section-title">
              <Button
                type="text"
                className="section-toggle"
                aria-label="折叠附件"
                aria-expanded={attachmentOpen}
                onClick={() => setAttachmentOpen(!attachmentOpen)}
                icon={
                  attachmentOpen ? (
                    <CaretDownOutlined />
                  ) : (
                    <CaretRightOutlined />
                  )
                }
              >
                附件{attachments.length ? `（${attachments.length}）` : ""}
              </Button>
              {writable && permitted("upload") && (
                <AttachmentPicker
                  user={user}
                  onFiles={onUpload}
                  browserDrop
                  compact
                />
              )}
            </div>
            {attachmentOpen && (
              <div className="attachment-list">
                {attachments.map((a) => (
                  <div className="attachment-file" key={a.id}>
                    <DocumentIcon
                      kind={
                        a.original_name?.split(".").pop()?.toLowerCase() || ""
                      }
                      className="attachment-file-icon"
                    />
                    <a
                      className="attachment-name"
                      href={attachmentPreviewHref(a)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {a.original_name}
                    </a>
                    <Space size={0} className="attachment-row-actions">
                      {permitted("download") && (
                        <Button
                          type="text"
                          size="small"
                          aria-label={"下载附件 " + a.original_name}
                          title="下载"
                          href={"/api/v1/attachments/" + a.id}
                          icon={<DownloadOutlined />}
                        />
                      )}
                      {writable &&
                        permitted("delete_attachment") &&
                        (a.uploaded_by === user.id || manager) && (
                          <Popconfirm
                            title="删除附件？"
                            onConfirm={() => onDeleteAttachment(a)}
                          >
                            <Button
                              type="text"
                              size="small"
                              aria-label={"删除附件 " + a.original_name}
                              title="删除"
                              icon={<DeleteOutlined />}
                            />
                          </Popconfirm>
                        )}
                    </Space>
                    <Text className="attachment-author" type="secondary">
                      {a.uploaded_by_name ||
                        members.find((m) => m.user === a.uploaded_by)
                          ?.display_name ||
                        "历史成员"}
                    </Text>
                    <Text className="attachment-date" type="secondary">
                      {time(a.created_at)}
                    </Text>
                  </div>
                ))}
                {!attachments.length && <Text type="secondary">暂无附件</Text>}
              </div>
            )}
          </section>
          <section className="detail-discussion">
            <div className="section-title">
              <Button
                type="text"
                className="section-toggle"
                aria-label="折叠评论"
                aria-expanded={commentOpen}
                onClick={() => setCommentOpen(!commentOpen)}
                icon={
                  commentOpen ? <CaretDownOutlined /> : <CaretRightOutlined />
                }
              >
                评论{comments.length ? `（${comments.length}）` : ""}
              </Button>
              {writable && permitted("comment") && (
                <Button
                  type="text"
                  aria-label="添加评论"
                  title="添加评论"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setCommentOpen(true);
                    setComposerOpen(!composerOpen);
                  }}
                />
              )}
            </div>
            {commentOpen && (
              <>
                {comments.map((c) => (
                  <div className="comment-row" key={c.id}>
                    <div className="comment-main">
                      <div className="comment-heading">
                        <Text strong>
                          {c.author_name ||
                            members.find((m) => m.user === c.author)
                              ?.display_name ||
                            "历史成员"}
                        </Text>
                        <Text type="secondary">
                          （{c.workflow_status_name || "历史状态未知"}）
                        </Text>
                      </div>
                      {editingComment?.id === c.id ? (
                        <div className="comment-composer">
                          <RichEditor
                            compact
                            aria-label="编辑评论内容"
                            value={editBody}
                            onChange={setEditBody}
                            onAddFile={addImage("edit")}
                            placeholder="请输入评论"
                          />
                          <Space>
                            <Button
                              aria-label="保存评论"
                              type="primary"
                              loading={saving}
                              disabled={!editBody.trim()}
                              onClick={async () => {
                                setSaving(true);
                                try {
                                  if (
                                    await onEditComment(
                                      c,
                                      payload(
                                        { version: c.version, body: editBody },
                                        "edit",
                                      ),
                                    )
                                  )
                                    setEditingComment(null);
                                } finally {
                                  setSaving(false);
                                }
                              }}
                            >
                              保存评论
                            </Button>
                            <Button onClick={() => setEditingComment(null)}>
                              取消编辑
                            </Button>
                          </Space>
                        </div>
                      ) : (
                        <RichContent value={c.body} />
                      )}
                    </div>
                    <div className="comment-actions">
                      <Text type="secondary" title={time(c.created_at)}>
                        {time(c.created_at)}
                      </Text>
                      <Space size={0}>
                        {writable &&
                          permitted("comment") &&
                          c.author === user.id && (
                            <Button
                              type="text"
                              size="small"
                              title="编辑"
                              aria-label="编辑评论"
                              icon={<EditOutlined />}
                              onClick={() => {
                                setEditingComment(c);
                                setEditBody(c.body);
                                setFiles((previous) => ({
                                  ...previous,
                                  edit: [],
                                }));
                              }}
                            />
                          )}
                        {writable &&
                          permitted("comment") &&
                          (c.author === user.id || manager) && (
                            <Popconfirm
                              title="确认删除评论？"
                              onConfirm={() => onDeleteComment(c)}
                            >
                              <Button
                                type="text"
                                size="small"
                                title="删除"
                                aria-label="删除评论"
                                icon={<DeleteOutlined />}
                              />
                            </Popconfirm>
                          )}
                      </Space>
                    </div>
                  </div>
                ))}
                {writable && permitted("comment") && composerOpen && (
                  <div className="comment-composer">
                    <RichEditor
                      compact
                      aria-label="评论内容"
                      value={comment}
                      onChange={setComment}
                      onAddFile={addImage("comment")}
                      placeholder="请输入评论"
                    />
                    <Space>
                      <Button
                        aria-label="发送评论"
                        type="primary"
                        loading={saving}
                        disabled={!comment.trim()}
                        onClick={async () => {
                          setSaving(true);
                          try {
                            if (
                              await onComment(
                                payload({ body: comment }, "comment"),
                              )
                            ) {
                              setComment("");
                              setFiles((previous) => ({
                                ...previous,
                                comment: [],
                              }));
                              setComposerOpen(false);
                            }
                          } finally {
                            setSaving(false);
                          }
                        }}
                      >
                        发送评论
                      </Button>
                      <Button onClick={() => setComposerOpen(false)}>
                        取消
                      </Button>
                    </Space>
                  </div>
                )}
                {!comments.length && !composerOpen && (
                  <Text type="secondary">暂无评论</Text>
                )}
              </>
            )}
          </section>
          <section className="detail-history">
            <div className="section-title">
              <Button
                type="text"
                className="section-toggle"
                aria-label="折叠操作记录"
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen(!historyOpen)}
                icon={
                  historyOpen ? <CaretDownOutlined /> : <CaretRightOutlined />
                }
              >
                操作记录{history.length ? `（${history.length}）` : ""}
              </Button>
            </div>
            {historyOpen && (
              <div className="history-list">
                {history.map((h) => (
                  <div className="history-row" key={h.id}>
                    <Tag>{actionNames[h.action] || "更新"}</Tag>
                    <Text type="secondary">{time(h.created_at)}</Text>
                    <details>
                      <summary>查看字段前后值</summary>
                      <pre>
                        {JSON.stringify(
                          {
                            修改前: localizedSnapshot(h.before),
                            修改后: localizedSnapshot(h.after),
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </div>
                ))}
                {!history.length && <Text type="secondary">暂无操作记录</Text>}
              </div>
            )}
          </section>
          <section className="detail-workflow" ref={workflowSection}>
            <Title level={5}>工作流</Title>
            <div
              className="workflow-stages"
              role="group"
              aria-label={reactivating ? "重新激活状态" : "流转阶段"}
            >
              <span className="workflow-current">
                {item.status_name || "当前状态"}（当前）
              </span>
              {choices.map((state) => (
                <Button
                  key={state.code}
                  type="default"
                  aria-pressed={target === state.code}
                  disabled={!canTransition}
                  onClick={() => setTarget(state.code)}
                >
                  {state.name}
                </Button>
              ))}
            </div>
            {showFields && (
              <div className="workflow-fields">
                <label>
                  <span>
                    处理人<span className="required-after">*</span>
                  </span>
                  <Select
                    aria-label="流转处理人"
                    mode="multiple"
                    value={handlers}
                    onChange={setHandlers}
                    options={people}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="请选择处理人"
                    status={
                      transitionAttempted && !handlers.length
                        ? "error"
                        : undefined
                    }
                  />
                </label>
                {permitted("comment") && (
                  <div className="workflow-comment">
                    <span>评论</span>
                    <RichEditor
                      compact
                      aria-label="流转评论"
                      value={body}
                      onChange={setBody}
                      onAddFile={addImage("workflow")}
                      placeholder="请输入评论"
                    />
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
        <aside className="item-detail-right">
          <Title level={5}>基本信息</Title>
          <dl>
            {metadata.map((m) => (
              <div className="metadata-row" key={m.key}>
                <dt>{m.label}</dt>
                <dd>{m.children}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
      {canTransition && (allowed.length > 0 || canReactivate) && (
        <footer className="form-footer workflow-footer">
          {canReactivate && !reactivating ? (
            <Button
              type="primary"
              onClick={() => {
                setReactivating(true);
                setTarget("");
              }}
            >
              重新激活
            </Button>
          ) : (
            <>
              <Button
                aria-label={reactivating ? "确认重新激活" : "确认流转"}
                type="primary"
                loading={saving}
                disabled={saving || !target || target === item.status}
                onClick={async () => {
                  setTransitionAttempted(true);
                  if (!handlers.length) {
                    message.warning("请选择处理人");
                    return;
                  }
                  setSaving(true);
                  try {
                    await onTransition(
                      payload(
                        {
                          version: item.version,
                          target_status: target,
                          reactivate: reactivating,
                          handlers,
                          body,
                        },
                        "workflow",
                      ),
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {reactivating ? "确认重新激活" : "确认流转"}
              </Button>
              {reactivating && (
                <Button
                  onClick={() => {
                    setReactivating(false);
                    setTarget("");
                  }}
                >
                  取消
                </Button>
              )}
            </>
          )}
        </footer>
      )}
    </div>
  );
}
