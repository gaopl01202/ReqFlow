import { useEffect, useRef, useState } from "react";
import { Select, Spin } from "antd";
import { api, type Row } from "./api";

/** Search the permitted project scope rather than a truncated page of cached rows. */
export function WorkItemSelect({
  projectId,
  type,
  value,
  onChange,
  id,
}: {
  projectId: string;
  type: string;
  value?: string | null;
  onChange?: (value: string | undefined) => void;
  id?: string;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  useEffect(() => {
    let active = true;
    setSelected(null);
    if (value)
      api(`work-items/${encodeURIComponent(value)}`)
        .then((row) => {
          if (active && row.project === projectId && row.type === type)
            setSelected(row);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [value, projectId, type]);
  useEffect(() => {
    const version = ++request.current;
    setLoading(true);
    setRows([]);
    setError("");
    const timer = window.setTimeout(
      () => {
        const params = new URLSearchParams({ type, q: query, page_size: "50" });
        api(`projects/${projectId}/work-items?${params}`)
          .then((result) => {
            if (version === request.current) setRows(result.items);
          })
          .catch(() => {
            if (version === request.current) {
              setRows([]);
              setError("加载失败，请重新搜索");
            }
          })
          .finally(() => {
            if (version === request.current) setLoading(false);
          });
      },
      query ? 250 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      request.current++;
    };
  }, [projectId, type, query]);
  const choices =
    selected && !rows.some((row) => row.id === selected.id)
      ? [selected, ...rows]
      : rows;
  return (
    <Select
      id={id}
      value={value || undefined}
      onChange={onChange}
      allowClear
      showSearch
      placeholder="按编号或标题搜索"
      onSearch={setQuery}
      filterOption={false}
      loading={loading}
      notFoundContent={loading ? <Spin size="small" /> : error || "暂无匹配项"}
      options={choices.map((row) => ({
        value: row.id,
        label: row.title,
        title: row.title,
        number: row.number,
      }))}
      optionRender={(option) => (
        <div>
          <div>{option.label}</div>
          <small style={{ color: "#8c8c8c" }}>{option.data.number}</small>
        </div>
      )}
    />
  );
}
