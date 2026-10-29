import { workflowColor } from "./semantic-colors";
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
import { HolderOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { api, type Row } from "./api";
import { COLORS, colorOptions } from "./ui";
const kinds = [
  ["requirement", "需求"],
  ["task", "任务"],
  ["bug", "缺陷"],
];
const stateTypes = [
  { value: "initial", label: "初始" },
  { value: "pending", label: "未完成" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];
export function WorkflowManager({
  projectId,
  canManage,
  onSaved,
}: {
  projectId?: string;
  canManage: boolean;
  onSaved: () => void;
}) {
  const { message, modal } = App.useApp();
  const [kind, setKind] = useState("requirement");
  const [record, setRecord] = useState<Row | null>(null);
  const [working, setWorking] = useState<Row>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [colorPicked, setColorPicked] = useState(false);
  const path = projectId
    ? `projects/${projectId}/workflow`
    : "workflow-template";
  const fail = (error: any) => message.error(error.message || "操作失败");
  useEffect(() => {
    let active = true;
    api(path)
      .then((data) => {
        if (active) {
          setRecord(data);
          setWorking(structuredClone(data.workflow));
          setDirty(false);
        }
      })
      .catch(fail);
    return () => {
      active = false;
    };
  }, [path]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const states: Row[] = [...(working[kind]?.states || [])].sort(
    (a, b) => a.order - b.order,
  );
  function change(next: Row) {
    setWorking(next);
    setDirty(true);
  }
  function nextStates(code: string, selected: string[]) {
    const next = structuredClone(working);
    next[kind].transitions = [
      ...next[kind].transitions.filter((edge: Row) => edge.from !== code),
      ...selected.map((to) => ({ from: code, to, enabled: true })),
    ];
    change(next);
  }
  function move(source: string, target: string, after = false) {
    if (!canManage || source === target) return;
    const list = [...states];
    const row = list.find((state) => state.code === source);
    if (!row) return;
    list.splice(list.indexOf(row), 1);
    list.splice(
      list.findIndex((state) => state.code === target) + (after ? 1 : 0),
      0,
      row,
    );
    const next = structuredClone(working);
    next[kind].states = list.map((state, index) => ({
      ...state,
      order: index,
    }));
    change(next);
  }
  function open(row?: Row) {
    const value = row || {
      code: "s_" + crypto.randomUUID().replaceAll("-", "").slice(0, 16),
      name: "",
      color: workflowColor(kind),
      category: "pending",
      initial: false,
    };
    setEditing(value);
    setColorPicked(false);
    form.setFieldsValue({
      ...value,
      state_type: value.initial ? "initial" : value.category,
      next: working[kind].transitions
        .filter((edge: Row) => edge.from === value.code && edge.enabled)
        .map((edge: Row) => edge.to),
    });
  }
  async function apply() {
    try {
      const values = await form.validateFields();
      const next = structuredClone(working);
      const list = next[kind].states as Row[];
      if (
        list.some(
          (state) =>
            state.code !== editing!.code && state.name === values.name.trim(),
        )
      ) {
        message.error("状态名称不能重复");
        return;
      }
      if (values.state_type === "initial")
        list.forEach((state) => (state.initial = false));
      const index = list.findIndex((state) => state.code === editing!.code);
      const state = {
        ...editing,
        ...values,
        initial: values.state_type === "initial",
        category:
          values.state_type === "initial" ? "pending" : values.state_type,
        name: values.name.trim(),
        order: index < 0 ? list.length : list[index].order,
      };
      delete state.next;
      delete state.state_type;
      if (index < 0) list.push(state);
      else list[index] = state;
      next[kind].transitions = [
        ...next[kind].transitions.filter(
          (edge: Row) => edge.from !== state.code,
        ),
        ...values.next.map((to: string) => ({
          from: state.code,
          to,
          enabled: true,
        })),
      ];
      change(next);
      setEditing(null);
    } catch {
      /* Validation messages are shown next to form fields. */
    }
  }
  function remove(row: Row) {
    const next = structuredClone(working);
    next[kind].states = next[kind].states
      .filter((state: Row) => state.code !== row.code)
      .map((state: Row, index: number) => ({ ...state, order: index }));
    next[kind].transitions = next[kind].transitions.filter(
      (edge: Row) => edge.from !== row.code && edge.to !== row.code,
    );
    change(next);
  }
  async function save() {
    if (!record || busy) return;
    setBusy(true);
    try {
      const result = await api(path, "PATCH", {
        version: record.version,
        workflow: working,
      });
      setRecord(result);
      setWorking(structuredClone(result.workflow));
      setDirty(false);
      onSaved();
      message.success("工作流已保存");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    if (!record) return;
    modal.confirm({
      title: "放弃未保存的修改？",
      onOk: () => {
        setWorking(structuredClone(record.workflow));
        setDirty(false);
      },
    });
  }
  return (
    <Card className="workflow-manager" loading={!record}>
      <Tabs
        activeKey={kind}
        onChange={setKind}
        items={kinds.map(([key, label]) => ({ key, label }))}
        tabBarExtraContent={
          canManage && (
            <Space>
              {dirty && <Button onClick={reset}>撤销修改</Button>}
              <Button
                aria-label="新建状态"
                icon={<PlusOutlined />}
                onClick={() => open()}
                disabled={!record || busy}
              >
                新建状态
              </Button>
              <Button
                type="primary"
                aria-label="保存"
                icon={<SaveOutlined />}
                onClick={save}
                loading={busy}
                disabled={!dirty}
              >
                保存
              </Button>
            </Space>
          )
        }
      />
      <Table
        size="small"
        rowKey="code"
        dataSource={states}
        pagination={false}
        scroll={{ x: 1080 }}
        onRow={(row) => ({
          onDragOver: (event) => {
            if (canManage) event.preventDefault();
          },
          onDrop: () => {
            if (dragged) move(dragged, row.code);
            setDragged(null);
          },
        })}
        columns={[
          ...(canManage
            ? [
                {
                  title: "",
                  width: 36,
                  render: (_: unknown, row: Row) => (
                    <span
                      className="sort-handle"
                      role="button"
                      tabIndex={0}
                      draggable
                      aria-label={`拖动状态 ${row.name}`}
                      onDragStart={(event) => {
                        setDragged(row.code);
                        event.dataTransfer.setData("text/plain", row.code);
                      }}
                      onDragEnd={() => setDragged(null)}
                      onKeyDown={(event) => {
                        if (!["ArrowUp", "ArrowDown"].includes(event.key))
                          return;
                        event.preventDefault();
                        const index = states.findIndex(
                          (state) => state.code === row.code,
                        );
                        const target =
                          states[index + (event.key === "ArrowUp" ? -1 : 1)];
                        if (target)
                          move(
                            row.code,
                            target.code,
                            event.key === "ArrowDown",
                          );
                      }}
                    >
                      <HolderOutlined />
                    </span>
                  ),
                },
              ]
            : []),
          {
            title: "状态名称",
            dataIndex: "name",
            width: 165,
            render: (name: string, row: Row) => (
              <Tag color={row.color}>{name}</Tag>
            ),
          },
          {
            title: "颜色",
            dataIndex: "color",
            width: 90,
            render: (value: string) => (
              <Tag color={value}>
                {COLORS.find((item) => item.value === value)?.name || "默认"}
              </Tag>
            ),
          },
          {
            title: "状态类型",
            width: 100,
            render: (_: unknown, row: Row) =>
              row.initial ? (
                <Tag color="blue">初始</Tag>
              ) : (
                stateTypes.find((item) => item.value === row.category)?.label
              ),
          },
          {
            title: "下一流转状态",
            render: (_: unknown, row: Row) => (
              <Select
                mode="multiple"
                showSearch
                filterOption={(input, option) =>
                  String(option?.searchText || "")
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
                aria-label={`下一流转状态 ${row.name}`}
                style={{ width: "100%" }}
                disabled={!canManage || busy}
                placeholder="选择可流转到的状态"
                options={states
                  .filter((state) => state.code !== row.code)
                  .map((state) => ({
                    value: state.code,
                    label: state.name,
                    searchText: state.name,
                  }))}
                value={(working[kind]?.transitions || [])
                  .filter((edge: Row) => edge.from === row.code && edge.enabled)
                  .map((edge: Row) => edge.to)}
                onChange={(selected) => nextStates(row.code, selected)}
              />
            ),
          },
          ...(canManage
            ? [
                {
                  title: "操作",
                  align: "right" as const,
                  className: "table-actions-cell",
                  width: 110,
                  fixed: "right" as const,
                  render: (_: unknown, row: Row) => (
                    <Space>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => open(row)}
                      >
                        编辑
                      </Button>
                      <Popconfirm
                        title="删除此状态及相关流转路径？"
                        description="已被工作项使用的状态无法删除。修改后需保存。"
                        onConfirm={() => remove(row)}
                      >
                        <Button type="link" size="small" danger>
                          删除
                        </Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Modal
        title={
          editing && states.some((state) => state.code === editing.code)
            ? "编辑状态"
            : "新建状态"
        }
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={apply}
        okText="确定"
        destroyOnHidden
      >
        <Form
          form={form}
          onValuesChange={(changed) => {
            if ("color" in changed) setColorPicked(true);
            else if (
              !colorPicked &&
              editing &&
              !states.some((state) => state.code === editing.code)
            ) {
              const values = form.getFieldsValue();
              form.setFieldValue(
                "color",
                workflowColor(
                  kind,
                  "",
                  values.state_type === "initial"
                    ? "pending"
                    : values.state_type,
                  values.name || "",
                  values.state_type === "initial",
                ),
              );
            }
          }}
          layout="horizontal"
          labelCol={{ span: 6 }}
          wrapperCol={{ span: 18 }}
        >
          <Form.Item
            name="name"
            label="状态名称"
            rules={[
              { required: true, whitespace: true, message: "请输入状态名称" },
            ]}
          >
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item name="color" label="颜色" rules={[{ required: true }]}>
            <Select options={colorOptions} />
          </Form.Item>
          <Form.Item
            name="state_type"
            label="状态类型"
            rules={[{ required: true }]}
          >
            <Select options={stateTypes} />
          </Form.Item>
          <Form.Item name="next" label="下一流转状态">
            <Select
              mode="multiple"
              showSearch
              filterOption={(input, option) =>
                String(option?.searchText || "")
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              options={states
                .filter((state) => state.code !== editing?.code)
                .map((state) => ({
                  value: state.code,
                  label: state.name,
                  searchText: state.name,
                }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
