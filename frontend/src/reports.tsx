import {
  Button,
  Card,
  Col,
  Empty,
  Row as GridRow,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import type { Row } from "./api";
import { COLORS, tablePagination, WorkTypeBadge } from "./ui";

const kinds: Row = { requirement: "需求", task: "任务", bug: "缺陷" };
const palette = [
  "#1677ff",
  "#52c41a",
  "#fa8c16",
  "#722ed1",
  "#13c2c2",
  "#eb2f96",
  "#8c8c8c",
];
type Slice = { name: string; value: number; color: string };
function Donut({ data, label }: { data: Slice[]; label: string }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total)
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
    );
  let offset = 0;
  return (
    <div className="report-donut">
      <svg
        viewBox="0 0 200 200"
        role="img"
        aria-label={`${label}：${data.map((item) => `${item.name} ${item.value}`).join("，")}`}
      >
        {data
          .filter((item) => item.value > 0)
          .map((item) => {
            const portion = (item.value / total) * 100;
            const start = offset;
            offset += portion;
            return (
              <circle
                key={item.name}
                cx="100"
                cy="100"
                r="72"
                fill="none"
                stroke={item.color}
                strokeWidth="23"
                pathLength="100"
                strokeDasharray={`${portion} ${100 - portion}`}
                strokeDashoffset={-start}
                transform="rotate(-90 100 100)"
              >
                <title>
                  {item.name}：{item.value}（{Math.round(portion)}%）
                </title>
              </circle>
            );
          })}
        <text x="100" y="98" textAnchor="middle" className="report-chart-total">
          {total.toLocaleString()}
        </text>
        <text
          x="100"
          y="121"
          textAnchor="middle"
          className="report-chart-caption"
        >
          合计
        </text>
      </svg>
      <ul>
        {data.map((item) => (
          <li key={item.name}>
            <span className="color-dot" style={{ background: item.color }} />
            <span>{item.name}</span>
            <strong>{item.value.toLocaleString()}</strong>
            <small>{Math.round((item.value / total) * 100)}%</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
function MemberBars({ rows }: { rows: Row[] }) {
  const top = [...rows]
    .sort((a, b) => b.unfinished - a.unfinished || b.completed - a.completed)
    .slice(0, 8);
  const max = Math.max(
    1,
    ...top.flatMap((row) => [row.unfinished, row.completed]),
  );
  if (!top.length)
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="暂无成员工作量"
      />
    );
  return (
    <div
      className="report-bars"
      role="img"
      aria-label="成员工作量，按未完成数量展示前八位"
    >
      <div className="report-bar-legend">
        <span>
          <i style={{ background: palette[0] }} />
          未完成
        </span>
        <span>
          <i style={{ background: palette[1] }} />
          本期完成
        </span>
      </div>
      {top.map((row, index) => (
        <div className="report-bar-row" key={row.id || index}>
          <span title={row.name}>{row.name}</span>
          <div>
            {["unfinished", "completed"].map((key, i) => (
              <div className="report-bar-track" key={key}>
                <div
                  style={{
                    width: `${(row[key] / max) * 100}%`,
                    background: palette[i],
                  }}
                />
                <b>{row[key]}</b>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
export function Reports({
  report,
  workflow,
  dictionaries,
  projectId,
  query,
  canExport,
}: {
  report: Row;
  workflow: Row;
  dictionaries: Row[];
  projectId: string;
  query: Row;
  canExport: boolean;
}) {
  const states: Row[] = report.states || [];
  const members: Row[] = report.members || [];
  const stateSpec = (type: string, code: string) =>
    workflow[type]?.states?.find((state: Row) => state.code === code);
  const statusName = (type: string, code: string) =>
    stateSpec(type, code)?.name || code;
  const color = (name: string, fallback: string) =>
    COLORS.find((item) => item.value === name)?.hex || fallback;
  const typeData = Object.entries(kinds).map(([type, name], index) => ({
    name: String(name),
    value: states
      .filter((row) => row.type === type)
      .reduce((sum, row) => sum + row.count, 0),
    color: type === "bug" ? "#f5222d" : palette[index],
  }));
  const severityData = (report.severities || []).map(
    (row: Row, index: number) => {
      const spec = dictionaries.find(
        (item) => item.kind === "severity" && item.code === row.code,
      );
      return {
        name: spec?.name || row.code || "未设置",
        value: row.count,
        color: color(spec?.color, palette[index % palette.length]),
      };
    },
  );
  const exportButton = (table: string) =>
    canExport ? (
      <Button
        icon={<DownloadOutlined />}
        href={`/api/v1/projects/${projectId}/reports/export?${new URLSearchParams({ ...Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== "")), table })}`}
      >
        导出表格
      </Button>
    ) : undefined;
  return (
    <div className="reports-page">
      <GridRow gutter={[16, 16]} className="report-summary">
        {[
          {
            title: "有效工作项",
            value: report.total || 0,
            hint: "不含已取消",
            color: palette[0],
          },
          {
            title: "已完成",
            value: report.completed || 0,
            hint: "完成类别的工作项",
            color: palette[1],
          },
          {
            title: "未完成",
            value: report.unfinished || 0,
            hint: "待处理及进行中",
            color: palette[2],
          },
          {
            title: "完成率",
            value:
              report.completion_rate == null
                ? "—"
                : Math.round(report.completion_rate * 100),
            suffix: report.completion_rate == null ? undefined : "%",
            hint: "已完成 / 有效工作项",
            color: palette[3],
          },
        ].map((item) => (
          <Col xs={12} lg={6} key={item.title}>
            <Card>
              <Statistic
                title={item.title}
                value={item.value}
                suffix={item.suffix}
                valueStyle={{ color: item.color }}
              />
              <Typography.Text type="secondary">{item.hint}</Typography.Text>
            </Card>
          </Col>
        ))}
      </GridRow>
      <GridRow gutter={[16, 16]}>
        <Col xs={24} xl={8}>
          <Card title="完成情况" className="report-chart-card">
            <Donut
              label="完成情况"
              data={[
                {
                  name: "已完成",
                  value: report.completed || 0,
                  color: palette[1],
                },
                {
                  name: "未完成",
                  value: report.unfinished || 0,
                  color: palette[0],
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="工作项类型" className="report-chart-card">
            <Donut label="工作项类型" data={typeData} />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="缺陷严重程度" className="report-chart-card">
            <Donut label="缺陷严重程度" data={severityData} />
          </Card>
        </Col>
      </GridRow>
      <GridRow gutter={[16, 16]} align="stretch">
        <Col xs={24} xl={8}>
          <Card
            title="成员工作量"
            className="report-member-chart"
            extra={
              <Typography.Text type="secondary">
                未完成数量前 8 位
              </Typography.Text>
            }
          >
            <MemberBars rows={members} />
          </Card>
        </Col>
        <Col xs={24} xl={16}>
          <Card
            title="成员工作量明细"
            className="report-member-table"
            extra={exportButton("members")}
          >
            <Typography.Paragraph type="secondary">
              逾期是未完成项的子集；多人处理的工作项分别计入每位处理人。本期完成按完成日期统计，其余按创建日期筛选。
            </Typography.Paragraph>
            <Table
              size="small"
              rowKey={(row, index) => row.id || String(index)}
              dataSource={members}
              pagination={tablePagination()}
              scroll={{ x: 580 }}
              columns={[
                { title: "处理人", dataIndex: "name" },
                {
                  title: "未完成",
                  dataIndex: "unfinished",
                  align: "right",
                  sorter: (a, b) => a.unfinished - b.unfinished,
                },
                {
                  title: "其中逾期",
                  dataIndex: "overdue",
                  align: "right",
                  render: (value: number) => (
                    <span style={{ color: value ? "#cf1322" : undefined }}>
                      {value}
                    </span>
                  ),
                },
                {
                  title: "本期完成",
                  dataIndex: "completed",
                  align: "right",
                  sorter: (a, b) => a.completed - b.completed,
                },
              ]}
            />
          </Card>
        </Col>
      </GridRow>
      <GridRow gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card
            title="状态分布明细"
            className="report-detail-card"
            extra={exportButton("states")}
          >
            {(["requirement", "task", "bug"] as const).map((type) => (
              <section className="report-state-section" key={type}>
                <Typography.Text strong>{kinds[type]}</Typography.Text>
                <Table
                  size="small"
                  rowKey={(row) => row.status}
                  dataSource={states.filter((row) => row.type === type)}
                  pagination={tablePagination()}
                  scroll={{ x: 360 }}
                  columns={[
                    {
                      title: "状态",
                      dataIndex: "status",
                      render: (code: string, row: Row) => (
                        <Tag color={stateSpec(row.type, code)?.color}>
                          {statusName(row.type, code)}
                        </Tag>
                      ),
                    },
                    { title: "数量", dataIndex: "count", align: "right" },
                  ]}
                />
              </section>
            ))}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card
            title="缺陷分布明细"
            className="report-detail-card"
            extra={exportButton("bugs")}
          >
            <Table
              size="small"
              rowKey={(_, index) => String(index)}
              dataSource={report.bugs || []}
              pagination={tablePagination()}
              scroll={{ x: 500 }}
              columns={[
                {
                  title: "状态",
                  dataIndex: "status",
                  render: (code: string) => (
                    <Tag color={stateSpec("bug", code)?.color}>
                      {statusName("bug", code)}
                    </Tag>
                  ),
                },
                {
                  title: "严重程度",
                  dataIndex: "bugdetail__severity",
                  render: (code: string) => {
                    const item = dictionaries.find(
                      (d) => d.kind === "severity" && d.code === code,
                    );
                    return (
                      <Tag color={item?.color}>{item?.name || code || "—"}</Tag>
                    );
                  },
                },
                {
                  title: "处理人",
                  dataIndex: "assignee__display_name",
                  render: (name: string) => name || "未分配",
                },
                { title: "数量", dataIndex: "count", align: "right" },
              ]}
            />
          </Card>
        </Col>
      </GridRow>
      <Typography.Text type="secondary">
        图表统计工作项不重复计数；缺陷明细按处理人分组，多人处理时可能出现于多行。导出包含当前筛选下的整张表。
      </Typography.Text>
    </div>
  );
}
