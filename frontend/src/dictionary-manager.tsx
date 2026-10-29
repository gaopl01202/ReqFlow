import { dictionaryColor } from "./semantic-colors";
import { useEffect, useState } from "react";
import {
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from "antd";
import { PlusOutlined, HolderOutlined } from "@ant-design/icons";
import { api, time, type Row } from "./api";
import { COLORS, colorOptions, tablePagination } from "./ui";
export async function dictionaryRows(base: string, kind: string) {
  const rows: Row[] = [];
  let page = 1;
  while (true) {
    const result = await api(`${base}?kind=${kind}&page_size=100&page=${page}`);
    rows.push(...result.items);
    if (rows.length >= result.total || !result.items.length) return rows;
    page += 1;
  }
}
const kinds = [
  ["environment", "环境"],
  ["severity", "严重程度"],
  ["priority", "优先级"],
  ["source", "来源"],
];
export function DictionaryManager({
  projectId,
  canManage,
  allowed = () => true,
  onChanged,
}: {
  projectId?: string;
  canManage: boolean;
  allowed?: (operation: string) => boolean;
  onChanged: () => void;
}) {
  const { message } = App.useApp();
  const [kind, setKind] = useState("environment");
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dragged, setDragged] = useState<Row | null>(null);
  const [form] = Form.useForm();
  const [colorPicked, setColorPicked] = useState(false);
  const base = projectId
    ? `projects/${projectId}/dictionaries`
    : "dictionaries";
  const fail = (error: any) => message.error(error.message || "操作失败");
  useEffect(() => {
    let active = true;
    setRows([]);
    dictionaryRows(base, kind)
      .then((d) => {
        if (active) setRows(d);
      })
      .catch(fail);
    return () => {
      active = false;
    };
  }, [base, kind, revision]);
  const changed = () => {
    setRevision((x) => x + 1);
    onChanged();
  };
  const edit = (row: Row = {}) => {
    setEditing(row);
    setColorPicked(false);
    form.setFieldsValue({
      name: "",
      color: dictionaryColor(kind),
      ...row,
    });
  };
  async function save() {
    try {
      const values = await form.validateFields();
      setBusy(true);
      await api(
        base + (editing?.id ? "/" + editing.id : ""),
        editing?.id ? "PATCH" : "POST",
        {
          ...values,
          kind,
          ...(editing?.id ? { version: editing.version } : {}),
        },
      );
      setEditing(null);
      changed();
      message.success("保存成功");
    } catch (error: any) {
      if (error.message) fail(error);
    } finally {
      setBusy(false);
    }
  }
  async function reorder(target: Row, source = dragged, placement = "before") {
    if (
      !canManage ||
      !allowed("reorder") ||
      !source ||
      source.id === target.id ||
      busy
    )
      return;
    setBusy(true);
    try {
      await api(base + "/reorder", "POST", {
        kind,
        item_id: source.id,
        version: source.version,
        target_id: target.id,
        target_version: target.version,
        placement,
      });
      changed();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
      setDragged(null);
    }
  }
  return (
    <Card className="dictionary-manager">
      <Tabs
        activeKey={kind}
        onChange={setKind}
        items={kinds.map(([key, label]) => ({ key, label }))}
        tabBarExtraContent={
          canManage &&
          allowed("create") && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => edit()}
            >
              新增字典项
            </Button>
          )
        }
      />
      <Table
        size="small"
        rowKey="id"
        dataSource={rows}
        pagination={tablePagination()}
        onRow={(row) => ({
          onDragOver: (event) => event.preventDefault(),
          onDrop: () => void reorder(row),
        })}
        columns={[
          ...(canManage && allowed("reorder")
            ? [
                {
                  title: "",
                  width: 36,
                  render: (_: unknown, row: Row) => (
                    <span
                      draggable
                      tabIndex={0}
                      role="button"
                      onKeyDown={(event) => {
                        if (!["ArrowUp", "ArrowDown"].includes(event.key))
                          return;
                        event.preventDefault();
                        const index = rows.findIndex(
                          (item) => item.id === row.id,
                        );
                        const target =
                          rows[index + (event.key === "ArrowUp" ? -1 : 1)];
                        if (target)
                          void reorder(
                            target,
                            row,
                            event.key === "ArrowUp" ? "before" : "after",
                          );
                      }}
                      aria-label={`拖动 ${row.name}`}
                      onDragStart={() => setDragged(row)}
                      onDragEnd={() => setDragged(null)}
                      style={{ cursor: "grab" }}
                    >
                      <HolderOutlined />
                    </span>
                  ),
                },
              ]
            : []),
          {
            title: "名称",
            dataIndex: "name",
            render: (name: string, row: Row) => (
              <Tag color={row.color}>{name}</Tag>
            ),
          },
          {
            title: "颜色",
            dataIndex: "color",
            width: 100,
            render: (color: string) => (
              <Tag color={color}>
                {COLORS.find((item) => item.value === color)?.name || "默认"}
              </Tag>
            ),
          },
          {
            title: "状态",
            dataIndex: "enabled",
            width: 100,
            render: (enabled: boolean) => (enabled ? "启用" : "停用"),
          },
          {
            title: "更新时间",
            dataIndex: "updated_at",
            width: 180,
            render: time,
          },
          ...(canManage
            ? [
                {
                  title: "操作",
                  align: "right" as const,
                  className: "table-actions-cell",
                  fixed: "right" as const,
                  width: 180,
                  render: (_: unknown, row: Row) => (
                    <Space>
                      {allowed("edit") && (
                        <Button
                          type="link"
                          size="small"
                          onClick={() => edit(row)}
                        >
                          编辑
                        </Button>
                      )}
                      {allowed("toggle") && (
                        <Popconfirm
                          title={`确认${row.enabled ? "停用" : "启用"}“${row.name}”？`}
                          description={
                            row.enabled
                              ? "停用后不可新选，历史记录保留。"
                              : undefined
                          }
                          onConfirm={async () => {
                            try {
                              await api(`${base}/${row.id}`, "PATCH", {
                                version: row.version,
                                enabled: !row.enabled,
                              });
                              changed();
                              message.success("操作成功");
                            } catch (error) {
                              fail(error);
                            }
                          }}
                        >
                          <Button type="link" size="small">
                            {row.enabled ? "停用" : "启用"}
                          </Button>
                        </Popconfirm>
                      )}
                      {allowed("delete") && (
                        <Popconfirm
                          title="确认删除字典项？已引用的请停用。"
                          onConfirm={async () => {
                            try {
                              await api(base + "/" + row.id, "DELETE", {
                                version: row.version,
                              });
                              changed();
                              message.success("删除成功");
                            } catch (error) {
                              fail(error);
                            }
                          }}
                        >
                          <Button type="link" size="small" danger>
                            删除
                          </Button>
                        </Popconfirm>
                      )}
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Modal
        title={editing?.id ? "编辑字典项" : "新增字典项"}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={save}
        confirmLoading={busy}
        destroyOnHidden
      >
        <Form
          form={form}
          onValuesChange={(changed) => {
            if ("color" in changed) setColorPicked(true);
            else if (!editing?.id && !colorPicked && "name" in changed)
              form.setFieldValue(
                "color",
                dictionaryColor(kind, "", changed.name || ""),
              );
          }}
          layout="horizontal"
          labelCol={{ span: 5 }}
          wrapperCol={{ span: 19 }}
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, whitespace: true, message: "请输入名称" },
            ]}
          >
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item name="color" label="颜色">
            <Select options={colorOptions} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
