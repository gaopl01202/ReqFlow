import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { api, type Row } from "./api";
import { tablePagination, readTablePageSize } from "./ui";

export function OperationLogs() {
  const [draft, setDraft] = useState<Row>({});
  const [filters, setFilters] = useState<Row>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() =>
    readTablePageSize(new URLSearchParams(window.location.search)),
  );
  const [data, setData] = useState<Row>({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) query.set(key, String(value));
    });
    api(`operation-logs?${query}`)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
          setData({ items: [], total: 0 });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters, page, pageSize]);
  const change = (key: string, value: unknown) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <Space orientation="vertical" size={16} style={{ display: "flex" }}>
      <Card size="small">
        <Space wrap>
          <Input
            allowClear
            placeholder="搜索操作人、对象ID或项目"
            aria-label="搜索运行日志"
            value={draft.q || ""}
            onChange={(event) => change("q", event.target.value)}
            style={{ width: 280 }}
          />
          <Select
            allowClear
            placeholder="操作类型"
            aria-label="操作类型"
            value={draft.action}
            options={data.actions}
            onChange={(value) => change("action", value)}
            style={{ width: 150 }}
          />
          <Select
            allowClear
            placeholder="对象类型"
            aria-label="对象类型"
            value={draft.resource_type}
            options={data.resource_types}
            onChange={(value) => change("resource_type", value)}
            style={{ width: 150 }}
          />
          <DatePicker.RangePicker
            value={draft.dates || null}
            onChange={(dates) =>
              setDraft((current) => ({
                ...current,
                dates,
                date_from: dates?.[0]?.format("YYYY-MM-DD"),
                date_to: dates?.[1]?.format("YYYY-MM-DD"),
              }))
            }
          />
          <Button
            onClick={() => {
              setDraft({});
              setFilters({});
              setPage(1);
            }}
          >
            重置
          </Button>
          <Button
            type="primary"
            onClick={() => {
              const { dates: _, ...query } = draft;
              setFilters(query);
              setPage(1);
            }}
          >
            搜索
          </Button>
        </Space>
      </Card>
      {error && <Alert showIcon type="error" title={error} />}
      <Card
        title="运行日志"
        extra={
          <Typography.Text type="secondary">仅记录操作摘要</Typography.Text>
        }
      >
        <Table
          rowKey="id"
          loading={loading}
          dataSource={data.items}
          scroll={{ x: 1100 }}
          pagination={tablePagination({
            current: page,
            pageSize,
            total: data.total,
            onChange: (next, size) => {
              setPage(next);
              setPageSize(size);
            },
          })}
          columns={[
            {
              title: "时间",
              dataIndex: "created_at",
              width: 175,
              render: (value: string) =>
                dayjs(value).format("YYYY-MM-DD HH:mm:ss"),
            },
            {
              title: "操作人",
              dataIndex: "actor_name",
              width: 160,
              render: (value: string, row: Row) => (
                <span title={row.actor_username}>
                  {value}
                  <Typography.Text type="secondary" style={{ marginLeft: 6 }}>
                    （{row.actor_username}）
                  </Typography.Text>
                </span>
              ),
            },
            {
              title: "操作",
              dataIndex: "action_label",
              width: 130,
              render: (value: string) => <Tag>{value}</Tag>,
            },
            { title: "对象类型", dataIndex: "resource_label", width: 120 },
            {
              title: "对象ID",
              dataIndex: "resource_id",
              width: 330,
              render: (value: string) => (
                <Typography.Text copyable>{value}</Typography.Text>
              ),
            },
            {
              title: "所属项目",
              dataIndex: "project_name",
              ellipsis: true,
              render: (value: string) => value || "—",
            },
          ]}
        />
      </Card>
    </Space>
  );
}
