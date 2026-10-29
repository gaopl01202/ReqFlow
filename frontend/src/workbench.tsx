import {
  Button,
  Card,
  Col,
  Empty,
  Progress,
  Row as GridRow,
  Statistic,
  Tag,
  Typography,
} from "antd";
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  ProjectOutlined,
} from "@ant-design/icons";
import { time, type Row } from "./api";
import { actionNames } from "./ui";
export function Workbench({
  dashboard,
  projects,
  recentIds,
  scope,
  onScope,
  onProjects,
  onProject,
  canSeeItems,
  canSeeProjects,
}: {
  dashboard: Row;
  projects: Row[];
  recentIds: string[];
  scope: string;
  onScope: (scope: string) => void;
  onProjects: () => void;
  onProject: (id: string) => void;
  canSeeItems: boolean;
  canSeeProjects: boolean;
}) {
  if (dashboard.unfinished === undefined) return <Card loading />;
  const cards = [
    {
      label: "未完成事项",
      value: dashboard.unfinished,
      key: "all",
      color: "#1677ff",
      icon: <CheckCircleOutlined />,
    },
    {
      label: "今日到期",
      value: dashboard.due_today,
      key: "today",
      color: "#fa8c16",
      icon: <ClockCircleOutlined />,
    },
    {
      label: "逾期事项",
      value: dashboard.overdue,
      key: "overdue",
      color: "#cf1322",
      icon: <ExclamationCircleOutlined />,
    },
    {
      label: "参与项目",
      value: dashboard.projects,
      key: "projects",
      color: "#722ed1",
      icon: <ProjectOutlined />,
    },
  ];
  const recents = recentIds
    .map((id) => projects.find((p) => p.id === id))
    .filter(Boolean) as Row[];
  return (
    <div className="workbench">
      <div className="workbench-heading">
        <Typography.Title level={3}>我的工作台</Typography.Title>
        <Typography.Text type="secondary">
          先处理到期事项，再了解项目进展。
        </Typography.Text>
      </div>
      <GridRow gutter={[16, 16]}>
        {cards.map((card) => (
          <Col xs={12} lg={6} key={card.key}>
            <Card className="workbench-metric-card">
              <button
                disabled={card.key === "projects" && !canSeeProjects}
                type="button"
                className={`workbench-metric ${card.key === scope ? "is-selected" : ""}`}
                onClick={() =>
                  card.key === "projects" ? onProjects() : onScope(card.key)
                }
                aria-label={`${card.label} ${card.value || 0}`}
              >
                <span
                  className="workbench-metric-icon"
                  style={{ color: card.color }}
                >
                  {card.icon}
                </span>
                <Statistic
                  title={card.label}
                  value={card.value || 0}
                  valueStyle={{ color: card.color }}
                />
                <span className="workbench-metric-link">
                  {card.key === "projects" ? "查看项目" : "查看待办"}
                  <ArrowRightOutlined />
                </span>
              </button>
            </Card>
          </Col>
        ))}
      </GridRow>
      <Card title="最近访问项目" className="workbench-recents">
        <div className="workbench-recent-grid">
          {recents.map((project) => (
            <Button
              disabled={!canSeeItems}
              className="recent-project-card"
              key={project.id}
              onClick={() => onProject(project.id)}
            >
              <strong>{project.name}</strong>
              <span>{project.member_count || 0} 位成员</span>
            </Button>
          ))}
          {!recents.length && (
            <Typography.Text type="secondary">暂无最近访问项目</Typography.Text>
          )}
        </div>
      </Card>
    </div>
  );
}
export function WorkbenchBottom({
  dashboard,
  onProjects,
  onProject,
  onItem,
  canSeeItems,
  canSeeProjects,
}: {
  dashboard: Row;
  onProjects: () => void;
  onProject: (id: string) => void;
  onItem: (id: string) => void;
  canSeeItems: boolean;
  canSeeProjects: boolean;
}) {
  return (
    <GridRow gutter={[16, 16]} className="workbench-bottom">
      <Col xs={24} lg={12}>
        <Card
          title="项目进展"
          extra={
            canSeeProjects && (
              <Button type="link" onClick={onProjects}>
                项目管理 <ArrowRightOutlined />
              </Button>
            )
          }
        >
          <div className="workbench-projects">
            {(dashboard.project_progress || [])
              .slice(0, 4)
              .map((project: Row) => (
                <div className="workbench-project" key={project.id}>
                  <div>
                    <Button
                      type="link"
                      disabled={!canSeeItems}
                      onClick={() => onProject(project.id)}
                    >
                      {project.name}
                    </Button>
                    <Typography.Text type="secondary">
                      {project.member_count} 位成员 · 我的待办{" "}
                      {project.unfinished}
                    </Typography.Text>
                  </div>
                  <Progress
                    percent={
                      project.total
                        ? Math.round((project.completed / project.total) * 100)
                        : 0
                    }
                    size="small"
                  />
                  <small>
                    {project.completed} / {project.total} 项已完成
                  </small>
                </div>
              ))}
            {!dashboard.project_progress?.length && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无可访问项目"
              />
            )}
          </div>
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <WorkbenchActivity
          activity={(dashboard.activity || []).filter(
            (row: Row) => row.entity_type === "WorkItem",
          )}
          onItem={onItem}
        />
      </Col>
    </GridRow>
  );
}
export function WorkbenchActivity({
  activity,
  onItem,
}: {
  activity: Row[];
  onItem: (id: string) => void;
}) {
  return (
    <Card title="最近动态" className="workbench-activity">
      {activity.length ? (
        activity.slice(0, 8).map((row) => (
          <div className="workbench-activity-row" key={row.id}>
            <Tag>{actionNames[row.action] || "更新"}</Tag>
            <Button type="link" onClick={() => onItem(row.entity_id)}>
              {row.after?.title || row.after?.name || "项目动态"}
            </Button>
            <Typography.Text type="secondary">
              {time(row.created_at)}
            </Typography.Text>
          </div>
        ))
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无项目动态"
        />
      )}
    </Card>
  );
}
