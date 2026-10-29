import { PlusOutlined } from "@ant-design/icons";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RichEditor } from "./rich-editor";
import { WorkItemSelect } from "./work-item-select";
import {
  Button,
  App,
  Upload,
  DatePicker,
  Form,
  Input,
  Select,
  Checkbox,
  Tag,
  Space,
} from "antd";
import type { FormInstance, TablePaginationConfig } from "antd";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import type { Row } from "./api";
dayjs.locale("zh-cn");
export const COLORS = [
  { value: "red", name: "红色", hex: "#f5222d" },
  { value: "orange", name: "橙色", hex: "#fa8c16" },
  { value: "gold", name: "金色", hex: "#faad14" },
  { value: "green", name: "绿色", hex: "#52c41a" },
  { value: "blue", name: "蓝色", hex: "#1677ff" },
  { value: "geekblue", name: "深蓝", hex: "#2f54eb" },
  { value: "purple", name: "紫色", hex: "#722ed1" },
  { value: "cyan", name: "青色", hex: "#13c2c2" },
  { value: "default", name: "灰色", hex: "#8c8c8c" },
];
export const colorOptions = COLORS.map((c) => ({
  value: c.value,
  label: (
    <Space>
      <span className="color-dot" style={{ background: c.hex }} />
      {c.name}
    </Space>
  ),
}));
export const actionNames: Row = {
  create: "创建",
  update: "更新",
  delete: "删除",
  remove: "移除",
  add: "添加",
  transition: "状态变更",
  reactivate: "重新激活",
  comment: "评论",
  handover: "移交",
  assignment: "指派",
  restore: "恢复",
  upload: "上传附件",
  reorder: "调整顺序",
  close: "关闭",
  reopen: "重新开启",
  start: "开始",
  finish: "结束",
  workflow: "工作流配置",
  activate: "启用",
  deactivate: "停用",
  "reset-password": "重置密码",
  change_password: "修改密码",
  iteration_move: "移转迭代",
  due: "即将到期",
  overdue: "已逾期",
  mention: "提及",
};
export const detailLabels: Row = {
  web_url: "详情链接",
  source: "来源",
  proposer: "提出人",
  acceptance_criteria: "验收标准",
  expected_finish_date: "预计完成日期",
  requirement: "关联需求",
  task: "关联任务",
  steps_to_reproduce: "复现步骤",
  actual_result: "实际结果",
  expected_result: "预期结果",
  environment: "环境",
  severity: "严重程度",
  reporter: "发现人",
  submitted_at: "修复提交时间",
  submitted_by: "修复提交人",
  verified_at: "验证时间",
  verified_by: "验证人",
  id: "记录",
  version: "版本",
  title: "标题",
  description: "描述",
  status: "状态",
  status_name: "状态名称",
  status_color: "状态颜色",
  status_category: "状态类别",
  type: "类型",
  priority: "优先级",
  assignee: "负责人",
  iteration: "迭代",
  category: "分类",
  completed_at: "完成时间",
  created_at: "创建时间",
  updated_at: "更新时间",
  deleted_at: "删除时间",
  created_by: "创建人",
  number: "编号",
  reason: "原因",
  body: "内容",
  mentions: "提及成员",
  author: "作者",
  name: "名称",
  enabled: "启用",
  sort_order: "顺序",
  color: "颜色",
  role: "角色",
  project: "项目",
  owner: "负责人",
  goal: "目标",
  start_date: "开始日期",
  end_date: "结束日期",
  due_date: "截止日期",
  planned_start_date: "计划开始日期",
  planned_end_date: "计划结束日期",
};
export const valueNames: Row = {
  pending: "未完成",
  completed: "已完成",
  internal: "内部提出",
  feedback: "用户反馈",
  other: "其他",
  critical: "致命",
  major: "严重",
  normal: "一般",
  minor: "轻微",
  requirement: "需求",
  task: "任务",
  bug: "缺陷",
  ready: "待开始 / 待修复",
  planned: "待规划 / 未开始",
  active: "进行中",
  review: "待确认 / 验收",
  done: "已完成",
  closed: "已关闭",
  cancelled: "已取消",
  rejected: "不予处理",
  new: "待确认",
  admin: "项目管理员",
  member: "项目成员",
  readonly: "只读成员",
  finished: "已结束",
};
export function localizedSnapshot(value: any): any {
  if (Array.isArray(value)) return value.map(localizedSnapshot);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) => !["id", "project", "created_by", "item"].includes(key),
        )
        .map(([key, v]) => [
          detailLabels[key] || key,
          key === "status" && value.status_name
            ? value.status_name
            : localizedSnapshot(v),
        ]),
    );
  return typeof value === "string"
    ? valueNames[value] || COLORS.find((c) => c.value === value)?.name || value
    : value;
}
export function ChineseDateInput({
  value,
  onChange,
  ...props
}: {
  value?: string | null;
  onChange?: (value: string | null) => void;
  id?: string;
  "aria-label"?: string;
  placeholder?: string;
}) {
  return (
    <DatePicker
      {...props}
      value={value ? dayjs(value) : null}
      format="YYYY-MM-DD"
      placeholder={props.placeholder || "请选择日期"}
      style={{ width: "100%" }}
      onChange={(date) => onChange?.(date ? date.format("YYYY-MM-DD") : null)}
    />
  );
}
export function WorkTypeBadge({ type }: { type: string }) {
  return (
    <Tag
      className="work-type-badge"
      color={({ requirement: "blue", task: "green", bug: "red" } as Row)[type]}
    >
      {({ requirement: "需求", task: "任务", bug: "缺陷" } as Row)[type]}
    </Tag>
  );
}
export type Field = {
  name: string;
  label: string;
  required?: boolean;
  options?: Row[];
  lookup?: { projectId: string; type: string };
  area?: boolean;
  password?: boolean;
  type?: string;
  max?: number;
};
function Handover({
  value,
  onChange,
}: {
  value?: Row;
  onChange?: (value: Row) => void;
}) {
  return (
    <Select
      value={value?.action}
      options={[{ value: "unassign", label: "确认将全部未完成项设为未分配" }]}
      onChange={(action) => onChange?.({ action })}
      allowClear
    />
  );
}
export function RecordForm({
  form,
  fields,
  initial,
  wide = false,
  onAddFile,
  attachments,
  attachmentsAside = false,
  itemType,
}: {
  form: FormInstance;
  fields: Field[];
  initial: Row;
  wide?: boolean;
  attachments?: ReactNode;
  attachmentsAside?: boolean;
  itemType?: string;
  onAddFile?: (file: File) => string | null;
}) {
  const renderField = (f: Field) => (
    <Form.Item
      className={
        (f.name === "title"
          ? "field-title"
          : f.name === "description" || f.name === "body"
            ? "field-content"
            : "field-property") +
        (f.area || (wide && f.name === "title") ? " full-width" : "")
      }
      key={f.name}
      name={f.name}
      label={
        wide && ["title", "description", "body"].includes(f.name)
          ? undefined
          : f.label
      }
      initialValue={initial[f.name]}
      valuePropName={f.type === "checkbox" ? "checked" : "value"}
      rules={[
        { required: f.required, message: "请填写" + f.label },
        {
          validator: (_, value) => {
            const startKey = (
              {
                due_date: "planned_start_date",
                end_date: "start_date",
                planned_end_date: "planned_start_date",
              } as Row
            )[f.name];
            const start = startKey ? form.getFieldValue(startKey) : null;
            if (start && value && String(value) < String(start))
              return Promise.reject(new Error("结束日期不得早于开始日期"));
            if (f.required && f.type === "checkbox" && !value)
              return Promise.reject(new Error("请确认此操作"));
            return Promise.resolve();
          },
        },
        ...(f.max ? [{ max: f.max, message: `最多 ${f.max} 字` }] : []),
      ]}
    >
      {f.type === "rich" ? (
        <RichEditor
          aria-label={f.label}
          placeholder={f.name === "description" ? "请输入描述" : "请输入正文"}
          onAddFile={onAddFile}
        />
      ) : f.type === "handover" ? (
        <Handover />
      ) : f.type === "date" ? (
        <ChineseDateInput />
      ) : f.type === "checkbox" ? (
        <Checkbox>确认</Checkbox>
      ) : f.type === "color" ? (
        <Select options={colorOptions} />
      ) : f.lookup ? (
        <WorkItemSelect {...f.lookup} />
      ) : f.options ? (
        <Select
          mode={f.type === "multiple" ? "multiple" : undefined}
          options={f.options as any}
          allowClear
          showSearch
          filterOption={(input, option) =>
            String(option?.searchText || option?.label || "")
              .toLowerCase()
              .includes(input.toLowerCase())
          }
        />
      ) : f.area ? (
        <Input.TextArea rows={wide ? 3 : 4} />
      ) : f.password ? (
        <Input.Password />
      ) : (
        <Input
          aria-label={f.label}
          placeholder={wide && f.name === "title" ? "请输入标题" : undefined}
          type={f.type || "text"}
          min={f.type === "number" ? 0 : undefined}
        />
      )}
    </Form.Item>
  );
  return (
    <Form
      form={form}
      layout="vertical"
      preserve={false}
      className={wide ? "record-form record-form-wide" : "record-form"}
    >
      {wide ? (
        <div className="editor-columns">
          <div className="editor-main">
            {fields
              .filter((f) => ["title", "description", "body"].includes(f.name))
              .map((field) =>
                field.name === "title" &&
                itemType &&
                ["requirement", "task", "bug"].includes(itemType) ? (
                  <div className="work-editor-title" key={field.name}>
                    <WorkTypeBadge type={itemType} />
                    {renderField(field)}
                  </div>
                ) : (
                  renderField(field)
                ),
              )}
            {!attachmentsAside && attachments}
          </div>
          <div className="editor-properties">
            {fields
              .filter((f) => !["title", "description", "body"].includes(f.name))
              .map(renderField)}
            {attachmentsAside && attachments}
          </div>
        </div>
      ) : (
        fields.map(renderField)
      )}
    </Form>
  );
}
export function PriorityTag({
  name,
  color,
}: {
  name?: string;
  color?: string;
}) {
  return <Tag color={color || "default"}>{name || "—"}</Tag>;
}

export function FilterPanel({
  children,
  onReset,
  onSearch,
  actions,
}: {
  children: ReactNode;
  onReset: () => void;
  onSearch: () => void;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false),
    [overflow, setOverflow] = useState(false),
    [rowHeight, setRowHeight] = useState(32);
  useLayoutEffect(() => {
    const node = ref.current;
    const fields = node?.querySelector<HTMLElement>(".filters");
    if (!node || !fields) return;
    const measure = () => {
      const items = Array.from(fields.children) as HTMLElement[];
      const firstTop = items[0]?.getBoundingClientRect().top;
      if (firstTop === undefined) {
        setOverflow(false);
        return;
      }
      let height = 0,
        hasMore = false;
      for (const item of items) {
        const box = item.getBoundingClientRect();
        const hidden = box.top > firstTop + 1;
        hasMore ||= hidden;
        if (!hidden) height = Math.max(height, box.bottom - firstTop);
        item.inert = hidden && !expanded;
        if (hidden && !expanded) item.setAttribute("aria-hidden", "true");
        else item.removeAttribute("aria-hidden");
      }
      setRowHeight(Math.ceil(height) || 32);
      setOverflow(hasMore);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(fields);
    measure();
    return () => observer.disconnect();
  }, [children, expanded]);
  return (
    <div
      ref={ref}
      className={
        "filter-panel " +
        (expanded ? "expanded" : "collapsed") +
        (overflow ? " has-overflow" : "")
      }
    >
      <div
        className="filter-fields"
        style={{ maxHeight: expanded ? undefined : rowHeight }}
      >
        {children}
      </div>
      <Space className="filter-actions">
        {actions}
        <Button
          type="link"
          className="filter-toggle"
          style={{ visibility: overflow ? "visible" : "hidden" }}
          aria-hidden={!overflow}
          tabIndex={overflow ? 0 : -1}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起" : "展开"}
        </Button>
        <Button onClick={onReset}>重置</Button>
        <Button type="primary" onClick={onSearch}>
          搜索
        </Button>
      </Space>
    </div>
  );
}

export function attachmentError(file: File, user: Row): string | null {
  if (file.size > user.attachment_max_bytes)
    return `${file.name}：超过单文件大小上限（${user.attachment_max_bytes / 1024 / 1024} MB）`;
  const suffix = "." + file.name.split(".").pop()?.toLowerCase();
  if (!user.attachment_extensions.includes(suffix))
    return `${file.name}：不支持此附件类型`;
  return null;
}

export function AttachmentPicker({
  user,
  onFiles,
  maxFiles,
  browserDrop = false,
  compact = false,
}: {
  browserDrop?: boolean;
  compact?: boolean;
  user: Row;
  onFiles: (files: File[]) => void | Promise<void>;
  maxFiles?: number;
}) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const busyRef = useRef(false);
  const receiveFiles = async (batch: File[]) => {
    if (busyRef.current) return;
    const valid: File[] = [],
      errors: string[] = [];
    for (const candidate of batch) {
      const error = attachmentError(candidate, user);
      if (error) errors.push(error);
      else if (maxFiles !== undefined && valid.length >= maxFiles)
        errors.push(
          `${candidate.name}：本次附件数量已达上限，请保存后继续添加`,
        );
      else valid.push(candidate);
    }
    if (errors.length)
      message.warning({
        content: (
          <div className="attachment-errors">
            {errors.map((error, index) => (
              <div key={index}>{error}</div>
            ))}
          </div>
        ),
        duration: 8,
      });
    if (!valid.length) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onFiles(valid);
    } catch {
      message.error("附件添加失败，请重试");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const receiveRef = useRef(receiveFiles);
  receiveRef.current = receiveFiles;
  useEffect(() => {
    if (!browserDrop) return;
    let depth = 0;
    const isFile = (event: DragEvent) =>
      event.dataTransfer?.types.includes("Files");
    const enter = (event: DragEvent) => {
      if (!isFile(event)) return;
      event.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!isFile(event)) return;
      event.preventDefault();
      if (event.dataTransfer)
        event.dataTransfer.dropEffect = busyRef.current ? "none" : "copy";
    };
    const leave = (event: DragEvent) => {
      if (!isFile(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const reset = () => {
      depth = 0;
      setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!isFile(event)) return;
      event.preventDefault();
      event.stopPropagation();
      reset();
      void receiveRef.current(Array.from(event.dataTransfer?.files || []));
    };
    window.addEventListener("dragenter", enter, true);
    window.addEventListener("dragover", over, true);
    window.addEventListener("dragleave", leave, true);
    window.addEventListener("drop", drop, true);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragenter", enter, true);
      window.removeEventListener("dragover", over, true);
      window.removeEventListener("dragleave", leave, true);
      window.removeEventListener("drop", drop, true);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
    };
  }, [browserDrop]);
  return (
    <div
      className={
        "attachment-picker" + (compact ? " attachment-picker-inline" : "")
      }
    >
      <Upload
        multiple
        disabled={busy}
        showUploadList={false}
        beforeUpload={async (file, batch) => {
          // Ant Design invokes this hook for each file: process the selection once.
          if (file.uid === batch[0]?.uid) await receiveFiles(batch);
          return Upload.LIST_IGNORE;
        }}
      >
        <Button
          loading={busy}
          aria-label="添加附件"
          title="添加附件"
          type={compact ? "text" : "default"}
          icon={compact ? <PlusOutlined /> : undefined}
        >
          {compact ? undefined : "添加附件"}
        </Button>
      </Upload>
      {browserDrop && (
        <div className="attachment-picker-hint">
          {compact ? (
            <>
              单文件 ≤ {Math.round(user.attachment_max_bytes / 1024 / 1024)}{" "}
              MB，可点击选择或拖拽文件到页面上传
            </>
          ) : (
            <>
              <div>
                单文件 ≤ {Math.round(user.attachment_max_bytes / 1024 / 1024)}{" "}
                MB
              </div>
              <div>可以点击选择或拖拽文件到页面上传</div>
            </>
          )}
        </div>
      )}
      {browserDrop && dragging && (
        <div className="attachment-drop-overlay" role="status">
          <div>松开鼠标，添加附件</div>
        </div>
      )}
    </div>
  );
}

export const TABLE_PAGE_SIZES = [20, 50, 100];
export function readTablePageSize(query: URLSearchParams): number {
  const size = Number(query.get("page_size"));
  return TABLE_PAGE_SIZES.includes(size) ? size : 20;
}
export function tablePagination(
  options: TablePaginationConfig = {},
): TablePaginationConfig {
  return {
    position: ["bottomRight"],
    size: "middle",
    defaultPageSize: 20,
    showSizeChanger: true,
    pageSizeOptions: TABLE_PAGE_SIZES,
    showTotal: (total, range) =>
      `第 ${range[0]}-${range[1]} 条/总共 ${total} 条`,
    ...options,
  };
}
