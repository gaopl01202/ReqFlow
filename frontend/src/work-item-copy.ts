import { api, type Row } from "./api";
import { canAction } from "./permissions";
import { attachmentError, type Field } from "./ui";
import type { PendingFile } from "./rich-editor";

/** Copy only writable form values. New IDs, state, authors and history come from create. */
export async function copyWorkItem(
  source: Row,
  fields: Field[],
  defaults: Row,
  user: Row,
) {
  const data = { ...source, ...source.details };
  const values: Row = { ...defaults };
  for (const field of fields) {
    const value = data[field.name];
    if (value === undefined) continue;
    if (
      field.options &&
      value &&
      !field.options.some(
        (option) => option.value === value && !option.disabled,
      )
    ) {
      if (!["priority", "severity", "source"].includes(field.name))
        values[field.name] = null;
    } else values[field.name] = value;
  }
  const files: PendingFile[] = [];
  let description = String(values.description || "");
  const images = [
    ...description.matchAll(
      /\/api\/v1\/attachments\/([0-9a-f-]{36})\?inline=1/gi,
    ),
  ];
  if (images.length && !canAction(user, "items", "upload"))
    throw new Error("描述中包含图片，需要添加附件/粘贴图片权限才能复制");
  const tokens = new Map<string, string>();
  for (const match of images) {
    const id = match[1];
    let token = tokens.get(id);
    if (!token) {
      if (files.length >= 20)
        throw new Error("描述中的图片超过20个，请减少后再复制");
      const meta = await api(`attachments/${id}/metadata`);
      const response = await fetch(`/api/v1/attachments/${id}?preview=1`, {
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new Error("描述图片加载失败，请重新登录或稍后重试");
      const blob = await response.blob();
      const suffix = meta.original_name.split(".").pop()?.toLowerCase();
      const mime: Row = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        bmp: "image/bmp",
        svg: "image/svg+xml",
      };
      const file = new File([blob], meta.original_name, {
        type: blob.type.startsWith("image/")
          ? blob.type
          : mime[suffix] || "application/octet-stream",
      });
      const error = attachmentError(file, user);
      if (error) throw new Error(`${file.name}：${error}`);
      token = "reqflow-upload:" + crypto.randomUUID();
      tokens.set(id, token);
      files.push({ file, token });
    }
    description = description.replaceAll(match[0], token);
  }
  values.description = description;
  return { values, files };
}
