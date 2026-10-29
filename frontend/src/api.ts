import type { components } from "./generated/api";
export type CurrentUser = components["schemas"]["CurrentUser"];
export type Row = Record<string, any>;
let csrf = "";
let csrfCookie = "";
const currentCsrfCookie = () =>
  document.cookie.split("; ").find((entry) => entry.startsWith("csrftoken=")) ||
  "";
async function readJson(response: Response): Promise<Row | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Row;
  } catch {
    return null;
  }
}
export async function api(
  path: string,
  method = "GET",
  data?: Row | FormData,
): Promise<any> {
  if (method !== "GET" && csrf && csrfCookie !== currentCsrfCookie()) csrf = "";
  if (method !== "GET" && !csrf) {
    const res = await fetch("/api/v1/auth/csrf");
    const body = await readJson(res);
    if (!res.ok || typeof body?.csrf_token !== "string")
      throw new Error("暂时无法连接服务，请稍后重试");
    csrf = body.csrf_token;
    csrfCookie = currentCsrfCookie();
  }
  const response = await fetch("/api/v1/" + path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(data instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(method === "GET" ? {} : { "X-CSRFToken": csrf }),
    },
    body:
      method === "GET"
        ? undefined
        : data instanceof FormData
          ? data
          : JSON.stringify(data || {}),
  });
  if (response.status === 204) {
    if (path === "auth/logout") {
      csrf = "";
      try {
        localStorage.setItem("reqflow:session-check", String(Date.now()));
      } catch {
        /* Storage may be unavailable. */
      }
    }
    return null;
  }
  const body = await readJson(response);
  if (!response.ok) {
    if (
      path !== "auth/login" &&
      (response.status === 401 || body?.code === "SESSION_EXPIRED")
    ) {
      csrf = "";
      window.dispatchEvent(new Event("reqflow:session-expired"));
      try {
        localStorage.setItem("reqflow:session-check", String(Date.now()));
      } catch {
        /* Storage may be unavailable. */
      }
    }
    const message =
      body?.message || `服务暂时无法处理请求（${response.status}），请稍后重试`;
    throw Object.assign(new Error(message), body || {});
  }
  if (!body) throw new Error("服务返回了无效响应，请稍后重试");
  if (path === "auth/login") {
    csrf = "";
    try {
      localStorage.setItem("reqflow:session-check", String(Date.now()));
    } catch {
      /* Storage may be unavailable. */
    }
  }
  return body;
}
export function time(value: string | null) {
  if (!value) return "—";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}
