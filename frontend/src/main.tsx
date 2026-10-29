import "./browser-compat";
import { copyWorkItem } from "./work-item-copy";
import { OperationLogs } from "./operation-logs";
import { useSession } from "./session";
import { routeQuery, detailLocation, copyDetailLink } from "./routes";
import { canAction } from "./permissions";
import { GroupEditor } from "./group-editor";
import { Workbench, WorkbenchBottom } from "./workbench";
import { Reports } from "./reports";
import { WorkflowManager } from "./workflow-manager";
import { DictionaryManager, dictionaryRows } from "./dictionary-manager";
import { DocumentIcon } from "./document-icon";
import {
  AttachmentPreviewPage,
  attachmentPreviewHref,
} from "./attachment-preview";
import { workDraft } from "./work-draft";
import {
  PlusOutlined,
  EditOutlined,
  CloseOutlined,
  LinkOutlined,
  UserOutlined,
  DownOutlined,
  LockOutlined,
  LogoutOutlined,
  ArrowLeftOutlined,
  DashboardOutlined,
  ProjectOutlined,
  FolderOutlined,
  UnorderedListOutlined,
  AppstoreOutlined,
  CalendarOutlined,
  FileTextOutlined,
  TeamOutlined,
  SettingOutlined,
  BellOutlined,
  DeleteOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import {
  RecordForm,
  AttachmentPicker,
  attachmentError,
  FilterPanel,
  tablePagination,
  readTablePageSize,
  ChineseDateInput,
  PriorityTag,
  COLORS,
  colorOptions,
  actionNames,
  detailLabels,
  valueNames,
  type Field,
} from "./ui";
import {
  RichContent,
  clearFilePreviews,
  restoreFilePreviews,
  type PendingFile,
} from "./rich-editor";
import { WorkDetail } from "./work-detail";
import { FilePreview } from "./file-preview";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  App,
  Dropdown,
  Avatar,
  Badge,
  Alert,
  Button,
  Card,
  ConfigProvider,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  Checkbox,
} from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { api, time, type Row, type CurrentUser } from "./api";
import "./style.css";
dayjs.locale("zh-cn");
const { Title, Text, Paragraph } = Typography;
const kinds: Row = { requirement: "需求", task: "任务", bug: "缺陷" };
const labels: Row = {
  planned: "待规划",
  ready: "待开始",
  active: "进行中",
  review: "待确认 / 验收",
  done: "已完成",
  closed: "已关闭",
  cancelled: "已取消",
  new: "待确认",
  rejected: "不予处理",
  finished: "已结束",
  admin: "项目管理员",
  member: "项目成员",
  readonly: "只读成员",
};
type WorkRoute = {
  mode: "create" | "edit" | "detail";
  id?: string;
  type: string;
  reference?: string;
  publicPath?: string;
  copyFrom?: string;
};
function readWorkRoute(): WorkRoute | null {
  const query = routeQuery();
  const mode = query.get("item_mode");
  return ["create", "edit", "detail"].includes(mode || "")
    ? {
        mode: mode as WorkRoute["mode"],
        id: query.get("item_id") || undefined,
        type: query.get("item_type") || query.get("type") || "task",
        reference: query.get("item_ref") || undefined,
        publicPath: query.get("item_path") || undefined,
        copyFrom:
          mode === "create" ? query.get("copy_from") || undefined : undefined,
      }
    : null;
}
function Client() {
  const { message, modal } = App.useApp();
  const [user, setUser] = useState<CurrentUser | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState(() => {
      try {
        return sessionStorage.getItem("reqflow:session-expired")
          ? "登录已过期，请重新登录"
          : "";
      } catch {
        return "";
      }
    });
  const [importingDocument, setImportingDocument] = useState(false);
  const [folderId, setFolderId] = useState(routeQuery().get("parent") || "");
  const [folderTrail, setFolderTrail] = useState<Row[]>([]);
  const [iterationRef, setIterationRef] = useState(
    routeQuery().get("iteration_ref") || "",
  );
  const [workRoute, setWorkRoute] = useState<WorkRoute | null>(readWorkRoute);
  const [screen, setScreen] = useState(
    routeQuery().get("view") === "board"
      ? "items"
      : routeQuery().get("view") || "home",
  );
  const [projectId, setProjectId] = useState(routeQuery().get("project") || "");
  const [contextProject, setContextProject] = useState<Row | null>(null);
  const [projects, setProjects] = useState<Row[]>([]),
    [rows, setRows] = useState<Row[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(Number(routeQuery().get("page") || 1)),
    [pageSize, setPageSize] = useState(() => readTablePageSize(routeQuery())),
    [q, setQ] = useState(routeQuery().get("q") || ""),
    [loading, setLoading] = useState(false);
  const [type, setType] = useState(routeQuery().get("type") || "task"),
    [revision, refresh] = useState(0),
    [dashboard, setDashboard] = useState<Row>({}),
    [report, setReport] = useState<Row>({}),
    [workflow, setWorkflow] = useState<Row>({});
  const [dictionaryItems, setDictionaryItems] = useState<Row[]>([]);
  const [priorities, setPriorities] = useState<Row[]>([]),
    [members, setMembers] = useState<Row[]>([]),
    [iterations, setIterations] = useState<Row[]>([]),
    [categories, setCategories] = useState<Row[]>([]),
    [users, setUsers] = useState<Row[]>([]),
    [groups, setGroups] = useState<Row[]>([]),
    [positions, setPositions] = useState<Row[]>([]);
  const [filter, setFilter] = useState<Row>(
      Object.fromEntries(
        [...routeQuery()].filter(([key]) =>
          [
            "status",
            "assignee",
            "priority",
            "iteration",
            "category",
            "date_from",
            "date_to",
            "due_before",
            "todo_scope",
          ].includes(key),
        ),
      ),
    ),
    [selected, setSelected] = useState<React.Key[]>([]);
  const [draftQ, setDraftQ] = useState(q);
  const [draftFilter, setDraftFilter] = useState<Row>(filter);
  useEffect(() => {
    setDraftQ(q);
    setDraftFilter(filter);
  }, [q, JSON.stringify(filter), screen, projectId, type]);
  function searchLists() {
    setQ(draftQ);
    setFilter({ ...draftFilter });
    setPage(1);
    refresh((value) => value + 1);
  }
  const [editing, setEditing] = useState<{
      title: string;
      path: string;
      method: string;
      fields: Field[];
      initial: Row;
      onSaved?: () => void;
      recoveryKey?: string;
    } | null>(null),
    [saving, setSaving] = useState(false),
    [form] = Form.useForm();
  const [groupId, setGroupId] = useState(routeQuery().get("group_id") || "");
  const [detail, setDetail] = useState<Row | null>(null),
    [comments, setComments] = useState<Row[]>([]),
    [history, setHistory] = useState<Row[]>([]),
    [attachments, setAttachments] = useState<Row[]>([]),
    [temporary, setTemporary] = useState("");
  const [signOutAfterPasswordReset, setSignOutAfterPasswordReset] =
    useState(false);
  function closeTemporaryPassword() {
    setTemporary("");
    if (signOutAfterPasswordReset) {
      setSignOutAfterPasswordReset(false);
      setProjectId("");
      setProjects([]);
      setUser(null);
    }
  }
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!user || user.must_change_password) return;
    api("me/notifications?page_size=100")
      .then((data) =>
        setUnread(data.items.filter((n: Row) => !n.read_at).length),
      )
      .catch(fail);
  }, [user?.id, revision]);
  const [sortSaving, setSortSaving] = useState(false);
  const [sortDrop, setSortDrop] = useState<{
    id: string;
    placement: "before" | "after";
  } | null>(null);
  const [iterationView, setIterationView] = useState<Row | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [loginForm] = Form.useForm();
  const current =
    projects.find((p) => p.id === projectId) ||
    (contextProject?.id === projectId ? contextProject : undefined);
  const me = members.find((m) => m.user === user?.id);
  const isAdmin = !!user?.is_superuser,
    isManager = isAdmin || me?.role === "admin";
  const canSee = (key: string) =>
    isAdmin ||
    !(user as Row)?.menu_permissions ||
    (user as Row).menu_permissions.includes(key);
  const allowed = (menu: string, operation: string) =>
    canAction(user, menu, operation);
  const canConfigure = (operation: string) =>
    screen === "categories"
      ? !!manage && allowed("items", "categories")
      : allowed(screen, operation);
  const screenAllowed =
    canSee(
      screen === "group-editor"
        ? "user-groups"
        : screen === "board"
          ? "items"
          : screen === "categories"
            ? "items"
            : screen,
    ) || screen === "notifications";
  function openGroupEditor(id = "") {
    setGroupId(id);
    setEditing(null);
    setScreen("group-editor");
    window.history.pushState(
      null,
      "",
      `?view=group-editor${id ? `&group_id=${id}` : ""}`,
    );
  }
  const writable =
    !!current &&
    current.status === "active" &&
    (isAdmin || ["admin", "member"].includes(me?.role)) &&
    user?.permissions?.includes("edit_items");
  const manage =
    writable && isManager && user?.permissions?.includes("manage_members");
  useEffect(() => {
    if (!user) return;
    try {
      setRecentIds(
        (() => {
          const saved = JSON.parse(
            localStorage.getItem("reqflow:recent:" + user.id) || "[]",
          );
          return Array.isArray(saved)
            ? saved.filter((id) => typeof id === "string")
            : [];
        })(),
      );
    } catch {
      setRecentIds([]);
    }
  }, [user?.id]);
  useEffect(() => {
    if (!user || !current) return;
    setRecentIds((previous) => {
      const ids = [
        current.id,
        ...previous.filter((id) => id !== current.id),
      ].slice(0, 5);
      localStorage.setItem("reqflow:recent:" + user.id, JSON.stringify(ids));
      return ids;
    });
  }, [user?.id, current?.id]);
  const fail = (e: any) => {
    setError(e.message);
    message.error(e.message);
  };
  const reload = () => refresh((v) => v + 1);
  const options = (list: Row[], label = "name", value = "id") =>
    list.map((o) => ({
      label:
        label === "name" && o.color ? (
          <PriorityTag name={o[label]} color={o.color} />
        ) : (
          o[label]
        ),
      value: o[value],
      searchText: String(o[label] || ""),
    }));
  const dictionaryTag = (kind: string, code: unknown) => {
    if (!code) return "—";
    const entry = dictionaryItems.find(
      (item) => item.kind === kind && item.code === code,
    );
    return (
      <PriorityTag
        name={entry?.name || valueNames[String(code)] || String(code)}
        color={entry?.color}
      />
    );
  };
  useEffect(() => {
    try {
      sessionStorage.removeItem("reqflow:session-expired");
    } catch {
      /* Storage may be unavailable. */
    }
    let active = true;
    api("auth/me")
      .then((current) => {
        if (active) setUser(current);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!user || user.must_change_password) return;
    api("projects?page_size=100")
      .then(async (d) => {
        setProjects(d.items);
        if (
          projectId ||
          workRoute ||
          iterationRef ||
          routeQuery().has("attachment_preview")
        )
          return;
        let ids: string[] = [];
        try {
          const saved = JSON.parse(
            localStorage.getItem("reqflow:recent:" + user.id) || "[]",
          );
          if (Array.isArray(saved))
            ids = saved.filter((id) => typeof id === "string");
        } catch {
          /* Invalid local preferences must not prevent login. */
        }
        for (const id of ids) {
          let available = d.items.find((project: Row) => project.id === id);
          if (!available) {
            try {
              available = await api(`projects/${id}`);
            } catch {
              continue;
            }
          }
          setContextProject(available);
          setProjectId((selected) => selected || id);
          break;
        }
      })
      .catch(fail);

    if (!isAdmin)
      api("directory")
        .then((d) => setUsers(d.items))
        .catch(fail);
    if (isAdmin) {
      Promise.all([
        api("users?page_size=100"),
        api("user-groups?page_size=100"),
        api("positions?page_size=100"),
      ])
        .then(([u, g, p]) => {
          setUsers(u.items);
          setGroups(g.items);
          setPositions(p.items);
        })
        .catch(fail);
    } else if (["users", "user-groups", "positions"].some(canSee)) {
      api("workspace/context")
        .then((data) => {
          setGroups(data.groups);
          setPositions(data.positions);
        })
        .catch(fail);
    }
  }, [user, revision]);
  useEffect(() => {
    if (
      !projectId ||
      !user ||
      user.must_change_password ||
      ![
        "home",
        "items",
        "iterations",
        "documents",
        "reports",
        "members",
        "dictionaries",
        "workflow",
        "recycle-bin",
      ].some(canSee)
    )
      return;
    let active = true;
    ("menu_permissions" in user
      ? api(`projects/${projectId}/context`)
      : Promise.all([
          api(`projects/${projectId}`),
          api(`projects/${projectId}/members?page_size=100`),
          api(`projects/${projectId}/iterations?page_size=100`),
          api(`projects/${projectId}/categories?page_size=100`),
          api(`projects/${projectId}/workflow`),
          ...["environment", "severity", "priority", "source"].map((kind) =>
            dictionaryRows(`projects/${projectId}/dictionaries`, kind),
          ),
        ]).then(
          ([project, members, iterations, categories, workflow, ...dicts]) => ({
            project,
            members: members.items,
            iterations: iterations.items,
            categories: categories.items,
            workflow,
            dictionaries: dicts.flat(),
          }),
        )
    )
      .then((data) => {
        if (!active) return;
        setContextProject(data.project);
        setMembers(data.members);
        setIterations(data.iterations);
        setCategories(data.categories);
        setWorkflow(data.workflow);
        setDictionaryItems(data.dictionaries);
        setPriorities(
          data.dictionaries.filter((row: Row) => row.kind === "priority"),
        );
      })
      .catch(fail);
    return () => {
      active = false;
    };
  }, [projectId, user, revision]);
  function listPath() {
    if (
      [
        "dictionaries",
        "priorities",
        "workflow-template",
        "group-editor",
        "operation-logs",
      ].includes(screen)
    )
      return "";
    if (screen === "home") return "me/todos";
    if (screen === "notifications") return "me/notifications";
    if (screen === "recycle-bin")
      return projectId ? `projects/${projectId}/recycle-bin` : "";
    if (
      ["users", "user-groups", "positions", "priorities", "projects"].includes(
        screen,
      )
    )
      return screen;
    if (!projectId) return "";
    return `projects/${projectId}/${screen === "items" ? "work-items" : screen}`;
  }
  useEffect(() => {
    const params = new URLSearchParams({
      ...(screen === "documents" && folderId ? { parent: folderId } : {}),
      view: screen,
      ...(screen === "group-editor" && groupId ? { group_id: groupId } : {}),
      project: projectId,
      page: String(page),
      page_size: String(pageSize),
      q,
      type,
      ...(workRoute
        ? {
            item_mode: workRoute.mode,
            item_type: workRoute.type,
            ...(workRoute.id ? { item_id: workRoute.id } : {}),
            ...(workRoute.copyFrom ? { copy_from: workRoute.copyFrom } : {}),
          }
        : {}),
      ...Object.fromEntries(
        Object.entries(filter).filter(
          ([, value]) => value !== undefined && value !== "",
        ),
      ),
    });
    const record =
      workRoute &&
      detail &&
      (detail.id === workRoute.id ||
        (workRoute.reference && detail.web_url === workRoute.publicPath))
        ? detail
        : workRoute?.id && editing?.initial?.id === workRoute.id
          ? editing.initial
          : null;
    const publicPath = workRoute?.publicPath || record?.web_url;
    const target = routeQuery().has("attachment_preview")
      ? location.pathname + location.search
      : workRoute && workRoute.mode !== "create" && publicPath
        ? detailLocation(publicPath, workRoute.mode)
        : iterationRef && screen === "iterations" && !workRoute
          ? iterationView?.web_url || location.pathname
          : "/?" + params;
    window.history.replaceState(null, "", target);
    if (!user || user.must_change_password || !screenAllowed) return;
    if (workRoute || iterationRef || routeQuery().has("attachment_preview")) {
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    setSelected([]);
    const query = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
      q,
      ...Object.fromEntries(
        Object.entries(filter).filter(
          ([, value]) => value !== undefined && value !== "",
        ),
      ),
      ...(screen === "items" ? { type } : {}),
      ...(screen === "documents" && folderId ? { parent: folderId } : {}),
    });
    let task: Promise<any>;
    if (screen === "reports" && projectId)
      task = api(`projects/${projectId}/reports/overview?` + query).then(
        setReport,
      );
    else if (screen === "workflow") task = Promise.resolve();
    else {
      const path = listPath();
      task = path
        ? api(path + "?" + query).then((d) => {
            setRows(d.items || []);
            if (screen === "documents") setFolderTrail(d.ancestors || []);
            setTotal(d.total || 0);
          })
        : Promise.resolve(setRows([]));
    }
    if (screen === "home") api("me/dashboard").then(setDashboard).catch(fail);
    task.catch(fail).finally(() => setLoading(false));
  }, [
    user,
    screen,
    projectId,
    page,
    pageSize,
    q,
    type,
    revision,
    folderId,
    JSON.stringify(filter),
    workRoute,
    groupId,
    detail?.web_url,
    editing?.initial?.web_url,
    iterationRef,
    iterationView?.web_url,
  ]);
  function navigate(key: string) {
    setFolderId("");
    setFolderTrail([]);
    if (key === "notifications") reload();
    setScreen(key === "board" ? "items" : key);
    clearFilePreviews();
    setPendingFiles([]);
    setPage(1);
    setQ("");
    setFilter({});
    setDetail(null);
    setWorkRoute(null);
    setIterationRef("");
    setIterationView(null);
    setEditing(null);
  }
  function routeToWork(route: WorkRoute | null) {
    setError("");
    const query = routeQuery();
    for (const key of ["item_mode", "item_id", "item_type", "copy_from"])
      query.delete(key);
    if (route) {
      query.set("item_mode", route.mode);
      query.set("item_type", route.type);
      if (route.id) query.set("item_id", route.id);
      if (route.copyFrom) query.set("copy_from", route.copyFrom);
    }
    const record =
      route?.id && detail?.id === route.id
        ? detail
        : route?.id && editing?.initial?.id === route.id
          ? editing.initial
          : null;
    const publicPath = route?.publicPath || record?.web_url;
    window.history.pushState(
      null,
      "",
      route && route.mode !== "create" && publicPath
        ? detailLocation(publicPath, route.mode)
        : "/?" + query,
    );
    setWorkRoute(route);
    document.querySelector(".content")?.scrollTo({ top: 0 });
  }
  function workPageUrl(mode: "create" | "detail", row?: Row) {
    if (mode === "detail" && row?.web_url) return row.web_url;
    const url = new URL("/", window.location.origin);
    url.search = window.location.search;
    const kind = row?.type || type;
    url.searchParams.set("item_mode", mode);
    url.searchParams.set("item_type", kind);
    url.searchParams.set("type", kind);
    url.searchParams.set("project", String(row?.project || projectId));
    if (mode === "create") url.searchParams.delete("copy_from");
    if (mode === "create" && screen === "items") {
      if (filter.category)
        url.searchParams.set("category", String(filter.category));
      else url.searchParams.delete("category");
    }
    if (mode === "detail" && row?.id)
      url.searchParams.set("item_id", String(row.id));
    else url.searchParams.delete("item_id");
    return url.pathname + url.search + url.hash;
  }
  function documentPageUrl(row: Row) {
    if (row.web_url) return row.web_url;
    const url = new URL(window.location.href);
    url.searchParams.set("view", "documents");
    url.searchParams.set("project", String(row.project || projectId));
    url.searchParams.set("item_type", "document");
    url.searchParams.set("item_mode", "detail");
    url.searchParams.set("item_id", row.id);
    return url.pathname + url.search;
  }
  function downloadMarkdown() {
    if (!detail) return;
    const url = URL.createObjectURL(
      new Blob([detail.body || ""], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = detail.title.replace(/[\\/:*?"<>|]/g, "_") + ".md";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function discardWorkEditor() {
    if (editing?.recoveryKey)
      void workDraft(editing.recoveryKey, "delete").catch(() => {});
    setEditing(null);
    clearFilePreviews();
    setPendingFiles([]);
  }
  function closeWorkPage() {
    discardWorkEditor();
    setDetail(null);
    routeToWork(null);
  }
  function cancelWorkEditor() {
    const record = editing?.initial;
    if (
      workRoute?.mode === "edit" &&
      workRoute.type !== "document" &&
      record?.id
    ) {
      discardWorkEditor();
      void openItem(record);
    } else closeWorkPage();
  }
  function addPendingFile(file: File): string | null {
    if (!user) return null;
    const error = attachmentError(file, user);
    if (error) {
      message.error(error);
      return null;
    }
    const token = "reqflow-upload:" + crypto.randomUUID();
    setPendingFiles((files) => [...files, { file, token }]);
    return token;
  }
  function removePendingFile(token: string) {
    setPendingFiles((files) => files.filter((f) => f.token !== token));
    for (const key of ["description", "body"]) {
      const value = form.getFieldValue(key);
      if (typeof value === "string")
        form.setFieldValue(
          key,
          value.replace(
            new RegExp("!\\[[^\\]]*\\]\\(" + token + "\\)", "g"),
            "",
          ),
        );
    }
  }
  function edit(
    title: string,
    path: string,
    fields: Field[],
    initial: Row = {},
    method = "POST",
    onSaved?: () => void,
  ) {
    if (
      fields.some((f) => f.name === "title") &&
      (fields.some((f) => f.name === "priority") || path.includes("documents"))
    ) {
      clearFilePreviews();
      setPendingFiles([]);
      routeToWork({
        mode: method === "POST" ? "create" : "edit",
        id: method === "PATCH" ? String(initial.id) : undefined,
        type: path.includes("documents") ? "document" : initial.type || type,
      });
    }
    if (
      !fields.some((f) => f.type === "rich") &&
      workRoute &&
      workRoute.mode !== "detail"
    )
      closeWorkPage();
    setEditing({ title, path, fields, initial, method, onSaved });
  }
  const draftKey =
    user && workRoute && workRoute.type !== "document"
      ? `${user.id}:${projectId}:${workRoute.type}${workRoute.copyFrom ? ":copy:" + workRoute.copyFrom : ""}`
      : "";
  useEffect(() => {
    if (!editing || workRoute?.mode !== "create" || !draftKey) return;
    let active = true;
    workDraft(draftKey, "read")
      .then((draft) => {
        if (active && draft) {
          restoreFilePreviews(draft.files);
          form.setFieldsValue(draft.values);
          setPendingFiles(draft.files);
          message.info("已恢复本机草稿");
        }
      })
      .catch(() => {
        if (active) message.warning("无法读取本机草稿");
      });
    return () => {
      active = false;
    };
  }, [editing, draftKey]);
  async function saveDraft() {
    if (!draftKey) return;
    try {
      await workDraft(draftKey, "write", {
        values: form.getFieldsValue(true),
        files: pendingFiles,
      });
      message.success("草稿已保存到当前浏览器");
    } catch {
      message.error("草稿保存失败，请检查浏览器存储空间");
    }
  }
  async function submit(continueCreating = false) {
    if (!editing) return;
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload = editing.initial.bulk
        ? { items: editing.initial.items, changes: values }
        : { ...editing.initial, ...values };
      if (
        /^(positions|priorities|user-groups)(\/|$)/.test(editing.path) ||
        editing.path.includes("/categories")
      )
        delete payload.enabled;
      if (
        /^(positions|priorities)(\/|$)/.test(editing.path) ||
        editing.path.includes("/categories")
      )
        delete payload.sort_order;
      if (
        editing.fields.some((field) => field.name === "assignee") &&
        values.assignee !== editing.initial.assignee
      )
        delete payload.handlers;
      let request: Row | FormData = payload;
      if (
        pendingFiles.length &&
        editing.fields.some((f) => f.type === "rich")
      ) {
        const data = new FormData();
        data.append(
          "payload",
          JSON.stringify({
            ...payload,
            upload_tokens: pendingFiles.map((f) => f.token),
          }),
        );
        for (const file of pendingFiles) data.append("files", file.file);
        request = data;
      }
      const result = await api(editing.path, editing.method, request);
      if (editing.recoveryKey)
        await workDraft(editing.recoveryKey, "delete").catch(() => {});
      if (draftKey && workRoute?.mode === "create")
        await workDraft(draftKey, "delete").catch(() =>
          message.warning("已创建，但本机草稿清理失败"),
        );
      clearFilePreviews();
      setPendingFiles([]);
      if (result?.failed?.length)
        modal.warning({
          title: "批量结果",
          content:
            `成功 ${result.succeeded.length} 项；失败 ${result.failed.length} 项：` +
            result.failed.map((f: Row) => f.message).join("；"),
        });
      if (result?.temporary_password) setTemporary(result.temporary_password);
      const wasWorkEditor =
        editing.fields.some((f) => f.name === "title") &&
        (editing.fields.some((f) => f.name === "priority") ||
          editing.path.includes("documents"));
      if (
        continueCreating &&
        workRoute?.mode === "create" &&
        workRoute.type !== "document"
      ) {
        form.resetFields();
        if (workRoute.copyFrom) {
          setEditing(null);
          routeToWork({ mode: "create", type: workRoute.type });
        } else setEditing({ ...editing, initial: { ...editing.initial } });
        reload();
        message.success("创建成功，可继续创建");
        return;
      }
      setEditing(null);
      if (wasWorkEditor) {
        if (editing.path.includes("documents"))
          routeToWork({ mode: "detail", id: result.id, type: "document" });
        else void openItem(result);
      } else editing.onSaved?.();
      reload();
      message.success("保存成功");
    } catch (e: any) {
      if (e.fields)
        form.setFields(
          Object.entries(e.fields).map(([name, errors]) => ({
            name,
            errors: errors as string[],
          })),
        );
      if (e.message) fail(e);
    } finally {
      setSaving(false);
    }
  }
  async function command(path: string, data: Row, method = "POST") {
    try {
      await api(path, method, data);
      reload();
      message.success("操作成功");
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }
  function editCategory(category?: Row) {
    edit(
      category ? "修改分类" : "新增分类",
      `projects/${projectId}/categories${category ? "/" + category.id : ""}`,
      [{ name: "name", label: "名称", required: true, max: 50 }],
      category || { enabled: true },
      category ? "PATCH" : "POST",
    );
  }
  async function deleteCategory(category: Row, confirmed = false) {
    try {
      await api(`projects/${projectId}/categories/${category.id}`, "DELETE", {
        version: category.version,
        confirm: confirmed,
      });
      if (filter.category === category.id) {
        setFilter({ ...filter, category: "none" });
        setPage(1);
      }
      reload();
      message.success("分类已删除");
    } catch (error: any) {
      if (error.code === "CATEGORY_MOVE_CONFIRMATION_REQUIRED") {
        modal.confirm({
          title: "删除后都将移动到默认分类",
          content: "该分类下的需求、任务、缺陷将保留，是否继续删除分类？",
          okText: "确认删除",
          okButtonProps: { danger: true },
          cancelText: "取消",
          onOk: () => deleteCategory(category, true),
        });
      } else fail(error);
    }
  }
  async function openItem(row: Row) {
    setEditing(null);
    setDetail(null);
    routeToWork({
      mode: "detail",
      id: String(row.id),
      type: row.type || type,
      publicPath: row.web_url,
    });
  }
  async function refreshDiscussion() {
    if (!detail) return;
    const [list, files, events] = await Promise.all([
      api(`work-items/${detail.id}/comments`),
      api(`work-items/${detail.id}/attachments`),
      api(`work-items/${detail.id}/history`),
    ]);
    setComments(list.items);
    setAttachments(files.items);
    setHistory(events.items);
  }
  const refreshDetail = () => {
    if (detail?.isDocument)
      api(`documents/${detail.id}/attachments`)
        .then((d) => setAttachments(d.items))
        .catch(fail);
    else if (detail) openItem(detail);
  };
  const itemFields = (kind: string): Field[] => [
    { name: "title", label: "标题", required: true, max: 200 },
    {
      name: "description",
      label: "描述",
      type: "rich",
      area: true,
    },
    {
      name: "priority",
      label: "优先级",
      options: options(priorities.filter((p) => p.enabled)),
    },
    {
      name: "assignee",
      label: "负责人",
      options: options(
        members.filter((m) => m.role !== "readonly"),
        "display_name",
        "user",
      ),
    },
    {
      name: "iteration",
      label: "迭代",
      options: iterations.map((iteration) => ({
        value: iteration.id,
        label: iteration.name,
        disabled: iteration.status === "finished",
      })),
    },
    {
      name: "category",
      label: "分类",
      options: options(categories.filter((c) => c.enabled)),
    },
    { name: "planned_start_date", label: "计划开始日期", type: "date" },
    { name: "due_date", label: "截止日期", type: "date" },
    ...(kind === "requirement"
      ? [
          {
            name: "source",
            label: "来源",
            options: dictionaryItems
              .filter((d) => d.kind === "source")
              .map((d) => ({
                label: <PriorityTag name={d.name} color={d.color} />,
                value: d.code,
                searchText: d.name,
                disabled: !d.enabled,
              })),
          },
          { name: "proposer", label: "提出人" },
        ]
      : []),
    ...(kind !== "requirement"
      ? [
          {
            name: "requirement",
            label: "关联需求",
            lookup: { projectId, type: "requirement" },
          },
        ]
      : []),
    ...(kind === "bug"
      ? [
          {
            name: "environment",
            label: "环境",
            options: dictionaryItems
              .filter((d) => d.kind === "environment")
              .map((d) => ({
                label: <PriorityTag name={d.name} color={d.color} />,
                value: d.code,
                searchText: d.name,
                disabled: !d.enabled,
              })),
          },
          {
            name: "severity",
            label: "严重程度",
            required: true,
            options: dictionaryItems
              .filter((d) => d.kind === "severity")
              .map((d) => ({
                label: <PriorityTag name={d.name} color={d.color} />,
                value: d.code,
                searchText: d.name,
                disabled: !d.enabled,
              })),
          },
          {
            name: "task",
            label: "关联任务",
            lookup: { projectId, type: "task" },
          },
        ]
      : []),
  ];
  function newItem(kind = type) {
    edit(
      "新建" + kinds[kind],
      `projects/${projectId}/work-items`,
      itemFields(kind),
      {
        type: kind,
        priority: priorities.find((p) => p.name === "中" && p.enabled)?.id,
        source:
          dictionaryItems.find(
            (d) => d.kind === "source" && d.code === "internal" && d.enabled,
          )?.code ||
          dictionaryItems.find((d) => d.kind === "source" && d.enabled)?.code ||
          "",
        severity:
          dictionaryItems.find(
            (d) => d.kind === "severity" && d.code === "normal" && d.enabled,
          )?.code ||
          dictionaryItems.find((d) => d.kind === "severity" && d.enabled)
            ?.code ||
          "",
      },
    );
  }
  // Keep discriminator out of user-editable fields while preserving it in the request.
  async function transition(row: Row, target: string) {
    edit(
      "变更状态",
      `work-items/${row.id}/transition`,
      [
        {
          name: "handlers",
          label: "处理人",
          type: "multiple",
          required: true,
          options: options(
            members.filter((m) => m.role !== "readonly"),
            "display_name",
            "user",
          ),
        },
      ],
      {
        version: row.version,
        target_status: target,
        handlers: row.handlers?.length
          ? row.handlers
          : row.assignee
            ? [row.assignee]
            : [],
      },
      "POST",
      () => openItem(row),
    );
  }
  function newRecord() {
    if (screen === "user-groups") {
      openGroupEditor();
      return;
    }
    if (screen === "projects")
      edit(
        "新建项目",
        "projects",
        [
          { name: "name", label: "项目名称", required: true, max: 100 },
          { name: "code", label: "项目编码", required: true, max: 30 },
          { name: "description", label: "简介", area: true, max: 1000 },
          {
            name: "owner",
            label: "负责人",
            options: options(users.length ? users : [user!], "display_name"),
            required: true,
          },
          { name: "planned_start_date", label: "计划开始日期", type: "date" },
          { name: "planned_end_date", label: "计划结束日期", type: "date" },
        ],
        { owner: user?.id },
      );
    if (screen === "items" || screen === "board") newItem();
    if (screen === "iterations")
      edit(
        "新建迭代",
        `projects/${projectId}/iterations`,
        iterationFields(),
        {},
      );

    if (screen === "members")
      edit(
        "添加成员",
        `projects/${projectId}/members/bulk`,
        [
          {
            name: "users",
            label: "成员",
            required: true,
            type: "multiple",
            options: options(users, "display_name").filter(
              (option) => !rows.some((member) => member.user === option.value),
            ),
          },
          { name: "role", label: "角色", required: true, options: roleOptions },
        ],
        { role: "member" },
      );
    if (screen === "users") edit("新建用户", "users", userFields(), {});
    if (
      ["positions", "priorities", "categories", "user-groups"].includes(screen)
    )
      edit(
        "新建配置",
        screen === "categories" ? `projects/${projectId}/categories` : screen,
        configFields(),
        { color: "blue", permissions: [] },
      );
  }
  const roleOptions = ["admin", "member", "readonly"].map((value) => ({
    value,
    label: labels[value],
  }));
  const docFields = (): Field[] => [
    { name: "title", label: "标题", required: true, max: 200 },
    {
      name: "body",
      label: "正文",
      type: "rich",
      required: true,
      area: true,
    },
  ];
  const iterationFields = (): Field[] => [
    { name: "name", label: "名称", required: true, max: 100 },
    { name: "goal", label: "目标", area: true },
    {
      name: "owner",
      label: "负责人",
      required: true,
      options: options(
        members.filter((m) => m.role !== "readonly"),
        "display_name",
        "user",
      ),
    },
    { name: "start_date", label: "开始日期", required: true, type: "date" },
    { name: "end_date", label: "结束日期", required: true, type: "date" },
    { name: "confirm_overlap", label: "日期重叠时确认继续", type: "checkbox" },
  ];
  const userFields = (): Field[] => [
    { name: "username", label: "登录账号", required: true },
    { name: "display_name", label: "姓名", required: true, max: 20 },
    {
      name: "position",
      label: "职务",
      required: true,
      options: options(positions.filter((p) => p.enabled)),
    },
    {
      name: "group",
      label: "用户组",
      required: true,
      options: options(
        groups.filter(
          (p) =>
            p.enabled && (isAdmin || !(p.builtin && p.name === "系统管理员")),
        ),
      ),
    },
  ];
  const configFields = (): Field[] => [
    {
      name: "name",
      label: "名称",
      required: true,
      max: screen === "positions" ? 20 : 50,
    },
    ...(screen === "priorities"
      ? [{ name: "color", label: "颜色", type: "color", required: true }]
      : []),
  ];
  function removeMember(row: Row) {
    edit(
      "移除成员与工作移交",
      `projects/${projectId}/members/${row.user}`,
      [{ name: "unfinished_items", label: "未完成项处置", type: "handover" }],
      row,
      "DELETE",
    );
  }
  function editWorkItem(row: Row) {
    edit(
      "编辑" + kinds[row.type],
      "work-items/" + row.id,
      itemFields(row.type),
      { ...row, ...row.details },
      "PATCH",
      refreshDetail,
    );
  }
  function editDocument(row: Row) {
    if (row.document_type && row.document_type !== "markdown") return;
    edit("编辑文档", "documents/" + row.id, docFields(), row, "PATCH");
  }
  function editRow(row: Row) {
    if (screen === "user-groups") {
      openGroupEditor(row.id);
      return;
    }
    if (row.type && kinds[row.type] && row.number) editWorkItem(row);
    else if (row.isDocument || screen === "documents") editDocument(row);
    else if (screen === "iterations")
      edit("编辑迭代", "iterations/" + row.id, iterationFields(), row, "PATCH");
    else if (screen === "users")
      edit(
        "编辑用户",
        "users/" + row.id,
        userFields().filter((f) => f.name !== "username"),
        row,
        "PATCH",
      );
    else if (screen === "members")
      edit(
        "修改成员角色",
        `projects/${projectId}/members/${row.user}`,
        [
          { name: "role", label: "角色", required: true, options: roleOptions },
          {
            name: "unfinished_items",
            label: "改为只读时处置未完成项",
            type: "handover",
          },
        ],
        row,
        "PATCH",
      );
    else if (screen === "projects")
      edit(
        "编辑项目",
        "projects/" + row.id,
        [
          { name: "name", label: "名称", required: true, max: 100 },
          { name: "description", label: "简介", area: true },
          {
            name: "owner",
            label: "负责人",
            required: true,
            options: options(
              members.filter((m) => m.role === "admin"),
              "display_name",
              "user",
            ),
          },
          { name: "planned_start_date", label: "计划开始日期", type: "date" },
          { name: "planned_end_date", label: "计划结束日期", type: "date" },
        ],
        row,
        "PATCH",
      );
    else
      edit(
        "编辑配置",
        (screen === "categories"
          ? `projects/${projectId}/categories`
          : screen) +
          "/" +
          row.id,
        configFields(),
        row,
        "PATCH",
      );
  }
  const itemCols = [
    {
      title: "编号",
      dataIndex: "number",
      width: 150,
      className: "work-item-number-column",
      render: (v: string, r: Row) => (
        <Button
          type="link"
          className="work-item-number-link"
          href={workPageUrl("detail", r)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {v}
        </Button>
      ),
    },
    { title: "标题", dataIndex: "title" },
    ...(screen === "items"
      ? []
      : [
          { title: "类型", dataIndex: "type", render: (v: string) => kinds[v] },
        ]),
    {
      title: "状态",
      dataIndex: "status",
      render: (v: string, r: Row) => (
        <Tag color={r.status_color}>{r.status_name || labels[v] || v}</Tag>
      ),
    },
    {
      title: "优先级",
      dataIndex: "priority_name",
      render: (name: string, row: Row) => (
        <PriorityTag
          name={name}
          color={
            row.priority_color ||
            priorities.find((p) => p.id === row.priority)?.color
          }
        />
      ),
    },
    {
      title: "负责人",
      dataIndex: "assignee_name",
      render: (v: string) => v || "未分配",
    },
    {
      title: "截止日期",
      dataIndex: "due_date",
      render: (v: string) => v || "—",
    },
  ];
  if (screen === "items" && type === "requirement")
    itemCols.push({
      title: "子任务完成",
      dataIndex: "child_task_completed",
      render: (_: any, r: Row) =>
        `${r.child_task_completed}/${r.child_task_total}`,
    } as any);
  if (screen === "items" && type !== "requirement")
    itemCols.push({ title: "关联需求", dataIndex: "requirement_title" } as any);
  if (screen === "items" && type === "requirement")
    itemCols.push({
      title: "来源",
      key: "source",
      width: 120,
      dataIndex: "details",
      render: (value: Row) => dictionaryTag("source", value?.source),
    } as any);
  if (screen === "items" && type === "bug") {
    itemCols.push({
      title: "严重程度",
      key: "severity",
      width: 120,
      dataIndex: "details",
      render: (value: Row) => dictionaryTag("severity", value?.severity),
    } as any);
    itemCols.push({
      title: "环境",
      key: "environment",
      width: 120,
      dataIndex: "details",
      render: (value: Row) => dictionaryTag("environment", value?.environment),
    } as any);
  }
  const actions = (row: Row) => (
    <Space wrap className="row-actions" size={0}>
      {screen === "projects" && (
        <>
          <Button
            onClick={() => {
              setProjectId(row.id);
              navigate("items");
            }}
          >
            进入项目
          </Button>
          {(isAdmin || row.current_role === "admin") &&
            allowed("projects", "edit") &&
            row.status === "active" && (
              <Button
                onClick={() => {
                  setProjectId(row.id);
                  editRow(row);
                }}
              >
                编辑
              </Button>
            )}
          {(isAdmin || row.current_role === "admin") &&
            allowed("projects", "status") && (
              <Popconfirm
                title={
                  row.status === "active"
                    ? "确认关闭项目？关闭后内容只读。"
                    : "确认重新开启？"
                }
                onConfirm={() =>
                  command(
                    `projects/${row.id}/${row.status === "active" ? "close" : "reopen"}`,
                    { version: row.version },
                  )
                }
              >
                <Button>{row.status === "active" ? "关闭" : "重新开启"}</Button>
              </Popconfirm>
            )}
        </>
      )}
      {((["documents"].includes(screen) &&
        writable &&
        allowed("documents", "edit") &&
        (!row.document_type || row.document_type === "markdown")) ||
        (["iterations", "members", "categories", "workflow"].includes(screen) &&
          manage &&
          (screen === "categories"
            ? allowed("items", "categories")
            : allowed(screen, "edit"))) ||
        (["users", "user-groups", "positions", "priorities"].includes(screen) &&
          allowed(screen, "edit") &&
          (screen !== "users" || !row.is_superuser) &&
          (screen !== "user-groups" ||
            !row.builtin ||
            row.name !== "系统管理员" ||
            isAdmin))) && <Button onClick={() => editRow(row)}>编辑</Button>}
      {screen === "recycle-bin" && row.can_restore && (
        <Button
          onClick={() =>
            command(`work-items/${row.id}/restore`, { version: row.version })
          }
        >
          恢复
        </Button>
      )}
      {screen === "iterations" &&
        manage &&
        allowed("iterations", row.status === "planned" ? "start" : "finish") &&
        row.status !== "finished" && (
          <Button
            onClick={() =>
              row.status === "planned"
                ? command(`iterations/${row.id}/start`, {
                    version: row.version,
                  })
                : edit(
                    "结束迭代",
                    `iterations/${row.id}/finish`,
                    [
                      {
                        name: "disposition",
                        label: "未完成项处置",
                        required: true,
                        options: [
                          { value: "keep", label: "保留在本迭代" },
                          { value: "move", label: "移至其他迭代" },
                        ],
                      },
                      {
                        name: "target_iteration",
                        label: "目标迭代",
                        options: options(
                          iterations.filter(
                            (i) => i.id !== row.id && i.status !== "finished",
                          ),
                        ),
                      },
                      {
                        name: "confirm",
                        label: "确认结束",
                        required: true,
                        type: "checkbox",
                      },
                    ],
                    row,
                  )
            }
          >
            {row.status === "planned" ? "开始" : "结束"}
          </Button>
        )}
      {screen === "members" && manage && allowed("members", "delete") && (
        <Button danger onClick={() => removeMember(row)}>
          移除
        </Button>
      )}
      {screen === "users" && !row.is_superuser && (
        <>
          {allowed("users", "toggle") &&
            (row.is_active ? (
              <Button
                onClick={() =>
                  edit(
                    `确认停用“${row.display_name}”并处置未完成项`,
                    `users/${row.id}/deactivate`,
                    [
                      {
                        name: "unfinished_items",
                        label: "未完成项处置",
                        type: "handover",
                      },
                    ],
                    row,
                  )
                }
              >
                停用
              </Button>
            ) : (
              <Popconfirm
                title={`确认启用“${row.display_name}”？`}
                onConfirm={() =>
                  command(`users/${row.id}/activate`, { version: row.version })
                }
              >
                <Button>启用</Button>
              </Popconfirm>
            ))}
          {allowed("users", "reset_password") && (
            <Popconfirm
              title="确认重置密码？旧会话将失效。"
              onConfirm={async () => {
                try {
                  const d = await api(
                    `users/${row.id}/reset-password`,
                    "POST",
                    {
                      version: row.version,
                    },
                  );
                  setTemporary(d.temporary_password);
                  reload();
                } catch (e) {
                  fail(e);
                }
              }}
            >
              <Button>重置密码</Button>
            </Popconfirm>
          )}
          {!row.is_active && allowed("users", "delete") && (
            <Popconfirm
              title="确认删除停用用户？"
              onConfirm={() =>
                command("users/" + row.id, { version: row.version }, "DELETE")
              }
            >
              <Button danger>删除</Button>
            </Popconfirm>
          )}
        </>
      )}
      {screen === "users" &&
        isAdmin &&
        row.is_superuser &&
        user?.id === row.id && (
          <Popconfirm
            title="确认重置自己的密码？"
            onConfirm={async () => {
              try {
                const d = await api(`users/${row.id}/reset-password`, "POST", {
                  version: row.version,
                });
                setTemporary(d.temporary_password);
                setSignOutAfterPasswordReset(true);
              } catch (e) {
                fail(e);
              }
            }}
          >
            <Button>重置自己的密码</Button>
          </Popconfirm>
        )}
      {screen === "documents" &&
        isManager &&
        writable &&
        allowed("documents", "delete") && (
          <Popconfirm
            title={
              row.document_type === "folder"
                ? "确认删除空文件夹？"
                : "确认删除文档？"
            }
            onConfirm={() =>
              command("documents/" + row.id, { version: row.version }, "DELETE")
            }
          >
            <Button danger>删除</Button>
          </Popconfirm>
        )}
      {["priorities", "positions", "categories", "user-groups"].includes(
        screen,
      ) &&
        canConfigure("delete") &&
        (screen !== "user-groups" ||
          !row.builtin ||
          row.name !== "系统管理员" ||
          isAdmin) && (
          <Popconfirm
            title={
              screen === "categories"
                ? "确认删除分类？"
                : "确认删除此配置？被引用配置将拒绝删除。"
            }
            onConfirm={() =>
              screen === "categories"
                ? deleteCategory(row)
                : command(
                    (screen === "categories"
                      ? `projects/${projectId}/categories`
                      : screen) +
                      "/" +
                      row.id,
                    { version: row.version },
                    "DELETE",
                  )
            }
          >
            <Button danger>删除</Button>
          </Popconfirm>
        )}
      {["positions", "priorities", "categories", "user-groups"].includes(
        screen,
      ) &&
        canConfigure("toggle") &&
        (screen !== "user-groups" ||
          !row.builtin ||
          row.name !== "系统管理员" ||
          isAdmin) && (
          <Popconfirm
            title={`确认${row.enabled ? "停用" : "启用"}“${row.name}”？`}
            description={
              row.enabled ? "停用后不可新选，历史记录保留。" : undefined
            }
            onConfirm={() =>
              command(
                `${screen === "categories" ? `projects/${projectId}/categories` : screen}/${row.id}`,
                { version: row.version, enabled: !row.enabled },
                "PATCH",
              )
            }
          >
            <Button>{row.enabled ? "停用" : "启用"}</Button>
          </Popconfirm>
        )}
      {screen === "notifications" && (
        <Button
          onClick={async () => {
            if (await command("notifications/" + row.id, {}, "PATCH"))
              await openItem({ id: row.item });
          }}
        >
          查看并标为已读
        </Button>
      )}
    </Space>
  );
  let tableCols: any[] = itemCols;
  if (screen === "projects")
    tableCols = [
      { title: "项目名称", dataIndex: "name" },
      { title: "编码", dataIndex: "code" },
      { title: "负责人", dataIndex: "owner_name" },
      { title: "成员数", dataIndex: "member_count" },
      {
        title: "状态",
        dataIndex: "status",
        render: (v: string) => (
          <Tag>{v === "active" ? "进行中" : "已关闭"}</Tag>
        ),
      },
      { title: "更新时间", dataIndex: "updated_at", render: time },
    ];
  if (screen === "iterations")
    tableCols = [
      {
        title: "名称",
        dataIndex: "name",
        render: (value: string, row: Row) => (
          <Button
            type="link"
            onClick={async () => {
              try {
                setIterationView(await api("iterations/" + row.id));
                if (row.web_url) {
                  window.history.pushState(null, "", row.web_url);
                  setIterationRef(
                    `links/${encodeURIComponent(current?.code || "")}/iteration/${row.id}`,
                  );
                }
              } catch (e) {
                fail(e);
              }
            }}
          >
            {value}
          </Button>
        ),
      },
      { title: "目标", dataIndex: "goal" },
      { title: "开始日期", dataIndex: "start_date" },
      { title: "结束日期", dataIndex: "end_date" },
      { title: "负责人", dataIndex: "owner_name" },
      {
        title: "完成 / 总数",
        dataIndex: "item_total",
        render: (_: any, r: Row) => `${r.item_completed}/${r.item_total}`,
      },
      {
        title: "状态",
        dataIndex: "status",
        render: (v: string) => (v === "planned" ? "未开始" : labels[v]),
      },
    ];
  const enterFolder = (id: string) => {
    setFolderId(id);
    setPage(1);
    setQ("");
  };
  if (screen === "documents")
    tableCols = [
      {
        title: "名称",
        dataIndex: "title",
        render: (value: string, row: Row) => (
          <Space size={12}>
            <DocumentIcon kind={row.document_type || "markdown"} />
            {row.document_type === "folder" ? (
              <a
                href={`?view=documents&project=${projectId}&parent=${row.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  enterFolder(row.id);
                }}
              >
                {value}
              </a>
            ) : (
              <a
                href={documentPageUrl(row)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {row.original_name || value}
              </a>
            )}
          </Space>
        ),
      },
      {
        title: "大小",
        dataIndex: "size_bytes",
        width: 130,
        render: (value: number, row: Row) =>
          row.document_type === "folder"
            ? "—"
            : value
              ? value >= 1048576
                ? (value / 1048576).toFixed(1) + " MB"
                : (value / 1024).toFixed(1) + " KB"
              : "—",
      },
      { title: "修改时间", dataIndex: "updated_at", width: 190, render: time },
    ];
  if (screen === "members")
    tableCols = [
      { title: "姓名", dataIndex: "display_name" },
      {
        title: "职务",
        dataIndex: "position_name",
        render: (value: string) => value || "—",
      },
      { title: "角色", dataIndex: "role", render: (v: string) => labels[v] },
    ];
  if (screen === "recycle-bin")
    tableCols = [
      ...tableCols,
      { title: "项目", dataIndex: "project_name", width: 180 },
      { title: "删除人", dataIndex: "deleted_by_name", width: 120 },
      { title: "删除时间", dataIndex: "deleted_at", width: 180, render: time },
    ];
  if (screen === "users")
    tableCols = [
      { title: "姓名", dataIndex: "display_name" },
      { title: "登录账号", dataIndex: "username" },
      {
        title: "职务",
        dataIndex: "position",
        render: (v: string) => positions.find((p) => p.id === v)?.name || "—",
      },
      {
        title: "用户组",
        dataIndex: "group",
        render: (v: string) => groups.find((p) => p.id === v)?.name || "—",
      },
      {
        title: "状态",
        dataIndex: "is_active",
        render: (v: boolean) => (
          <Tag color={v ? "green" : "default"}>{v ? "启用" : "停用"}</Tag>
        ),
      },
    ];
  if (["priorities", "positions", "categories", "user-groups"].includes(screen))
    tableCols = [
      {
        title: "名称",
        dataIndex: "name",
        render: (value: string, row: Row) =>
          screen === "priorities" ? (
            <PriorityTag name={value} color={row.color} />
          ) : (
            value
          ),
      },
      ...(screen === "priorities"
        ? [
            {
              title: "颜色",
              dataIndex: "color",
              render: (value: string) => (
                <Tag color={value}>
                  {COLORS.find((c) => c.value === value)?.name || "默认"}
                </Tag>
              ),
            },
          ]
        : []),
      {
        title: "状态",
        dataIndex: "enabled",
        render: (v: boolean) => (v ? "启用" : "停用"),
      },
      { title: "更新时间", dataIndex: "updated_at", render: time },
    ];
  if (screen === "notifications")
    tableCols = [
      { title: "事件", dataIndex: "message" },
      { title: "时间", dataIndex: "created_at", render: time },
      {
        title: "状态",
        dataIndex: "read_at",
        render: (v: string) => (v ? "已读" : "未读"),
      },
    ];
  const sortableConfig = ["positions", "priorities", "categories"].includes(
    screen,
  );
  const canSort =
    sortableConfig &&
    canConfigure("reorder") &&
    !q.trim() &&
    !loading &&
    !sortSaving;
  async function reorderRow(
    source: Row,
    target: Row,
    placement: "before" | "after",
  ) {
    if (!canSort || source.id === target.id) return;
    setSortSaving(true);
    setSortDrop(null);
    try {
      await api(
        `${screen === "categories" ? `projects/${projectId}/categories` : screen}/reorder`,
        "POST",
        {
          item_id: source.id,
          version: source.version,
          target_id: target.id,
          target_version: target.version,
          placement,
        },
      );
      reload();
      message.success("顺序已保存");
    } catch (e) {
      fail(e);
      reload();
    } finally {
      setSortSaving(false);
    }
  }
  if (sortableConfig && canConfigure("reorder"))
    tableCols.unshift({
      title: "",
      key: "drag",
      width: 44,
      render: (_: any, row: Row) => (
        <span
          className={`sort-handle${canSort ? "" : " disabled"}`}
          role="button"
          tabIndex={canSort ? 0 : -1}
          aria-label={`拖动排序 ${row.name}`}
          aria-disabled={!canSort}
          title="拖动调整顺序，或使用上下方向键"
          draggable={canSort}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.setData("application/x-reqflow-config", row.id);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => setSortDrop(null)}
          onKeyDown={(event) => {
            const index = rows.findIndex((r) => r.id === row.id);
            const target =
              event.key === "ArrowUp"
                ? rows[index - 1]
                : event.key === "ArrowDown"
                  ? rows[index + 1]
                  : null;
            if (target) {
              event.preventDefault();
              void reorderRow(
                row,
                target,
                event.key === "ArrowUp" ? "before" : "after",
              );
            }
          }}
        >
          ⠿
        </span>
      ),
    });
  const needsProject = [
    "items",
    "iterations",
    "board",
    "documents",
    "reports",
    "members",
    "categories",
    "dictionaries",
    "workflow",
  ].includes(screen);
  const mayCreate =
    (screen === "projects" && allowed("projects", "create")) ||
    (["items", "board"].includes(screen) &&
      writable &&
      allowed("items", "create")) ||
    (["iterations", "members", "categories"].includes(screen) &&
      manage &&
      (screen === "categories"
        ? allowed("items", "categories")
        : allowed(screen, "create"))) ||
    (["users", "positions", "user-groups"].includes(screen) &&
      allowed(screen, "create"));
  const nav = [
    { key: "home", label: "工作台" },
    { key: "projects", label: "项目管理" },
    {
      type: "group" as const,
      label: "项目协作",
      children: [
        { key: "items", label: "工作项" },
        { key: "iterations", label: "迭代规划" },
        { key: "documents", label: "项目文档" },
        { key: "reports", label: "统计报表" },
        { key: "members", label: "项目成员" },
        { key: "dictionaries", label: "字典管理" },
        { key: "workflow", label: "工作流配置" },
        { key: "recycle-bin", label: "回收站" },
      ],
    },
    ...([
      "users",
      "user-groups",
      "positions",
      "priorities",
      "workflow-template",
      "operation-logs",
    ].some(canSee)
      ? [
          {
            type: "group" as const,
            label: "系统管理",
            children: [
              { key: "users", label: "用户管理" },
              { key: "user-groups", label: "用户组与权限" },
              { key: "positions", label: "职务管理" },
              { key: "priorities", label: "默认字典管理" },
              { key: "workflow-template", label: "默认工作流配置" },
              { key: "operation-logs", label: "运行日志" },
            ],
          },
        ]
      : []),
  ];
  const searchPlaceholders: Record<string, string> = {
    home: "搜索编号或标题",
    items: "搜索编号或标题",
    board: "搜索编号或标题",
    "recycle-bin": "搜索编号或标题",
    reports: "搜索编号或标题",
    projects: "搜索项目编码或名称",
    iterations: "搜索名称",
    documents: "搜索名称",
    members: "搜索成员账号或姓名",
    notifications: "搜索通知内容",
    users: "搜索账号或姓名",
    "user-groups": "搜索用户组名称",
    positions: "搜索职务名称",
    categories: "搜索分类名称",
  };
  const titles: Row = {
    "operation-logs": "运行日志",
    home: "我的工作台",
    projects: "项目管理",
    items: "工作项",
    board: "故事墙 / 看板",
    iterations: "迭代规划",
    documents: "项目文档",
    reports: "统计报表",
    members: "项目成员",
    categories: "分类设置",
    workflow: "工作流配置",
    "workflow-template": "默认工作流配置",
    "recycle-bin": "回收站",
    notifications: "站内通知",
    users: "用户管理",
    "user-groups": "用户组与权限",
    positions: "职务管理",
    priorities: "默认字典管理",
    dictionaries: "字典管理",
  };
  const workEditor =
    !!workRoute &&
    workRoute.mode !== "detail" &&
    !!editing &&
    editing.fields.some((f) => f.name === "title") &&
    (editing.fields.some((f) => f.name === "priority") ||
      (workRoute.type === "document" && editing.path.includes("documents")));
  useEffect(() => {
    const pop = () => {
      clearFilePreviews();
      setPendingFiles([]);
      const query = routeQuery();
      setError("");
      setIterationRef(query.get("iteration_ref") || "");
      setIterationView(null);
      setWorkRoute(readWorkRoute());
      setGroupId(query.get("group_id") || "");
      setPage(Math.max(1, Number(query.get("page")) || 1));
      setPageSize(readTablePageSize(query));
      setFolderId(query.get("parent") || "");
      setScreen(
        query.get("view") === "board" ? "items" : query.get("view") || "home",
      );
      setProjectId(query.get("project") || "");
      setType(query.get("type") || "task");
      setEditing(null);
      setDetail(null);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    if (!workRoute || !user || user.must_change_password) return;
    setError("");
    if (workRoute.type === "document") {
      if (workRoute.mode === "create") {
        closeWorkPage();
        return;
      }
      if (workRoute.mode === "edit" && editing) return;
      let active = true;
      (async () => {
        const target = workRoute.reference
          ? await api(workRoute.reference)
          : workRoute;
        return api("documents/" + target.id);
      })()
        .then(async (record) => {
          if (!active) return;
          setProjectId(record.project);
          setScreen("documents");
          if (record.document_type === "folder") {
            setFolderId(record.id);
            setScreen("documents");
            setWorkRoute(null);
            return;
          }
          if (
            workRoute.mode === "edit" &&
            record.document_type &&
            record.document_type !== "markdown"
          ) {
            routeToWork({ mode: "detail", id: record.id, type: "document" });
            return;
          }
          if (workRoute.mode === "edit") {
            const recoveryKey = `${user.id}:${record.project}:document:edit:${record.id}`;
            const recovered = await workDraft(recoveryKey, "read").catch(
              () => undefined,
            );
            if (!active) return;
            if (recovered) {
              restoreFilePreviews(recovered.files);
              setPendingFiles(recovered.files);
              message.info("已恢复登录过期前的编辑内容，请检查后保存");
            }
            setEditing({
              title: "编辑文档",
              path: "documents/" + record.id,
              method: "PATCH",
              fields: docFields(),
              initial: { ...record, ...recovered?.values },
              recoveryKey,
            });
          } else {
            setDetail({ ...record, isDocument: true });
            const data = await api(`documents/${record.id}/attachments`);
            if (active) setAttachments(data.items);
          }
        })
        .catch(fail);
      return () => {
        active = false;
      };
    }
    if (workRoute.mode === "create") {
      if (!editing && projectId && priorities.length) {
        const editor = {
          title: "新建" + kinds[workRoute.type],
          path: `projects/${projectId}/work-items`,
          method: "POST" as const,
          fields: itemFields(workRoute.type),
          initial: {
            type: workRoute.type,
            category: (() => {
              const selected = routeQuery().get("category");
              return selected && selected !== "all" && selected !== "none"
                ? selected
                : null;
            })(),
            priority: priorities.find((p) => p.name === "中" && p.enabled)?.id,
            source:
              dictionaryItems.find(
                (d) =>
                  d.kind === "source" && d.code === "internal" && d.enabled,
              )?.code ||
              dictionaryItems.find((d) => d.kind === "source" && d.enabled)
                ?.code ||
              "",
            severity:
              dictionaryItems.find(
                (d) =>
                  d.kind === "severity" && d.code === "normal" && d.enabled,
              )?.code ||
              dictionaryItems.find((d) => d.kind === "severity" && d.enabled)
                ?.code ||
              "",
          },
        };
        if (!workRoute.copyFrom) setEditing(editor);
        else {
          let active = true;
          (async () => {
            const source = await api(`work-items/${workRoute.copyFrom}`);
            if (source.project !== projectId || source.type !== workRoute.type)
              throw new Error("复制来源与当前项目或类型不匹配");
            const copied = await copyWorkItem(
              source,
              editor.fields,
              editor.initial,
              user,
            );
            if (!active) return;
            restoreFilePreviews(copied.files);
            setPendingFiles(copied.files);
            setEditing({ ...editor, initial: copied.values });
          })().catch((error) => {
            if (active) fail(error);
          });
          return () => {
            active = false;
          };
        }
      }
      return;
    }
    if (workRoute.mode === "edit" && editing) return;
    let active = true;
    (async () => {
      try {
        const target = workRoute.reference
          ? await api(workRoute.reference)
          : workRoute;
        const record = await api("work-items/" + target.id);
        if (!active) return;
        setProjectId(record.project);
        setScreen("items");
        setType(record.type);
        if (workRoute.mode === "edit") {
          const recoveryKey = `${user.id}:${record.project}:${record.type}:edit:${record.id}`;
          const recovered = await workDraft(recoveryKey, "read").catch(
            () => undefined,
          );
          if (!active) return;
          if (recovered) {
            restoreFilePreviews(recovered.files);
            setPendingFiles(recovered.files);
            message.info("已恢复登录过期前的编辑内容，请检查后保存");
          }
          setEditing({
            title: "编辑" + kinds[record.type],
            path: "work-items/" + record.id,
            method: "PATCH",
            fields: itemFields(record.type),
            initial: { ...record, ...record.details, ...recovered?.values },
            recoveryKey,
          });
          return;
        }
        const linkedTask = record.details?.task
          ? await api(`work-items/${record.details.task}`).catch(() => null)
          : null;
        if (!active) return;
        setDetail({ ...record, task_title: linkedTask?.title || "关联已失效" });
        const [c, h, a] = await Promise.all([
          api(`work-items/${record.id}/comments`),
          api(`work-items/${record.id}/history`),
          api(`work-items/${record.id}/attachments`),
        ]);
        if (active) {
          setComments(c.items);
          setHistory(h.items);
          setAttachments(a.items);
        }
      } catch (e) {
        if (active) fail(e);
      }
    })();
    return () => {
      active = false;
    };
  }, [
    workRoute,
    user?.id,
    user?.must_change_password,
    priorities.length,
    projectId,
  ]);
  useEffect(() => {
    if (!user || user.must_change_password || !iterationRef) return;
    let active = true;
    (async () => {
      const target = await api(iterationRef);
      const record = await api(`iterations/${target.id}`);
      if (active) {
        setProjectId(record.project);
        setIterationView(record);
      }
    })().catch((error) => {
      if (active) fail(error);
    });
    return () => {
      active = false;
    };
  }, [iterationRef, user?.id, user?.must_change_password]);
  useSession(user, async () => {
    if (editing && workRoute && user) {
      const key =
        workRoute.mode === "create"
          ? draftKey
          : workRoute.mode === "edit"
            ? `${user.id}:${projectId}:${workRoute.type}:edit:${editing.initial.id}`
            : "";
      if (key)
        await workDraft(key, "write", {
          values: {
            ...form.getFieldsValue(true),
            ...(workRoute.mode === "edit"
              ? { version: editing.initial.version }
              : {}),
          },
          files: pendingFiles,
        }).catch(() => {});
    }
    try {
      sessionStorage.setItem("reqflow:session-expired", "1");
    } catch {
      /* Storage may be unavailable. */
    }
    window.location.reload();
  });
  if (!ready)
    return (
      <div className="login">
        <Card loading />
      </div>
    );
  if (!user)
    return (
      <div className="login">
        <Card title="ReqFlow · 登录">
          <Paragraph type="secondary">让需求、执行与交付连接起来</Paragraph>
          <Form
            form={loginForm}
            layout="vertical"
            onFinish={async (values) => {
              try {
                setSaving(true);
                await api("auth/login", "POST", values);
                setUser(await api("auth/me"));
                setError("");
              } catch (e) {
                fail(e);
              } finally {
                setSaving(false);
              }
            }}
          >
            <Form.Item
              name="username"
              label="登录账号"
              rules={[{ required: true }]}
            >
              <Input autoComplete="username" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true }]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            {error && <Alert title={error} type="error" />}
            <Button type="primary" htmlType="submit" block loading={saving}>
              登录
            </Button>
          </Form>
        </Card>
      </div>
    );
  if (user.must_change_password)
    return (
      <div className="login">
        <Card title="请设置新密码">
          <Form
            layout="vertical"
            onFinish={async (values) => {
              try {
                await api("auth/change-password", "POST", values);
                setUser(await api("auth/me"));
              } catch (e) {
                fail(e);
              }
            }}
          >
            <Form.Item
              name="password"
              label="新密码（至少10位）"
              rules={[{ required: true, min: 10 }]}
            >
              <Input.Password />
            </Form.Item>
            <Button htmlType="submit" type="primary">
              修改密码
            </Button>
          </Form>
        </Card>
      </div>
    );
  if (routeQuery().has("attachment_preview"))
    return <AttachmentPreviewPage user={user} />;
  const renderHeading = () => (
    <div className={"page-heading " + (!workRoute ? "list-heading" : "")}>
      <div>
        {workRoute ? (
          <Title level={2}>
            {workRoute.type === "document"
              ? workRoute.mode === "create"
                ? "新建文档"
                : workRoute.mode === "edit"
                  ? "编辑文档"
                  : "文档详情"
              : pageTitle}
          </Title>
        ) : (
          !["home", "reports", "workflow", "documents", "items"].includes(
            screen,
          ) && (
            <Title level={2}>
              {screen === "board" ? "工作项" : titles[screen]}
            </Title>
          )
        )}
        {screen === "items" && !workRoute && (
          <Tabs
            className="work-type-tabs"
            activeKey={type}
            onChange={(value) => {
              setType(value);
              setPage(1);
            }}
            items={Object.entries(kinds).map(([key, label]) => ({
              key,
              label: label as string,
            }))}
          />
        )}
      </div>
      {screen === "documents" && !workRoute && (
        <div className="drive-breadcrumb">
          <a
            href={`?view=documents&project=${projectId}`}
            onClick={(event) => {
              event.preventDefault();
              enterFolder("");
            }}
          >
            全部文件
          </a>
          {folderTrail.map((folder) => (
            <React.Fragment key={folder.id}>
              <span>/</span>
              <a
                href={`?view=documents&project=${projectId}&parent=${folder.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  enterFolder(folder.id);
                }}
              >
                {folder.title}
              </a>
            </React.Fragment>
          ))}
        </div>
      )}
      <Space>
        {screen === "items" &&
          !workRoute &&
          selected.length > 0 &&
          writable &&
          allowed("items", "bulk") && (
            <Button
              onClick={() =>
                edit(
                  "批量更新",
                  "work-items/bulk-update",
                  [
                    {
                      name: "assignee",
                      label: "负责人",
                      options: options(
                        members.filter((m) => m.role !== "readonly"),
                        "display_name",
                        "user",
                      ),
                    },
                    {
                      name: "priority",
                      label: "优先级",
                      options: options(priorities.filter((p) => p.enabled)),
                    },
                    {
                      name: "iteration",
                      label: "迭代",
                      options: options(
                        iterations.filter((i) => i.status !== "finished"),
                      ),
                    },
                  ],
                  {
                    bulk: true,
                    items: rows
                      .filter((r) => selected.includes(r.id))
                      .map((r) => ({
                        id: r.id,
                        version: r.version,
                      })),
                  },
                )
              }
            >
              批量修改 {selected.length} 项
            </Button>
          )}
        {screen === "members" &&
          selected.length > 0 &&
          manage &&
          allowed("members", "delete") && (
            <Popconfirm
              title={`确认批量移除 ${selected.length} 位成员？`}
              description="他们负责的未完成事项将设为未分配。无法移除的项目会单独报告。"
              onConfirm={async () => {
                try {
                  const items = rows
                    .filter((row) => selected.includes(row.id))
                    .map((row) => ({ user: row.user, version: row.version }));
                  const result = await api(
                    `projects/${projectId}/members/bulk-delete`,
                    "POST",
                    { items },
                  );
                  setSelected([]);
                  reload();
                  if (result.failed?.length)
                    modal.warning({
                      title: "批量移除结果",
                      content: `成功 ${result.succeeded.length} 位；失败 ${result.failed.length} 位：${result.failed.map((entry: Row) => entry.message).join("；")}`,
                    });
                  else
                    message.success(`已移除 ${result.succeeded.length} 位成员`);
                } catch (error) {
                  fail(error);
                }
              }}
            >
              <Button danger>批量删除 {selected.length}</Button>
            </Popconfirm>
          )}
        {workRoute && (
          <Button
            aria-label="返回列表"
            icon={<ArrowLeftOutlined aria-hidden />}
            onClick={closeWorkPage}
          >
            返回列表
          </Button>
        )}
        {screen === "notifications" && (
          <Button onClick={() => command("me/notifications/mark-all-read", {})}>
            全部已读
          </Button>
        )}
        {screen === "documents" &&
          writable &&
          allowed("documents", "folder") &&
          !workRoute && (
            <Button
              onClick={() => {
                let title = "";
                modal.confirm({
                  title: "新建文件夹",
                  content: (
                    <Input
                      autoFocus
                      aria-label="文件夹名称"
                      placeholder="请输入文件夹名称"
                      maxLength={200}
                      onChange={(event) => {
                        title = event.target.value;
                      }}
                    />
                  ),
                  okText: "创建",
                  cancelText: "取消",
                  onOk: async () => {
                    try {
                      await api(`projects/${projectId}/documents`, "POST", {
                        title,
                        document_type: "folder",
                        parent: folderId || null,
                      });
                      reload();
                      message.success("文件夹已创建");
                    } catch (error) {
                      fail(error);
                      throw error;
                    }
                  },
                });
              }}
            >
              新建文件夹
            </Button>
          )}
        {screen === "documents" &&
          writable &&
          allowed("documents", "upload") &&
          !workRoute && (
            <Upload
              accept={(
                user.document_extensions || [
                  "doc",
                  "docx",
                  "xls",
                  "xlsx",
                  "ppt",
                  "pptx",
                  "odt",
                  "ods",
                  "odp",
                  "rtf",
                  "txt",
                  "csv",
                  "pdf",
                ]
              )
                .map((kind: string) => "." + kind)
                .join(",")}
              showUploadList={false}
              disabled={importingDocument}
              beforeUpload={async (file) => {
                const limit = user.document_max_bytes || 10485760;
                if (!file.size || file.size > limit) {
                  message.error(
                    `文档不能为空且不能超过 ${Math.round(limit / 1024 / 1024)} MB`,
                  );
                  return false;
                }
                setImportingDocument(true);
                try {
                  const data = new FormData();
                  data.append("file", file);
                  if (folderId) data.append("parent", folderId);
                  await api(
                    `projects/${projectId}/documents/import`,
                    "POST",
                    data,
                  );
                  message.success("上传成功");
                  reload();
                } catch (error) {
                  fail(error);
                } finally {
                  setImportingDocument(false);
                }
                return false;
              }}
            >
              <Button type="primary" loading={importingDocument}>
                上传文档
              </Button>
            </Upload>
          )}
        {mayCreate && !workRoute && (
          <Button
            type="primary"
            {...(["items", "board"].includes(screen)
              ? {
                  href: workPageUrl("create"),
                  target: "_blank",
                  rel: "noopener noreferrer",
                }
              : { onClick: newRecord })}
          >
            {screen === "members"
              ? "添加成员"
              : `新建${["items", "board"].includes(screen) ? kinds[type] : ""}`}
          </Button>
        )}
      </Space>
    </div>
  );
  const detailValue = (key: string, value: unknown) =>
    valueNames[String(value)] ||
    (key.endsWith("_at")
      ? time(String(value))
      : key === "requirement"
        ? detail?.requirement_title || "—"
        : key === "task"
          ? detail?.task_title || "关联已失效"
          : ["reporter", "submitted_by", "verified_by"].includes(key)
            ? members.find((m) => m.user === value)?.display_name || "历史成员"
            : String(value));
  const renderDetail = () =>
    !detail ? null : detail.isDocument ? (
      <>
        <div className="item-titlebar document-titlebar">
          <Button
            aria-label="关闭"
            title="关闭标签页"
            icon={<CloseOutlined />}
            onClick={() => window.close()}
          />
          <Title level={3}>{detail.title}</Title>
          <Text type="secondary" className="document-meta">
            {detail.document_type || "markdown"} ·{" "}
            {(
              (detail.document_type && detail.document_type !== "markdown"
                ? detail.size_bytes
                : new Blob([detail.body || ""]).size) / 1024
            ).toFixed(1)}{" "}
            KB · {detail.author_name} ·{" "}
            {time(detail.updated_at || detail.created_at)}
          </Text>
          <Space className="document-title-actions">
            <Button
              icon={<LinkOutlined />}
              onClick={() =>
                copyDetailLink(detail.web_url)
                  .then(() =>
                    message.success("链接已复制，对方需登录并具有访问权限"),
                  )
                  .catch(() => message.info("请复制浏览器地址栏中的链接"))
              }
            >
              复制链接
            </Button>
            {writable &&
              allowed("documents", "edit") &&
              (!detail.document_type ||
                detail.document_type === "markdown") && (
                <Button onClick={() => editDocument(detail)}>编辑文档</Button>
              )}
            {allowed("documents", "download") &&
              (!detail.document_type ||
                detail.document_type === "markdown") && (
                <Button
                  aria-label="下载文档"
                  icon={<DownloadOutlined />}
                  onClick={downloadMarkdown}
                >
                  下载文档
                </Button>
              )}
          </Space>
        </div>
        <div className="document-reading-body">
          {detail.document_type && detail.document_type !== "markdown" ? (
            <div className="imported-document">
              <FilePreview
                key={detail.id}
                kind={detail.document_type}
                canDownload={allowed("documents", "download")}
                name={detail.original_name}
                src={detail.preview_url}
              />
            </div>
          ) : (
            <RichContent value={detail.body} />
          )}
          {(!detail.document_type || detail.document_type === "markdown") && (
            <>
              <Title level={5}>附件</Title>
              <Text type="secondary">
                单文件 {Math.round(user.attachment_max_bytes / 1024 / 1024)}{" "}
                MB；
                {user.attachment_extensions.join("、")}
              </Text>
              {attachments.map((a) => (
                <Paragraph key={a.id}>
                  <a
                    href={attachmentPreviewHref(a)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {a.original_name}
                  </a>
                  {writable &&
                    allowed("documents", "delete_attachment") &&
                    (a.uploaded_by === user.id || isManager) && (
                      <Popconfirm
                        title="确认删除附件？"
                        onConfirm={async () => {
                          await command(
                            "attachments/" + a.id,
                            { version: a.version },
                            "DELETE",
                          );
                          refreshDetail();
                        }}
                      >
                        <Button danger size="small">
                          删除
                        </Button>
                      </Popconfirm>
                    )}
                </Paragraph>
              ))}
              {writable && allowed("documents", "upload") && (
                <Upload
                  showUploadList={false}
                  beforeUpload={async (file) => {
                    const data = new FormData();
                    data.append("file", file);
                    try {
                      await api(
                        `documents/${detail.id}/attachments`,
                        "POST",
                        data,
                      );
                      refreshDetail();
                    } catch (e) {
                      fail(e);
                    }
                    return false;
                  }}
                >
                  <Button>上传文档附件</Button>
                </Upload>
              )}
            </>
          )}
        </div>
      </>
    ) : (
      <WorkDetail
        item={detail}
        user={user}
        members={members}
        attachments={attachments}
        comments={comments}
        history={history}
        states={workflow.workflow?.[detail.type]?.states || []}
        transitions={workflow.workflow?.[detail.type]?.transitions || []}
        metadata={[
          {
            key: "type",
            label: "类型",
            children: kinds[detail.type],
          },
          {
            key: "status",
            label: "状态",
            children: (
              <PriorityTag
                name={detail.status_name || labels[detail.status]}
                color={detail.status_color}
              />
            ),
          },
          {
            key: "priority",
            label: "优先级",
            children: (
              <PriorityTag
                name={detail.priority_name}
                color={detail.priority_color}
              />
            ),
          },
          {
            key: "assignee",
            label: "处理人",
            children: detail.assignee_name || "未分配",
          },
          {
            key: "due",
            label: "截止日期",
            children: detail.due_date || "—",
          },
          {
            key: "completed",
            label: "完成时间",
            children: time(detail.completed_at),
          },
          { key: "number", label: "编号", children: detail.number },
          {
            key: "category",
            label: "分类",
            children:
              categories.find((c) => c.id === detail.category)?.name || "—",
          },
          {
            key: "iteration",
            label: "迭代",
            children:
              iterations.find((i) => i.id === detail.iteration)?.name || "—",
          },
          {
            key: "start",
            label: "计划开始日期",
            children: detail.planned_start_date || "—",
          },
          {
            key: "creator",
            label: "创建人",
            children: detail.created_by_name || "历史成员",
          },
          {
            key: "created",
            label: "创建时间",
            children: time(detail.created_at),
          },
          ...Object.entries(detail.details || {})
            .filter(
              ([k, v]) =>
                ![
                  "item",
                  "acceptance_criteria",
                  "expected_finish_date",
                  "steps_to_reproduce",
                  "actual_result",
                  "expected_result",
                ].includes(k) && v,
            )
            .map(([k, v]) => ({
              key: k,
              label:
                itemFields(detail.type).find((f) => f.name === k)?.label ||
                detailLabels[k] ||
                "信息",
              children: ["environment", "severity", "source"].includes(k)
                ? dictionaryTag(k, v)
                : detailValue(k, v),
            })),
        ]}
        writable={!!writable}
        canEdit={!!writable && allowed("items", "edit")}
        manager={!!isManager}
        onEdit={() => editWorkItem(detail)}
        onCopy={() => {
          clearFilePreviews();
          setPendingFiles([]);
          setEditing(null);
          routeToWork({
            mode: "create",
            type: detail.type,
            copyFrom: detail.id,
          });
        }}
        onRenameTitle={async (title) => {
          try {
            const updated = await api(`work-items/${detail.id}`, "PATCH", {
              version: detail.version,
              title,
            });
            setDetail({ ...detail, ...updated, details: detail.details });
            message.success("标题已更新");
            reload();
            return true;
          } catch (error) {
            fail(error);
            return false;
          }
        }}
        onDelete={async () => {
          if (
            await command(
              "work-items/" + detail.id,
              { version: detail.version, confirm: true },
              "DELETE",
            )
          )
            closeWorkPage();
        }}
        onUpload={async (files) => {
          let uploaded = 0;
          for (const file of files) {
            const data = new FormData();
            data.append("file", file);
            try {
              await api(`work-items/${detail.id}/attachments`, "POST", data);
              uploaded++;
            } catch (error: any) {
              message.error(`${file.name}：${error.message || "上传失败"}`);
            }
          }
          if (uploaded) {
            message.success(`已上传 ${uploaded} 个附件`);
            try {
              const data = await api(`work-items/${detail.id}/attachments`);
              setAttachments(data.items);
            } catch (error) {
              fail(error);
            }
          }
        }}
        onDeleteAttachment={async (file) => {
          if (
            await command(
              "attachments/" + file.id,
              { version: file.version },
              "DELETE",
            )
          )
            await refreshDiscussion();
        }}
        onComment={async (data) => {
          try {
            await api(`work-items/${detail.id}/comments`, "POST", data);
            await refreshDiscussion();
            return true;
          } catch (error) {
            fail(error);
            return false;
          }
        }}
        onEditComment={async (record, data) => {
          try {
            await api("comments/" + record.id, "PATCH", data);
            await refreshDiscussion();
            return true;
          } catch (error) {
            fail(error);
            return false;
          }
        }}
        onDeleteComment={async (record) => {
          if (
            await command(
              "comments/" + record.id,
              { version: record.version },
              "DELETE",
            )
          )
            await refreshDiscussion();
        }}
        onTransition={async (data) => {
          try {
            await api(`work-items/${detail.id}/transition`, "POST", data);
            reload();
            refreshDetail();
            return true;
          } catch (error) {
            fail(error);
            return false;
          }
        }}
      />
    );
  const pageTitle = workRoute
    ? workRoute.mode === "detail"
      ? `${kinds[workRoute.type]}详情`
      : editing?.title || "加载中"
    : titles[screen];
  const widths: Row = {
    number: 190,
    title: 280,
    name: 180,
    goal: 260,
    description: 260,
    message: 320,
    updated_at: 170,
    created_at: 170,
    due_date: 130,
    start_date: 130,
    end_date: 130,
    username: 160,
    display_name: 140,
    owner_name: 130,
    assignee_name: 130,
    code: 160,
    member_count: 90,
    status: 130,
    priority_name: 110,
  };
  // A content column absorbs spare space; fixed-width columns, especially actions,
  // must not be proportionally stretched when the table has few fields.
  const flexibleColumn =
    tableCols.find(
      (column) =>
        column.dataIndex &&
        ["title", "name", "message", "display_name", "number"].includes(
          column.dataIndex,
        ),
    ) || tableCols.find((column) => column.dataIndex);
  const showActions = !["items", "board"].includes(screen);
  const actionWidth = !showActions
    ? 0
    : screen === "users"
      ? 240
      : screen === "members"
        ? 210
        : screen === "projects"
          ? 208
          : screen === "notifications"
            ? 160
            : ["positions", "priorities", "categories", "user-groups"].includes(
                  screen,
                )
              ? 180
              : 120;
  const listScrollWidth = tableCols.reduce(
    (sum, column) =>
      sum + Number(column.width || widths[column.dataIndex] || 140),
    actionWidth + (screen === "items" ? 32 : 0),
  );
  const listColumns = [
    ...tableCols.map((column) => ({
      ...column,
      width:
        column === flexibleColumn
          ? undefined
          : column.width || widths[column.dataIndex] || 140,
      ellipsis: !column.render,
    })),
    ...(showActions
      ? [
          {
            title: "操作",
            key: "actions",
            fixed: "right" as const,
            align: "right" as const,
            className: "table-actions-cell",
            width: actionWidth,
            render: (_: any, row: Row) => actions(row),
          },
        ]
      : []),
  ];
  const icons: Row = {
    home: <DashboardOutlined />,
    projects: <ProjectOutlined />,
    notifications: <BellOutlined />,
    items: <UnorderedListOutlined />,
    board: <AppstoreOutlined />,
    iterations: <CalendarOutlined />,
    documents: <FileTextOutlined />,
    members: <TeamOutlined />,
    reports: <DashboardOutlined />,
    users: <UserOutlined />,
    "recycle-bin": <DeleteOutlined />,
  };
  const ListContainer = screen === "home" ? Card : "div";
  const menuItems = nav
    .filter((item) =>
      item.type === "group"
        ? item.children?.some((child) => canSee(child.key))
        : canSee(item.key),
    )
    .map((item) =>
      item.type === "group"
        ? {
            ...item,
            children: item.children
              ?.filter((child) => canSee(child.key))
              .map((child) => ({
                ...child,
                icon: (
                  <span aria-hidden="true">
                    {icons[child.key] || <SettingOutlined />}
                  </span>
                ),
              })),
          }
        : {
            ...item,
            icon: (
              <span aria-hidden="true">
                {icons[item.key] || <SettingOutlined />}
              </span>
            ),
          },
    );
  return (
    <Layout
      className={
        "app-layout" +
        (workRoute?.type === "document" && workRoute.mode === "detail"
          ? " document-viewer-layout"
          : "")
      }
    >
      <Layout.Sider className="sidebar" width={240} theme="light">
        <div className="brand">
          ReqFlow <span>团队协作</span>
        </div>
        <Menu
          className="sidebar-menu"
          mode="inline"
          selectedKeys={[
            screen === "group-editor"
              ? "user-groups"
              : screen === "board"
                ? "items"
                : screen,
          ]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Layout.Sider>
      <Layout className="main-layout">
        <Layout.Header className="header">
          <div className="project-switcher">
            <Select
              aria-label="当前项目"
              placeholder="选择项目"
              variant="borderless"
              prefix={<ProjectOutlined />}
              suffixIcon={
                <span className="project-switcher-affordance">
                  切换项目 <DownOutlined />
                </span>
              }
              showSearch
              optionFilterProp="searchText"
              value={projectId || undefined}
              options={options(
                current &&
                  !projects.some((project) => project.id === current.id)
                  ? [...projects, current]
                  : projects,
              )}
              onChange={(id) => {
                setFolderId("");
                setFolderTrail([]);
                setProjectId(id);
                setFilter({});
                setWorkRoute(null);
                setDetail(null);
                setEditing(null);
                clearFilePreviews();
                setPendingFiles([]);
                setPage(1);
              }}
              style={{ width: 360 }}
            />
          </div>
          <Space className="header-actions">
            <Badge count={unread} size="small">
              <Button
                type="text"
                aria-label="站内通知"
                icon={<BellOutlined />}
                onClick={() => navigate("notifications")}
              />
            </Badge>
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "password",
                    label: "修改密码",
                    icon: <LockOutlined aria-hidden />,
                  },
                  { type: "divider" },
                  {
                    key: "logout",
                    label: "退出登录",
                    icon: <LogoutOutlined aria-hidden />,
                  },
                ],
                onClick: async ({ key }) => {
                  if (key === "logout") {
                    await api("auth/logout", "POST");
                    setDetail(null);
                    setEditing(null);
                    setWorkRoute(null);
                    setProjectId("");
                    setProjects([]);
                    setMembers([]);
                    setRows([]);
                    setScreen("home");
                    clearFilePreviews();
                    setPendingFiles([]);
                    setUser(null);
                    return;
                  }
                  edit(
                    "修改密码",
                    "auth/change-password",
                    [
                      {
                        name: "old_password",
                        label: "当前密码",
                        required: true,
                        password: true,
                      },
                      {
                        name: "password",
                        label: "新密码（至少10位）",
                        required: true,
                        password: true,
                      },
                    ],
                    {},
                    "POST",
                  );
                },
              }}
            >
              <Button
                type="text"
                className="account-menu"
                aria-label="用户菜单"
              >
                <Avatar size={28} icon={<UserOutlined />} />
                <span>{user.display_name}</span>
                <DownOutlined />
              </Button>
            </Dropdown>
          </Space>
        </Layout.Header>
        <Layout.Content
          className={
            "content" +
            (workRoute ? " work-content" : "") +
            (screen === "group-editor" ? " group-editor-content" : "") +
            (workEditor ||
            (workRoute?.mode === "detail" && !detail?.isDocument && writable)
              ? " has-editor-footer"
              : "")
          }
        >
          {error && (
            <Alert
              type="error"
              closable
              title={error}
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          {current?.status === "closed" && needsProject && (
            <Alert
              title="项目已关闭，当前内容只读。项目管理员可在项目列表重新开启。"
              type="warning"
              style={{ marginBottom: 16 }}
            />
          )}
          {!screenAllowed ? (
            <Card>
              <Empty description="没有此页面的菜单权限，请从左侧选择可访问页面。" />
              {nav
                .filter((item) => item.key && canSee(item.key))
                .map((item) => (
                  <Button key={item.key} onClick={() => navigate(item.key!)}>
                    {item.label}
                  </Button>
                ))}
            </Card>
          ) : screen === "group-editor" ? (
            allowed("user-groups", groupId ? "edit" : "create") ? (
              <GroupEditor
                id={groupId}
                onClose={() => navigate("user-groups")}
                onSaved={() => {
                  reload();
                  navigate("user-groups");
                }}
              />
            ) : (
              <Alert type="info" title="没有用户组维护权限" />
            )
          ) : workRoute ? (
            <section className="work-page">
              {workRoute.mode !== "detail" &&
              !allowed(
                workRoute.type === "document" ? "documents" : "items",
                workRoute.mode === "create" ? "create" : "edit",
              ) ? (
                <Alert type="warning" title="没有此功能的操作权限" />
              ) : workEditor && editing ? (
                <Card
                  className={
                    "editor-card " +
                    (workRoute.type === "document"
                      ? "document-editor"
                      : "item-editor")
                  }
                >
                  <RecordForm
                    form={form}
                    fields={
                      workRoute.type === "document"
                        ? docFields()
                        : itemFields(editing.initial.type || workRoute.type)
                    }
                    itemType={workRoute.type}
                    attachmentsAside={workRoute.type !== "document"}
                    attachments={
                      workRoute.type === "document" &&
                      workRoute.mode === "create" ? undefined : !allowed(
                          workRoute.type === "document" ? "documents" : "items",
                          "upload",
                        ) ? undefined : (
                        <div className="pending-attachments">
                          <Text strong>附件</Text>
                          <AttachmentPicker
                            user={user}
                            browserDrop={workRoute.type !== "document"}
                            compact={workRoute.type !== "document"}
                            maxFiles={Math.max(0, 20 - pendingFiles.length)}
                            onFiles={(files) => {
                              files.forEach(addPendingFile);
                            }}
                          />
                          <div className="pending-file-list">
                            {pendingFiles.map((f) => (
                              <div
                                key={f.token}
                                className="attachment-file pending-attachment-file"
                              >
                                <DocumentIcon
                                  kind={
                                    f.file.name
                                      .split(".")
                                      .pop()
                                      ?.toLowerCase() || ""
                                  }
                                  className="attachment-file-icon"
                                />
                                <span
                                  className="attachment-name pending-file-name"
                                  title={f.file.name}
                                >
                                  {f.file.name}
                                </span>
                                <Button
                                  className="attachment-row-actions"
                                  type="text"
                                  size="small"
                                  aria-label={"移除待上传附件 " + f.file.name}
                                  title="删除"
                                  icon={<DeleteOutlined />}
                                  onClick={() => removePendingFile(f.token)}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    }
                    onAddFile={(file) => {
                      if (
                        !allowed(
                          workRoute.type === "document" ? "documents" : "items",
                          "upload",
                        )
                      ) {
                        message.warning("没有添加图片的权限");
                        return null;
                      }
                      return addPendingFile(file);
                    }}
                    initial={editing.initial}
                    wide
                  />
                  <div className="form-footer">
                    <Space>
                      <Button
                        type="primary"
                        loading={saving}
                        onClick={() => void submit()}
                      >
                        {workRoute.mode === "create" &&
                        workRoute.type !== "document"
                          ? "创建"
                          : "保存"}
                      </Button>
                      {workRoute.mode === "create" &&
                        workRoute.type !== "document" && (
                          <>
                            <Button
                              disabled={saving}
                              onClick={() => void submit(true)}
                            >
                              提交并继续创建
                            </Button>
                            <Button
                              disabled={saving}
                              onClick={() => void saveDraft()}
                            >
                              保存草稿
                            </Button>
                          </>
                        )}
                      <Button disabled={saving} onClick={cancelWorkEditor}>
                        取消
                      </Button>
                    </Space>
                  </div>
                </Card>
              ) : workRoute.mode === "detail" && detail ? (
                <Card
                  className={
                    "detail-card " +
                    (workRoute.type === "document"
                      ? "document-detail"
                      : "work-detail-card")
                  }
                >
                  {renderDetail()}
                </Card>
              ) : (
                <Card loading={!error}>{error || "正在加载…"}</Card>
              )}
            </section>
          ) : (
            <>
              {screen === "home" && (
                <>
                  <Workbench
                    dashboard={dashboard}
                    projects={projects}
                    recentIds={recentIds}
                    scope={filter.todo_scope || "all"}
                    canSeeItems={canSee("items")}
                    canSeeProjects={canSee("projects")}
                    onScope={(scope) => {
                      setQ("");
                      setFilter({ todo_scope: scope });
                      setPage(1);
                      requestAnimationFrame(() =>
                        document
                          .querySelector(".workbench-todos")
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          }),
                      );
                    }}
                    onProjects={() => navigate("projects")}
                    onProject={(id) => {
                      setProjectId(id);
                      navigate("items");
                    }}
                  />
                </>
              )}

              {screen === "operation-logs" ? (
                <OperationLogs />
              ) : screen === "workflow-template" ||
                (screen === "workflow" && !!projectId) ? (
                <WorkflowManager
                  key={`${screen}:${projectId}`}
                  projectId={screen === "workflow" ? projectId : undefined}
                  canManage={
                    allowed(screen, "configure") &&
                    (screen === "workflow-template"
                      ? true
                      : !!current &&
                        current.status === "active" &&
                        isManager &&
                        !!user?.permissions?.includes("manage_members"))
                  }
                  onSaved={reload}
                />
              ) : ["dictionaries", "priorities"].includes(screen) &&
                (!needsProject || !!projectId) ? (
                <DictionaryManager
                  key={`${screen}:${projectId}`}
                  projectId={screen === "dictionaries" ? projectId : undefined}
                  canManage={
                    screen === "priorities"
                      ? true
                      : !!current &&
                        current.status === "active" &&
                        isManager &&
                        !!user?.permissions?.includes("manage_members")
                  }
                  allowed={(operation) => allowed(screen, operation)}
                  onChanged={reload}
                />
              ) : needsProject && !projectId ? (
                <Card>
                  <Empty description="请先选择或创建项目" />
                </Card>
              ) : (
                <ListContainer
                  className={
                    screen === "home"
                      ? "workbench-todo-card"
                      : screen === "items"
                        ? "work-list-with-tree"
                        : undefined
                  }
                >
                  {screen === "home" && (
                    <div className="workbench-todos">
                      <Typography.Title level={4}>
                        我负责的待办
                      </Typography.Title>
                      <Tabs
                        activeKey={filter.todo_scope || "all"}
                        items={[
                          { key: "all", label: "全部待办" },
                          { key: "today", label: "今日到期" },
                          { key: "overdue", label: "逾期" },
                        ]}
                        onChange={(value) => {
                          setFilter({ todo_scope: value });
                          setPage(1);
                          setQ("");
                        }}
                      />
                    </div>
                  )}
                  {screen === "items" && (
                    <aside
                      className="work-category-tree"
                      aria-label="工作项分类"
                    >
                      <div className="category-heading">
                        <Text strong>分类</Text>
                        {manage && allowed("items", "categories") && (
                          <Button
                            type="text"
                            size="small"
                            icon={<PlusOutlined />}
                            aria-label="新增分类"
                            onClick={() => editCategory()}
                          />
                        )}
                      </div>
                      <nav className="category-nav" aria-label="分类筛选">
                        {[
                          { id: "all", name: "全部分类" },
                          { id: "none", name: "默认分类" },
                          ...categories,
                        ].map((category) => {
                          const selected =
                            (filter.category || "all") === category.id;
                          return (
                            <div className="category-row" key={category.id}>
                              <Button
                                block
                                type="text"
                                aria-pressed={selected}
                                className={selected ? "category-selected" : ""}
                                icon={
                                  category.id === "all" ? (
                                    <AppstoreOutlined />
                                  ) : (
                                    <FolderOutlined />
                                  )
                                }
                                onClick={() => {
                                  setFilter({
                                    ...filter,
                                    category:
                                      category.id === "all"
                                        ? undefined
                                        : category.id,
                                  });
                                  setPage(1);
                                }}
                              >
                                {category.name}
                              </Button>
                              {manage &&
                                allowed("items", "categories") &&
                                category.id !== "all" &&
                                category.id !== "none" && (
                                  <div className="category-actions">
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<EditOutlined />}
                                      aria-label={`修改分类 ${category.name}`}
                                      onClick={() => editCategory(category)}
                                    />
                                    <Popconfirm
                                      title="确认删除分类？"
                                      onConfirm={() => deleteCategory(category)}
                                    >
                                      <Button
                                        type="text"
                                        size="small"
                                        danger
                                        icon={<DeleteOutlined />}
                                        aria-label={`删除分类 ${category.name}`}
                                      />
                                    </Popconfirm>
                                  </div>
                                )}
                            </div>
                          );
                        })}
                      </nav>
                    </aside>
                  )}
                  {screen !== "workflow" && (
                    <FilterPanel
                      key={screen}
                      onSearch={searchLists}
                      onReset={() => {
                        setDraftQ("");
                        setDraftFilter({});
                        setQ("");
                        setFilter({});
                        setPage(1);
                      }}
                    >
                      <Space wrap className="filters">
                        <Input
                          type="search"
                          allowClear
                          aria-label="搜索"
                          placeholder={searchPlaceholders[screen] || "搜索名称"}
                          value={draftQ}
                          onChange={(e) => {
                            setDraftQ(e.target.value);
                          }}
                          style={{ width: 260 }}
                        />
                        {screen === "home" && (
                          <>
                            <Select
                              allowClear
                              placeholder="待办项目"
                              style={{ width: 170 }}
                              value={draftFilter.project}
                              options={options(
                                current &&
                                  !projects.some(
                                    (project) => project.id === current.id,
                                  )
                                  ? [...projects, current]
                                  : projects,
                              )}
                              onChange={(value) =>
                                setDraftFilter({
                                  ...draftFilter,
                                  project: value,
                                })
                              }
                            />
                            <Select
                              allowClear
                              placeholder="工作项类型"
                              style={{ width: 130 }}
                              value={draftFilter.type}
                              options={Object.entries(kinds).map(
                                ([value, label]) => ({
                                  value,
                                  label: label as string,
                                }),
                              )}
                              onChange={(value) =>
                                setDraftFilter({ ...draftFilter, type: value })
                              }
                            />
                            <ChineseDateInput
                              aria-label="截止日期上限"
                              placeholder="截止日期上限"
                              value={draftFilter.due_before || ""}
                              onChange={(value) =>
                                setDraftFilter({
                                  ...draftFilter,
                                  due_before: value || undefined,
                                })
                              }
                            />
                          </>
                        )}
                        {["items", "board", "reports", "home"].includes(
                          screen,
                        ) && (
                          <>
                            <Select
                              allowClear
                              aria-label="状态"
                              placeholder="状态"
                              style={{ width: 130 }}
                              value={draftFilter.status}
                              options={(
                                workflow.workflow?.[type]?.states || []
                              ).map((st: Row) => ({
                                value: st.code,
                                label: st.name,
                              }))}
                              onChange={(v) =>
                                setDraftFilter({ ...draftFilter, status: v })
                              }
                            />
                            <Select
                              allowClear
                              aria-label="优先级"
                              placeholder="优先级"
                              style={{ width: 120 }}
                              value={draftFilter.priority}
                              options={options(priorities)}
                              onChange={(v) =>
                                setDraftFilter({ ...draftFilter, priority: v })
                              }
                            />
                            <Select
                              allowClear
                              aria-label="负责人"
                              placeholder="负责人"
                              style={{ width: 150 }}
                              value={draftFilter.assignee}
                              options={options(members, "display_name", "user")}
                              onChange={(v) =>
                                setDraftFilter({ ...draftFilter, assignee: v })
                              }
                            />
                            <Select
                              allowClear
                              aria-label="迭代"
                              placeholder="迭代"
                              style={{ width: 160 }}
                              value={draftFilter.iteration}
                              options={options(iterations)}
                              onChange={(v) =>
                                setDraftFilter({ ...draftFilter, iteration: v })
                              }
                            />
                            {screen === "items" ? (
                              <DatePicker.RangePicker
                                aria-label="创建日期范围"
                                placeholder={["创建开始日期", "创建结束日期"]}
                                format="YYYY-MM-DD"
                                allowEmpty={[true, true]}
                                style={{ width: 290 }}
                                value={[
                                  draftFilter.date_from
                                    ? dayjs(draftFilter.date_from)
                                    : null,
                                  draftFilter.date_to
                                    ? dayjs(draftFilter.date_to)
                                    : null,
                                ]}
                                onChange={(dates) => {
                                  setDraftFilter({
                                    ...draftFilter,
                                    date_from: dates?.[0]?.format("YYYY-MM-DD"),
                                    date_to: dates?.[1]?.format("YYYY-MM-DD"),
                                  });
                                }}
                              />
                            ) : (
                              <>
                                {" "}
                                <ChineseDateInput
                                  aria-label="创建日期从"
                                  placeholder="创建日期从"
                                  value={draftFilter.date_from || ""}
                                  onChange={(value) =>
                                    setDraftFilter({
                                      ...draftFilter,
                                      date_from: value || undefined,
                                    })
                                  }
                                />
                                <ChineseDateInput
                                  aria-label="创建日期至"
                                  placeholder="创建日期至"
                                  value={draftFilter.date_to || ""}
                                  onChange={(value) =>
                                    setDraftFilter({
                                      ...draftFilter,
                                      date_to: value || undefined,
                                    })
                                  }
                                />
                              </>
                            )}
                          </>
                        )}
                        {screen === "projects" && (
                          <>
                            <Select
                              allowClear
                              placeholder="项目状态"
                              style={{ width: 130 }}
                              options={[
                                { label: "进行中", value: "active" },
                                { label: "已关闭", value: "closed" },
                              ]}
                              value={draftFilter.status}
                              onChange={(v) =>
                                setDraftFilter({ ...draftFilter, status: v })
                              }
                            />
                            <Select
                              allowClear
                              placeholder="项目负责人"
                              style={{ width: 160 }}
                              options={options(users, "display_name")}
                              value={draftFilter.owner}
                              onChange={(v) =>
                                setDraftFilter({ ...draftFilter, owner: v })
                              }
                            />
                          </>
                        )}
                        {screen === "users" && (
                          <>
                            <Select
                              allowClear
                              placeholder="职务"
                              style={{ width: 130 }}
                              options={options(positions)}
                              value={draftFilter.position}
                              onChange={(v) =>
                                setDraftFilter({ ...draftFilter, position: v })
                              }
                            />
                            <Select
                              allowClear
                              placeholder="用户组"
                              style={{ width: 140 }}
                              options={options(groups)}
                              value={draftFilter.group}
                              onChange={(v) =>
                                setDraftFilter({ ...draftFilter, group: v })
                              }
                            />
                            <Select
                              allowClear
                              placeholder="账号状态"
                              style={{ width: 130 }}
                              options={[
                                { label: "启用", value: "True" },
                                { label: "停用", value: "False" },
                              ]}
                              value={draftFilter.is_active}
                              onChange={(v) =>
                                setDraftFilter({ ...draftFilter, is_active: v })
                              }
                            />
                          </>
                        )}
                      </Space>
                    </FilterPanel>
                  )}
                  {!["home", "reports", "workflow"].includes(screen) &&
                    renderHeading()}
                  {screen === "reports" ? (
                    <Reports
                      report={report}
                      workflow={workflow.workflow || {}}
                      dictionaries={dictionaryItems}
                      projectId={projectId}
                      query={{ ...filter, q }}
                      canExport={
                        user.permissions.includes("export") &&
                        (isAdmin || me?.role !== "readonly")
                      }
                    />
                  ) : (
                    <>
                      <Table
                        size="small"
                        rowKey="id"
                        loading={loading || sortSaving}
                        rowClassName={(row) =>
                          sortDrop && sortDrop.id === row.id
                            ? `sort-drop-${sortDrop.placement}`
                            : ""
                        }
                        onRow={(row) =>
                          canSort
                            ? {
                                onDragOver: (event) => {
                                  if (
                                    !event.dataTransfer.types.includes(
                                      "application/x-reqflow-config",
                                    )
                                  )
                                    return;
                                  event.preventDefault();
                                  event.dataTransfer.dropEffect = "move";
                                  const bounds =
                                    event.currentTarget.getBoundingClientRect();
                                  setSortDrop({
                                    id: row.id,
                                    placement:
                                      event.clientY <
                                      bounds.top + bounds.height / 2
                                        ? "before"
                                        : "after",
                                  });
                                },
                                onDrop: (event) => {
                                  event.preventDefault();
                                  const source = rows.find(
                                    (r) =>
                                      r.id ===
                                      event.dataTransfer.getData(
                                        "application/x-reqflow-config",
                                      ),
                                  );
                                  const bounds =
                                    event.currentTarget.getBoundingClientRect();
                                  setSortDrop(null);
                                  if (source)
                                    void reorderRow(
                                      source,
                                      row,
                                      event.clientY <
                                        bounds.top + bounds.height / 2
                                        ? "before"
                                        : "after",
                                    );
                                },
                              }
                            : {}
                        }
                        dataSource={rows}
                        columns={listColumns}
                        tableLayout="fixed"
                        scroll={{
                          x: listScrollWidth,
                        }}
                        rowSelection={
                          screen === "items" || screen === "members"
                            ? {
                                selectedRowKeys: selected,
                                onChange: setSelected,
                              }
                            : undefined
                        }
                        pagination={tablePagination({
                          current: page,
                          pageSize,
                          total,
                          onChange: (nextPage, nextSize) => {
                            setPage(nextSize !== pageSize ? 1 : nextPage);
                            setPageSize(nextSize);
                          },
                        })}
                      />
                    </>
                  )}
                </ListContainer>
              )}
              {screen === "home" && (
                <WorkbenchBottom
                  dashboard={dashboard}
                  canSeeItems={canSee("items")}
                  canSeeProjects={canSee("projects")}
                  onProjects={() => navigate("projects")}
                  onProject={(id) => {
                    setProjectId(id);
                    navigate("items");
                  }}
                  onItem={(id) => void openItem({ id })}
                />
              )}
            </>
          )}
        </Layout.Content>
      </Layout>
      {editing && !workEditor && (
        <Modal
          zIndex={2000}
          title={editing?.title}
          open={!!editing}
          onCancel={() => setEditing(null)}
          onOk={() => void submit()}
          confirmLoading={saving}
          destroyOnHidden
          centered
          width={640}
        >
          <RecordForm
            form={form}
            fields={editing.fields}
            initial={editing.initial}
          />
        </Modal>
      )}
      <Modal
        zIndex={2000}
        title="一次性临时密码"
        open={!!temporary}
        onCancel={closeTemporaryPassword}
        onOk={closeTemporaryPassword}
        centered
      >
        <Alert
          title="仅显示本次；关闭后无法再次查看。首次登录需修改密码。"
          type="warning"
        />
        <Paragraph copyable style={{ marginTop: 20 }}>
          {temporary}
        </Paragraph>
      </Modal>
      <Drawer
        title={iterationView?.name}
        open={!!iterationView}
        onClose={() => {
          setIterationView(null);
          setIterationRef("");
        }}
        size={720}
        extra={
          iterationView?.web_url && (
            <Button
              icon={<LinkOutlined />}
              onClick={() =>
                copyDetailLink(iterationView.web_url)
                  .then(() =>
                    message.success("链接已复制，对方需登录并具有访问权限"),
                  )
                  .catch(() => message.info("请复制浏览器地址栏中的链接"))
              }
            >
              复制链接
            </Button>
          )
        }
      >
        <Descriptions
          column={2}
          items={[
            {
              key: "owner",
              label: "负责人",
              children: iterationView?.owner_name,
            },
            {
              key: "dates",
              label: "日期",
              children: `${iterationView?.start_date} 至 ${iterationView?.end_date}`,
            },
            {
              key: "goal",
              label: "目标",
              children: iterationView?.goal || "—",
            },
            {
              key: "count",
              label: "完成 / 总数",
              children: `${iterationView?.item_completed} / ${iterationView?.item_total}`,
            },
          ]}
        />
        <Title level={5}>工作项状态分布</Title>
        <Table
          size="small"
          rowKey={(r: Row) => r.type + r.status}
          pagination={false}
          dataSource={iterationView?.items_by_state || []}
          columns={[
            {
              title: "类型",
              dataIndex: "type",
              render: (v: string) => kinds[v],
            },
            {
              title: "状态",
              dataIndex: "status",
              render: (v: string, row: Row) =>
                workflow.workflow?.[row.type || "bug"]?.states?.find(
                  (state: Row) => state.code === v,
                )?.name ||
                labels[v] ||
                v,
            },
            { title: "数量", dataIndex: "count" },
          ]}
        />
        <Title level={5}>逾期事项</Title>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={iterationView?.overdue_items || []}
          columns={[
            { title: "编号", dataIndex: "number" },
            { title: "标题", dataIndex: "title" },
            { title: "截止日期", dataIndex: "due_date" },
          ]}
        />
        <Title level={5}>最近变更</Title>
        {(iterationView?.recent_changes || []).map((event: Row) => (
          <Paragraph key={event.id}>
            <Tag>{actionNames[event.action] || "更新"}</Tag>
            {event.after?.title} · {time(event.created_at)}
          </Paragraph>
        ))}
      </Drawer>
      <Drawer
        title={detail?.isDocument ? "项目文档" : detail?.number}
        open={!!detail && !!detail.isDocument && !workRoute}
        onClose={() => setDetail(null)}
        size={760}
      >
        {renderDetail()}
      </Drawer>
    </Layout>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      button={{ autoInsertSpace: false }}
      theme={{
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 6,
          fontSize: 14,
          colorText: "#262626",
          colorBgLayout: "#f5f5f5",
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
      }}
    >
      <App>
        <Client />
      </App>
    </ConfigProvider>
  </React.StrictMode>,
);
