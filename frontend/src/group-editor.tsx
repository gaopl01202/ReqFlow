import { useEffect, useState } from "react";
import {
  App,
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  Space,
  Spin,
  Typography,
} from "antd";
import { SaveOutlined } from "@ant-design/icons";
import catalog from "../../backend/core/menu-catalog.json";
import actions from "../../backend/core/action-catalog.json";
import { api, type Row } from "./api";
const keys = catalog.flatMap((section) =>
  section.items.map((item) => item.key),
);
export function GroupEditor({
  id,
  onClose,
  onSaved,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [record, setRecord] = useState<Row | null>(id ? null : {});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selected: string[] = Form.useWatch("menu_permissions", form) || [];
  const selectedActions: string[] =
    Form.useWatch("action_permissions", form) || [];
  useEffect(() => {
    let active = true;
    setRecord(id ? null : {});
    setError("");
    (id
      ? api(`user-groups/${id}`)
      : Promise.resolve({
          name: "",
          menu_permissions: ["home", "projects"],
          action_permissions: [],
        })
    )
      .then((row) => {
        if (!active) return;
        setRecord(row);
        // Legacy groups have no menu overrides; preserve the effective prior menu set.
        form.setFieldsValue({
          name: row.name,
          action_permissions: (
            row.action_permissions ??
            row.effective_action_permissions ??
            []
          ).filter(
            (key: string) =>
              !row.menu_permissions ||
              row.menu_permissions.includes(key.split(":")[0]),
          ),
          menu_permissions:
            row.menu_permissions ??
            keys
              .slice(0, row.builtin && row.name === "系统管理员" ? 15 : 10)
              .filter(
                (key) =>
                  key !== "reports" ||
                  row.permissions?.includes("view_reports"),
              ),
        });
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [id, form]);
  async function save() {
    try {
      const values = await form.validateFields();
      setBusy(true);
      await api(`user-groups${id ? `/${id}` : ""}`, id ? "PATCH" : "POST", {
        ...values,
        ...(id ? { version: record?.version } : {}),
      });
      message.success("用户组已保存");
      onSaved();
    } catch (error: any) {
      if (error.message) {
        message.error(error.message);
        if (error.code === "CONFLICT")
          setError(
            "用户组已被其他人修改，请刷新后重新编辑。当前输入尚未提交。",
          );
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="group-editor-page">
      {error && <Alert type="error" showIcon title={error} />}
      {!record ? (
        error ? (
          <Empty description="无法加载用户组" />
        ) : (
          <Spin />
        )
      ) : (
        <Form form={form} layout="vertical" className="group-editor-form">
          <Card title="基本信息">
            <Form.Item
              name="name"
              label="用户组名称"
              rules={[
                {
                  required: true,
                  whitespace: true,
                  message: "请输入用户组名称",
                },
                { max: 50, message: "最多50字" },
              ]}
            >
              <Input
                disabled={!!record.builtin}
                placeholder="请输入用户组名称"
                maxLength={50}
                style={{ maxWidth: 520 }}
              />
            </Form.Item>
          </Card>
          <Card
            title="菜单与操作权限"
            extra={
              <Checkbox
                checked={selected.length === keys.length}
                indeterminate={
                  selected.length > 0 && selected.length < keys.length
                }
                onChange={(event) =>
                  form.setFieldsValue({
                    menu_permissions: event.target.checked ? keys : [],
                    action_permissions: event.target.checked
                      ? selectedActions
                      : [],
                  })
                }
              >
                全部菜单
              </Checkbox>
            }
          >
            <Typography.Paragraph type="secondary">
              勾选菜单授予查看权限，再选择允许的操作；可逐项授权或按菜单全选。项目管理员、创建人及只读角色等业务限制仍然生效，系统管理员始终拥有全部权限。运行日志授权后可查看全系统操作摘要。
            </Typography.Paragraph>
            <Form.Item name="action_permissions" hidden>
              <Input />
            </Form.Item>
            <Form.Item name="menu_permissions" noStyle>
              <MenuPicker
                actionsValue={selectedActions}
                onActionsChange={(value) =>
                  form.setFieldValue("action_permissions", value)
                }
              />
            </Form.Item>
          </Card>
          <div className="group-editor-footer">
            <Space>
              <Button
                type="primary"
                aria-label="保存"
                icon={<SaveOutlined />}
                loading={busy}
                onClick={save}
              >
                保存
              </Button>
              <Button disabled={busy} onClick={onClose}>
                取消
              </Button>
            </Space>
            <Typography.Text type="secondary">
              已选择 {selected.length} / {keys.length} 个菜单，
              {selectedActions.length} 项操作
            </Typography.Text>
          </div>
        </Form>
      )}
    </section>
  );
}
function MenuPicker({
  value = [],
  onChange,
  actionsValue,
  onActionsChange,
}: {
  value?: string[];
  onChange?: (value: string[]) => void;
  actionsValue: string[];
  onActionsChange: (value: string[]) => void;
}) {
  const updateMenus = (next: string[]) => {
    onChange?.(next);
    onActionsChange(
      actionsValue.filter((key) => next.includes(key.split(":")[0])),
    );
  };
  return (
    <div className="permission-matrix">
      {catalog.map((section) => {
        const sectionKeys = section.items.map((item) => item.key);
        const count = sectionKeys.filter((key) => value.includes(key)).length;
        return (
          <section key={section.title}>
            <div className="permission-matrix-heading">
              <Checkbox
                checked={count === sectionKeys.length}
                indeterminate={count > 0 && count < sectionKeys.length}
                onChange={(event) =>
                  updateMenus([
                    ...value.filter((key) => !sectionKeys.includes(key)),
                    ...(event.target.checked ? sectionKeys : []),
                  ])
                }
              >
                {section.title}
              </Checkbox>
              <Typography.Text type="secondary">
                {count} / {sectionKeys.length} 个菜单
              </Typography.Text>
            </div>
            {section.items.map((item) => {
              const choices =
                (actions as Record<string, string[][]>)[item.key] || [];
              const codes = choices.map(([code]) => `${item.key}:${code}`);
              const checked = value.includes(item.key);
              const selected = codes.filter((code) =>
                actionsValue.includes(code),
              );
              return (
                <div className="permission-matrix-row" key={item.key}>
                  <Checkbox
                    checked={checked}
                    onChange={(event) =>
                      updateMenus(
                        event.target.checked
                          ? [...value, item.key]
                          : value.filter((key) => key !== item.key),
                      )
                    }
                  >
                    {item.label}
                  </Checkbox>
                  <div className="permission-matrix-actions">
                    {choices.length ? (
                      <>
                        <Checkbox
                          disabled={!checked}
                          checked={selected.length === codes.length}
                          indeterminate={
                            selected.length > 0 &&
                            selected.length < codes.length
                          }
                          onChange={(event) =>
                            onActionsChange([
                              ...actionsValue.filter(
                                (code) => !codes.includes(code),
                              ),
                              ...(event.target.checked ? codes : []),
                            ])
                          }
                        >
                          全部操作
                        </Checkbox>
                        <Checkbox.Group
                          disabled={!checked}
                          value={selected}
                          options={choices.map(([code, label]) => ({
                            value: `${item.key}:${code}`,
                            label,
                          }))}
                          onChange={(next) =>
                            onActionsChange([
                              ...actionsValue.filter(
                                (code) => !codes.includes(code),
                              ),
                              ...next,
                            ])
                          }
                        />
                      </>
                    ) : (
                      <Typography.Text type="secondary">
                        仅查看页面
                      </Typography.Text>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
