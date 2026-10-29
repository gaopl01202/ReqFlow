import {
  FolderFilled,
  FileWordFilled,
  FileExcelFilled,
  FilePptFilled,
  FilePdfFilled,
  FileImageFilled,
  FileTextFilled,
  FileFilled,
} from "@ant-design/icons";
export function DocumentIcon({
  kind,
  className = "drive-file-icon",
}: {
  kind: string;
  className?: string;
}) {
  const spec =
    kind === "folder"
      ? [FolderFilled, "#f5b83d"]
      : ["doc", "docx"].includes(kind)
        ? [FileWordFilled, "#3975d5"]
        : ["xls", "xlsx", "csv"].includes(kind)
          ? [FileExcelFilled, "#2d9b6f"]
          : ["ppt", "pptx"].includes(kind)
            ? [FilePptFilled, "#e47b41"]
            : kind === "pdf"
              ? [FilePdfFilled, "#e45b5b"]
              : ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(
                    kind,
                  )
                ? [FileImageFilled, "#9674d8"]
                : ["txt", "md", "markdown", "json", "xml", "log"].includes(kind)
                  ? [FileTextFilled, "#6a8fa8"]
                  : [FileFilled, "#8296ac"];
  const Icon = spec[0] as typeof FileFilled;
  return (
    <Icon
      className={className}
      style={{ color: spec[1] as string }}
      aria-label={kind === "folder" ? "文件夹" : `${kind.toUpperCase()}文件`}
    />
  );
}
