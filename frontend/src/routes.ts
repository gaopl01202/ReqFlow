/** Public detail paths coexist with legacy query-string entry points. */
export function routeQuery() {
  const query = new URLSearchParams(location.search);
  const match = location.pathname.match(
    /^\/p\/([^/]+)\/(requirement|task|bug|document|iteration)\/([^/]+)(\/edit)?\/?$/,
  );
  if (match) {
    let code: string;
    try {
      code = decodeURIComponent(match[1]);
    } catch {
      return query;
    }
    const [, , kind, reference, edit] = match;
    const target = `links/${encodeURIComponent(code)}/${kind}/${encodeURIComponent(reference)}`;
    query.set("project_code", code);
    if (kind === "iteration") {
      query.set("view", "iterations");
      query.set("iteration_ref", target);
    } else {
      query.set("view", kind === "document" ? "documents" : "items");
      query.set("type", kind);
      query.set("item_type", kind);
      query.set("item_mode", edit ? "edit" : "detail");
      query.set("item_ref", target);
      query.set(
        "item_path",
        location.pathname.replace(/\/edit\/?$/, "").replace(/\/$/, ""),
      );
      query.delete("item_id");
    }
  }
  const attachment = location.pathname.match(
    /^\/attachments\/([0-9a-f-]{36})\/?$/i,
  );
  if (attachment) query.set("attachment_preview", attachment[1]);
  return query;
}

export function detailLocation(base: string, mode: string) {
  return base + (mode === "edit" ? "/edit" : "");
}

export async function copyDetailLink(path: string) {
  await navigator.clipboard.writeText(new URL(path, location.origin).href);
}
