# API 设计基线

> 当前契约基线（2026-10-22）：所有实际路径以 `/api/v1` 为前缀。精确方法、参数和 schema 以 [当前生成的 OpenAPI](openapi.yaml) 及 `backend/config/urls.py`、`backend/core/schema.py` 为准；本文件的接口表是业务导览。工作项看板接口仅兼容保留，前端只提供列表。

业务依据：[业务功能说明](../业务功能说明.md)。运行路径及结构化契约由当前代码生成，不再使用“路径待统一加前缀”的首版设计口径。

## 1. 通用约定

- JSON 使用 UTF-8、`snake_case` 字段；时间为带时区的 ISO 8601 UTC 字符串，日期为 `YYYY-MM-DD`。界面转换为北京时间。
- 列表参数统一：`page`（从 1 起）、`page_size`（默认 20）、`sort`、`q` 及模块筛选；返回 `items`、`total`、`page`、`page_size`。服务端限定最大页大小。
- 新建成功返回 201 与完整对象；修改返回 200；删除返回 204。分页查询返回 200。无权或不存在的项目对象统一返回 404；未登录 401；全局功能无权限 403；字段错误 422；并发冲突 409。
- 错误体：`{ "code": "VALIDATION_ERROR", "message": "可读提示", "fields": { "title": ["不能为空"] }, "request_id": "..." }`。错误码稳定，文案可调整。
- 需要修改的对象返回 `version`；更新/流转/删除请求须提交当前版本。版本过期返回 409 和可读冲突提示；不静默覆盖。
- 软删除对象默认不出现在查询结果。导出与附件下载必须执行与详情一致的权限过滤。

## 2. 认证与用户

| 方法      | 路径                                  | 用途与关键规则                                                   |
| --------- | ------------------------------------- | ---------------------------------------------------------------- |
| POST      | `/auth/login`                         | 账号密码登录；停用或删除用户拒绝。                               |
| POST      | `/auth/logout`                        | 退出并使当前会话失效。                                           |
| GET       | `/auth/me`                            | 当前用户、用户组、全局权限及需改密标志。                         |
| POST      | `/auth/change-password`               | 强制改密只提交新密码；主动改密还需验证旧密码。                   |
| GET/POST  | `/users`                              | 搜索/筛选用户；按users:create授权新建。                                  |
| GET/PATCH | `/users/{id}`                         | 查看/编辑用户；登录账号不可修改。                                |
| POST      | `/users/{id}/activate`、`/deactivate` | 状态变更；检查最后管理员和未完成项移交。                         |
| DELETE    | `/users/{id}`                         | 仅停用用户可软删除。                                             |
| POST      | `/users/{id}/reset-password`          | 二次确认由前端承担；服务端生成一次性临时密码并仅在本次响应返回。 |
| GET/POST  | `/user-groups`                        | 按菜单授权查看，按user-groups:create授权新建。                       |
| GET/PATCH | `/user-groups/{id}`                   | 用户组详情及菜单权限配置；启停状态由独立操作维护。                 |
| GET/POST  | `/positions`                          | 职务列表/新建。                                                  |
| GET/PATCH | `/positions/{id}`                     | 职务详情/编辑；启停状态由独立操作维护。                          |

重置密码响应必须设 `Cache-Control: no-store`，前端只展示一次，不写入浏览器持久存储、日志或埋点。新建用户的初始凭据为一次性临时密码；首次登录强制修改时只需输入新密码。上述路径对管理员操作要执行服务端授权。

用户列表按姓名、登录账号排序。系统管理员账号禁止编辑、停用和删除；仅该账号本人可以调用自己的重置密码接口，其他管理员重置系统管理员密码将返回403。本人重置后，前端在一次性临时密码窗口关闭时退出当前登录，使用新密码重新登录并完成强制改密。

## 3. 项目与成员

| 方法         | 路径                                 | 用途与关键规则                                                                                   |
| ------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| GET/POST     | `/projects`                          | 仅返回可访问项目；创建时校验编码唯一和负责人。                                                   |
| GET/PATCH    | `/projects/{id}`                     | 详情和编辑；返回统计摘要、版本。                                                                 |
| POST         | `/projects/{id}/close`、`/reopen`    | 关闭或开启，记录审计。                                                                           |
| GET/POST     | `/projects/{id}/members`             | 成员列表和添加。                                                                                 |
| PATCH/DELETE | `/projects/{id}/members/{user_id}`   | 改角色/移除；请求含移交方案，事务内检查负责人和最后管理员。                                      |
| POST         | `/projects/{id}/members/bulk`        | `{users:[UUID], role}` 一次添加最多100位成员，逐项执行并返回succeeded/failed及数量。             |
| POST         | `/projects/{id}/members/bulk-delete` | `{items:[{user,version}]}` 批量移除最多100位成员，逐项事务、未完成事项设为未分配，返回逐项结果。 |

移除成员请求示例：`{ "version": 3, "unfinished_items": { "action": "reassign", "new_owner_id": "..." } }`；`action` 可为 `reassign` 或 `unassign`。移交影响的工作项及成员变更须同一事务成功或失败。

## 4. 工作项与协作

| 方法             | 路径                           | 用途与关键规则                                                                                               |
| ---------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| GET/POST         | `/projects/{id}/work-items`    | 跨类型查询/创建；创建体含 `type`。                                                                           |
| GET/PATCH/DELETE | `/work-items/{id}`             | 详情、编辑、软删除。                                                                                         |
| POST             | `/work-items/{id}/transition`  | 提交目标状态、版本及处理人/可选富文本评论；按类型工作流校验，不要求原因。                                   |
| POST             | `/work-items/bulk-update`      | 多项负责人/优先级/迭代修改；逐项结果。                                                                       |
| GET/POST         | `/work-items/{id}/comments`    | 评论列表/添加。                                                                                              |
| PATCH/DELETE     | `/comments/{id}`               | 评论作者或项目管理员按规则操作。                                                                             |
| GET/POST         | `/work-items/{id}/attachments` | GET 仅列出用户上传的文件，不列出正文/评论引用的内联图片；POST 上传文件，限制大小与类型。                    |
| GET/DELETE       | `/attachments/{id}`            | 鉴权下载/删除；不返回公开存储地址。                                                                          |
| GET              | `/work-items/{id}/history`     | 分页读取操作记录。                                                                                           |
| GET              | `/recycle-bin`                 | 汇总当前用户可访问项目中已删除的工作项；增加project_name、deleted_by_name、can_restore。按删除时间倒序分页。 |
| GET              | `/projects/{id}/recycle-bin`   | 查询该项目全部已删除需求、任务、缺陷，删除时间倒序分页；成员可查看，仅项目管理员can_restore为true。                                                                   |
| POST             | `/work-items/{id}/restore`     | 恢复工作项；服务端仅允许对应项目管理员。                                                                     |

工作项PATCH要求用户属于该项目、项目处于进行中且用户组拥有`edit_items`权限；普通项目成员可编辑项目内任意工作项，不再按创建人/处理人限制。删除仅允许创建人或项目管理员，恢复仅允许项目管理员。只读角色即使用户组有写权限也不能编辑。

创建体以 `type = requirement | task | bug` 区分字段：需求含 `source`、`acceptance_criteria`；任务含 `requirement_id`；缺陷含 `steps_to_reproduce`、`actual_result`、`severity`、可选 `requirement_id` 和 `task_id`。所有关联在服务端验证同项目。批量响应：`{ "succeeded": [id], "failed": [{ "id": id, "code": "...", "message": "..." }] }`；单项独立提交。

成员批量接口使用相同的逐项结果外形，响应同时包含`succeeded`、`failed`、`success_count`、`failure_count`；成员序列化增加只读`position_name`。回收站删除人由对应项目的删除审计记录解析；没有可用审计操作者时返回“—”。

## 5. 迭代、看板、文档、通知与报表

| 方法             | 路径                                                                   | 用途与关键规则                                                                                                         |
| ---------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| GET/POST         | `/projects/{id}/iterations`                                            | 列表/新建。                                                                                                            |
| GET/PATCH        | `/iterations/{id}`                                                     | 详情/编辑；已结束不可编辑。                                                                                            |
| POST             | `/iterations/{id}/start`、`/finish`                                    | 开始/结束；结束请求含未完成项处置方式。                                                                                |
| POST/DELETE      | `/iterations/{id}/work-items/{item_id}`                                | 加入/移出未结束迭代。                                                                                                  |
| GET              | `/projects/{id}/board`                                                 | 历史兼容接口；当前前端不提供看板页面。                                                                               |
| GET/POST         | `/projects/{id}/documents`                                             | 当前目录列表及新建文件夹；不再新建 Markdown 正文。                                                                     |
| POST             | `/projects/{id}/documents/import`                                      | 上传单个白名单文件并保存私有原件；预览由浏览器本地完成。                                                              |
| GET/PATCH/DELETE | `/documents/{id}`                                                      | 文档/文件夹详情、历史 Markdown 文档编辑或软删除；导入文件只读。                                                       |
| GET              | `/me/todos`、`/me/dashboard`                                           | 当前用户待办和首页概览。                                                                                               |
| GET/PATCH        | `/me/notifications`、`/notifications/{id}`                             | 通知列表与已读状态。                                                                                                   |
| POST             | `/me/notifications/mark-all-read`                                      | 全部已读。                                                                                                             |
| GET              | `/projects/{id}/reports/overview`、`/iterations/{id}/reports/progress` | 项目与迭代统计。                                                                                                       |
| GET              | `/projects/{id}/reports/members`、`/projects/{id}/reports/bugs`        | 成员工作量与缺陷统计。                                                                                                 |
| GET              | `/projects/{id}/reports/export`                                        | 按筛选条件导出 CSV；table=states/members/bugs分别导出完整状态/成员/缺陷统计表，省略table保持工作项明细兼容；严格鉴权。 |

## 6. 配置接口

`/dictionaries`（默认字典模板；原 `/priorities` 为优先级模板兼容接口）、`/projects/{id}/categories`（项目分类）、`/projects/{id}/workflow`（三类工作项的状态、类别、初始状态及任意允许流转路径）。项目配置读取对可访问项目成员开放；默认字典模板维护需对应功能授权，旧priorities只读兼容接口保留原权限；默认配置写入按功能授权，项目配置写入另需项目管理员。配置写入必须验证至少一个启用优先级、可达完成状态、已引用优先级不可删除、分类删除确认迁移等规则。

## 7. 契约维护

代码实施时使用 DRF 官方文档推荐的 OpenAPI 生成方案（目前为 drf-spectacular），保存可审查的契约文件，并以锁定版本的实际文档为准。业务字段、错误码、权限、状态流转和示例响应变更时，同步更新本文件、生成契约与契约测试。这里是业务 API 基线，未列的纯技术端点（健康检查等）可按运维需要补充。

## 8. 已实现契约细节

当前实际前缀为 `/api/v1`，可审查契约为 `docs/openapi.yaml`；运行时 `/api/v1/schema` 和 `/api/v1/docs` 提供契约与说明。`schema.py` 声明统一命令输入类型，写入前由 DRF 序列化器验证类型与字段，最终业务校验由事务服务执行。

当前外键 JSON 字段名与模型一致（`owner`、`assignee`、`priority`、`category`、`iteration`、`requirement`、`task`、`group`、`position`），值为 UUID；不采用正文示例中的 `_id` 后缀。工作项公共状态为 `status`，类型为 `type`，专属输出字段位于 `details`，专属输入字段位于命令顶层。工作项响应附 `priority_name`、`assignee_name`、`created_by_name`、`status_name`、需求子任务统计及关联需求展示标题。

- `GET /auth/csrf`：取得登录及写请求使用的 CSRF 令牌；`POST /auth/login` 也必须通过 CSRF 校验。
- 取消 `PATCH /auth/profile`，不再提供用户自行修改姓名接口；管理员通过用户管理维护姓名。改密要求 old_password 与 password（至少10位）。
- `GET /directory`：已登录用户添加负责人/成员所需的启用用户 ID 和显示名，不包含账号、组或密码。
- 用户创建与重置响应附 `temporary_password`，设置 `Cache-Control: no-store`。首次登录仅允许身份、退出和改密入口。
- 移交支持 `unfinished_items: {action: unassign}` 或 `{action: reassign, new_owner_id: UUID}`，亦支持 `individual` 与逐项 `items` 映射；成员操作须提交成员 version。负责人转移须先把接替人设为项目管理员。
- 批量输入 `items: [{id, version}]`、`changes: {assignee?, priority?, iteration?}`，最多100项；输出 succeeded、failed、success_count、failure_count。
- 迭代结束使用 `disposition: keep|move`、`target_iteration` 和 `confirm`；日期重叠的保存使用 `confirm_overlap`。成员角色为 admin/member/readonly。
- 文档附件支持 `GET/POST /documents/{id}/attachments`；附件上传使用 multipart 的 file 字段；删除附件须提交 version；下载只输出鉴权流，无公开路径。
- 字典项、分类、职务、用户组的对象路径提供 DELETE，受引用与内置组保护；配置列表通过独立启停操作切换状态，编辑表单不提供启用勾选项。具体操作路径以当前 OpenAPI 为准。
- 报表响应含 total/completed/unfinished/completion_rate/states/members/bugs；空分母为 null。CSV 响应使用中文表头和 UTF-8 BOM，防电子表格公式注入。
- 列表 q/page/page_size/sort 及具体模块筛选已实现；工作项日期过滤 date_from/date_to 为创建日期，due_before 为截止日期上限。报表成员本期完成按 completed_at 筛选，不受创建日期限制。

工作流状态 code 由项目配置维护，不能把默认状态列表当作固定接口枚举；类别为 pending/completed/cancelled，初始状态由配置标记。迭代状态为 planned/active/finished，项目状态为 active/closed。迭代列表及 project context 的 iterations 返回概要字段、owner_name、item_total、item_completed；不返回 items_by_state、overdue_items、recent_changes。`GET /iterations/{id}` 仍返回完整详情。精确字段以当前 OpenAPI 为准。

通知已读操作是单向幂等修改，不要求客户端版本；服务内部只更新未读记录并增长版本。强制改密由已认证会话及 `must_change_password` 标记保护，不要求旧密码；主动修改密码仍验证旧密码。工作项 PATCH 允许有项目写权限的成员编辑该项目全部工作项；删除仅限创建人或项目管理员。错误响应与请求关联 request ID；日志不得记录密码或附件内容。

## 9. 职务与优先级拖动排序（C-04、C-05）

- `POST /positions/reorder`、`POST /priorities/reorder`：需要对应菜单的reorder授权；请求 `{item_id, version, target_id, target_version, placement}`，placement 为 before/after。源行和目标行必须属于该配置类型且未删除；旧版本返回409，全项事务回滚。
- 服务锁定配置集合，按稳定全局顺序移动源行到目标前后，更新受影响行的内部 sort_order、version、更新时间及审计。请求只表达相对位置，因此支持分页列表，不接收不完整的全量顺序覆盖。
- 两类列表和下拉选项默认按 sort_order/created_at/id 排序；新建追加末尾。两类新建和编辑命令不再接受 sort_order（传入返回422），输出中的 sort_order 为只读内部值；项目分类接口也不再接受 sort_order，由项目内拖动维护。
- 排序响应为配置列表分页结构，前端保存后重新获取当前页及选项；失败时保持已有顺序并重新读取服务器数据。

数据库结构不变，无新迁移。OpenAPI 与前端生成类型已同步。

## 10. 分类排序与界面接口同步

`POST /projects/{id}/categories/reorder` 沿用 Reorder 命令 `{item_id, version, target_id, target_version, placement}`；仅该项目管理员且项目进行中可操作，源行与目标行必须属于此项目。锁定项目及该项目分类集合，排序和审计同一事务提交；过期/无效目标409，无权限拒绝。分类默认列表按内部 sort_order/created_at/id 返回，新建追加本项目末尾；新建/编辑传 sort_order 返回422，响应字段为只读内部值。

独立工作项页面继续复用既有工作项查询/编辑/流转/评论/附件/历史接口，无新增业务状态或权限。优先级颜色继续使用已有 color 枚举与返回的 priority_color，不新增颜色字段或迁移。工作流拖动仍通过原 workflow 命令保存 states.order，并保留预设状态、路径及可达性校验。OpenAPI 与前端生成类型同步移除 profile 并增加分类排序端点。

### 工作项/文档与附件一并保存（UI-07/08）

创建项目工作项/文档的 POST 和 `/work-items/{id}`、`/documents/{id}` 的 PATCH 除原 JSON 外支持 multipart/form-data：`payload` 为原命令字段的 JSON 字符串，附加 `upload_tokens` 数组（最多20，唯一且格式 `reqflow-upload:UUID`）；`files` 为顺序对应的重复文件字段。正文图片引用该 token，保存后替换为 `/api/v1/attachments/{id}?inline=1`。普通附件也使用 token 对应文件，但不必在正文引用。版本与业务校验、附件限制与权限保持一致；任一失败回滚记录、附件行、审计并清理已写文件；缺失图片 token 拒绝保存。无文件的 JSON 请求保持兼容。

`GET /attachments/{id}?inline=1` 对 png/jpg/jpeg 返回 inline 图片流，仍检查当前用户项目范围、附件和父记录未删除；其余类型保持下载，不允许 HTML/SVG 内嵌；响应 nosniff。前端只渲染此鉴权路径的正文图片。上传失败遵循统一错误格式，不记录正文与文件内容。

### 默认字段与合并流转（UI-10～12）

所有类型工作项创建时 description 可省略/为空；priority 省略或为 null 时服务默认选择启用“中”，若不存在则选择首个启用配置，无启用配置时校验失败。编辑显式提交 priority:null 同样回到默认优先级；未提交则保持原值。title 仍必填；缺陷复现步骤/实际结果不再必填，相关旧字段只为历史兼容保留。

既有 `POST /work-items/{id}/transition` 根据当前 `WorkflowCommand` 提交目标状态、版本、处理人集合和可选评论；不接受原因、通知成员或关联任务确认参数。只允许当前工作流中已配置的路径，处理人需为本项目启用且可写成员。状态、处理人、可选非空评论、附件和审计在同一事务内提交，任一失败全部回滚。处理人漏选由前端提交时提示，服务端仍强制校验至少一人。`POST /work-items/{id}/transition` 的 `reactivate` 标志用于无下一流转状态时恢复到其他未完成状态，仍进行版本、权限和处理人校验。

UI-14 只调整客户端选取和调度，无新接口/字段：新建与编辑先排除超限文件，再通过既有 multipart 原子保存；详情多选后逐个提交 `/work-items/{id}/attachments` 的 file，每个请求独立事务，失败不撤销其他成功文件。服务端继续逐文件强制校验大小/类型和权限，不能依赖客户端筛选。

## UI-15～17 契约增量

WorkItem 增加 handlers UUID 数组、handler_names 名称数组；assignee 保留为兼容的首位处理人，assignee_name 返回全部处理人名称。创建/编辑支持 handlers；旧 assignee 单人写入会替换集合。流转使用 version、target_status、handlers（至少一位，最多100位且不重复）、可选 Markdown body；未显式传 handlers 的旧客户端可沿用已有非空集合/assignee。原因及子任务确认不再阻断流转，前端不提供 reason/mentions/confirm；旧 mentions 接口校验暂保留兼容。

`GET /auth/me` 返回 `attachment_max_bytes` 与 `attachment_extensions`，当前默认上限10 MiB。工作项附件格式包括项目文档当前全部21种导入格式，以及常见压缩包、图片、视频/音频、XMind、draw.io/Excalidraw/Mermaid/PlantUML；精确清单见 [attachment-formats.md](attachment-formats.md)。服务端通过 `ATTACHMENT_EXTENSIONS` 环境变量覆盖默认列表。项目文档导入白名单独立，不随工作项附件扩展改变。

评论返回 author_name、workflow_status、workflow_status_name（创建时快照、编辑不改）。POST /work-items/{id}/comments、PATCH /comments/{id} 和 POST /work-items/{id}/transition 支持与工作项相同的 multipart payload/upload_tokens/files，图片私有鉴权、原子提交；无图仍可 JSON。评论通知去重键按评论 ID 和版本生成，保证同一工作项连续评论可提交。附件响应增加 uploaded_by_name。现有列表 assignee 筛选、待办、导出、权限、成员工作量及提醒包含全部处理人，项目总计按工作项去重。

UI-19：GET /work-items/{id}/comments 固定 order_by(-created_at,-id)，不随更新日期或 sort 参数改变；确保新评论在最上方，编辑旧评论不顶置。响应字段、权限和写入契约不变。

UI-23：分页列表客户端显式传 page_size=20|50|100 与 page；复用既有参数及服务端上限100，不新增契约字段。切换条数回到 page=1，total 与返回 items 仍由服务端决定。

UI-25 正文格式补充：既有描述、文档及评论 Markdown 字符串可以包含颜色 span（style="color: #RRGGBB"），前端阅读时按安全白名单过滤；请求路径、字段、权限及大小限制不变，无迁移。

## 项目文档原件与预览（D-03/UI-26，现行规则见 UI-37/UI-46）

- `POST /projects/{id}/documents/import` 接收单个 multipart 文件；默认 10 MiB，实际扩展名白名单见 [document-formats.md](document-formats.md)。空文件、超限、格式/基础容器校验失败均拒绝；服务端保存私有原件，不做转换。
- 当前新建入口只创建文件夹或上传原件；历史 Markdown 文档仍可编辑。导入的 Markdown、Office、PDF、XMind、图片和文本文件为只读原件。
- `GET /documents/{id}/preview` 通过鉴权响应原件字节；`GET /documents/{id}/download` 下载原件。两者检查相同项目访问权限，不暴露存储路径。删除记录或失去项目访问权后不可读取。
- 文档预览由浏览器中的 File Viewer 3.2.2 按需渲染，使用本地组件资产，无后端转换或第三方预览请求。格式清单代表尝试预览范围，复杂、损坏或加密文件可能无法渲染，仍可下载原件。

工作项附件列表只返回独立上传文件。通过工作项/评论富文本 multipart 保存且被正文引用的图片会在 `Attachment.is_inline_image` 持久标记；正文后续编辑移除图片时，仍不会出现在附件列表。读取时仍兼容检查描述与有效评论中的 `?inline=1` 引用。图片内容继续走原有鉴权接口。该字段仅为内部分类，不增加附件响应字段。

UI-27：preview端点对旧记录同样读取source_file，不读取历史preview_file。只读和访问范围不变；没有新增接口字段，删除转换相关503错误。未支持的前端格式可通过download读取原件。

### UI-37 File Viewer格式扩展

接口及权限不变：metadata.document_extensions来自core/document_formats.json（锁定3.2.2 按需清单、21项），不再局限13种Office/TXT格式。仍只接收单文件，10MB，返回原件信息、preview_url/download_url。仅接受已确认的Office/PDF/XMind/图片/文本21种格式；移除的格式返回原有类型不支持错误，已有记录下载不受影响。XMind等按此白名单导入，ZIP类继续校验解压体积、条目数和加密位；常见Office检查对应结构。所有preview仍原件字节、鉴权、nosniff，无后端转换。导入失败不会留下业务记录。

## D-04 / UI-46：文档文件夹与上传目录

- GET /projects/{id}/documents：parent可选UUID，省略为根目录；只列当前目录，文件夹优先；响应增加ancestors（从根下级至当前目录的{id,title}），Document响应新增parent（可空UUID）。无权/已删除/非文件夹/跨项目目录404。
- POST /projects/{id}/documents：仅新建文件夹，JSON为{document_type:"folder",title,parent?:UUID|null}；201。旧title/body新建文档请求422，已有Markdown PATCH编辑不变。非空/路径名/同目录重名422；写权限不满足403。
- POST /projects/{id}/documents/import：既有路径保留，界面改称上传，multipart增加parent可选UUID。仍为10MB/21格式，201，原件字节下载/预览不变。
- DELETE /documents/{id}：继续版本号并发检查、管理员权限和软删除；非空文件夹422，冲突409，权限403。
- 文件夹download_url/preview_url为空，不生成原件；禁止给文件夹上传附件或编辑正文。无批量/移动/重命名接口。OpenAPI和生成类型同步更新。

## UI-47：默认分类筛选

GET /projects/{id}/work-items 的category可为分类UUID或字符串none；none表示category IS NULL（页面“默认分类”），省略表示全部分类。仍与type/搜索/其他筛选组合，分页总数使用过滤后的集合；权限/项目范围不变。OpenAPI查询参数同步为字符串并说明none。没有新增分类记录或数据字段；既有board接口保留兼容，但前端无看板入口。

### UI-50 分类删除确认

`DELETE /projects/{id}/categories/{id}` 传入 `version`。无引用直接删除；有引用且未传 `confirm: true` 返回 HTTP 409、`CATEGORY_MOVE_CONFIRMATION_REQUIRED`、消息“删除后都将移动到默认分类”。确认后同一路径传原版本及 `confirm: true`，事务内锁定项目、分类和关联工作项，将分类置 NULL、逐项增加版本并记录审计，再软删除分类，返回204。跨项目、非管理员、关闭项目和旧版本均保持拒绝。新增/修改继续使用 POST/PATCH，侧栏沿用现有接口。

### C-04 / UI-51 字典接口

- 默认模板：`GET/POST /dictionaries`，`GET/PATCH/DELETE /dictionaries/{id}`，`POST /dictionaries/reorder`，写入需对应功能授权。
- 项目字典：相同操作位于 `/projects/{id}/dictionaries`，读取遵循项目可见性，写入/排序需活动项目管理员及管理权限。
- 列表查询 `kind=environment|severity|priority|source`（默认priority），使用标准分页；创建传kind/name/color/enabled；修改和删除传version，修改不更换kind/code；排序传kind及既有item_id/version/target_id/target_version/placement契约。code由服务生成，项目复制模板时保留code，ID独立生成。
- 所有记录返回id/project（null为模板）/kind/code/name/color/enabled/sort_order/version及时间戳；同作用域、同类型名称/代码对未删除项唯一。引用项DELETE返回422，最后启用优先级停用/删除返回422，越权403或404，旧版本409。
- 工作项priority必须为本项目priority字典ID；需求source和缺陷severity/environment使用本项目对应字典code，拒绝无效/停用的新值。省略默认值由服务按项目字典解析。原值未变时可保留停用值。旧复现字段不再必填，历史字段保留兼容。
- 创建项目在同一事务复制当前模板，模板和项目后续互不覆盖；历史项目通过0007迁移。

### C-05 / UI-52 默认及项目工作流

`GET/PATCH /workflow-template` 分别需要菜单查看和workflow-template:configure授权；GET返回workflow/version，首次安装由0008创建默认模板。`GET/PATCH /projects/{id}/workflow` 读取需项目可见，写入需活动项目管理员及管理权限；系统管理员沿用管理权限。项目创建时事务复制模板，后续独立。

PATCH传version与完整workflow（requirement/task/bug三组）。每组states列表含code/name/color/order/category/initial：code为稳定小写字母开头的字母数字下划线字符串（最多30字符），客户端新建生成，界面不展示；category为pending/completed/cancelled；initial为布尔值。每组transitions含from/to/enabled，允许任意同类型不同状态之间连线。已有旧配置读取补齐category/initial，旧请求未传这两个字段时按原内置码兼容补齐。

保存验证三类完整、状态2～100个、名称/码/顺序不重复、唯一pending初始、至少一个completed且从初始可达、目标有效及无自环/重复边。引用中或回收站状态禁止删除及更改类别；未引用状态可删除且须提交清理后的路径。失败422，权限403/404、版本冲突409。所有三类配置和审计同一事务。项目PATCH仍返回Project对象含workflow/version，模板PATCH返回workflow/version。

WorkItem响应增加只读status_category及status_color；新建使用配置initial而非数组顺序。流转只按保存路径验证，并将状态类别同步至status_category；完成时间、待办、迭代进度、提醒和报表按类别处理，不依赖内部状态码。已取消类别不纳入完成率分母。旧字段/历史评论状态名称继续保留。

UI-52回归修复：缺陷steps_to_reproduce/actual_result两个历史兼容字段接受空字符串，保证不填写这些字段的新缺陷可完整编辑，模型与输入契约的可空白语义一致。

### UI-53 合并工作流状态类型

UI-53仅合并页面展示，API仍用category及initial保存：初始映射pending+true，其他三项映射各自category+false；无需接口契约变更。

### UI-54 语义配色与工作流菜单

UI-54无路径或字段变化。创建字典项未传color时，服务按kind/code/name建议颜色；显式color优先，编辑省略color保留原色。默认工作流颜色按状态语义初始化，现有status_color/priority_color及项目字典/工作流读取提供展示颜色。权限及状态图规则不变。

UI-55：项目成员列表q按成员账号/姓名匹配；通知列表q按通知内容匹配，仍在原有权限范围内筛选。其他页面查询字段保持不变。

### DEV-01 模拟场景工具

本次无API变更。seed_demo管理命令复用现有用户、项目、配置、工作项、流转、评论、附件及文档服务；模拟数据遵循原权限/版本/状态校验。

DEV-01读取优化：工作项列表及迭代内逾期项通过core/querysets.py统一预加载关联人与类型详情，子任务完成数用相关子查询统计，避免逐行查询。既有权限筛选及响应字段保持不变；服务层写入仍使用即时读取，避免旧缓存影响审计。

### UI-56 重新激活

POST /api/v1/work-items/{id}/transition新增可选reactivate:boolean（默认false）。true时仅允许当前状态无启用出边，target_status必须为同项目同类型其他pending状态；version、handlers及body/图片上传沿用现有流转契约及权限。失败不产生部分写入；成功清空完成时间，审计action=reactivate，返回仍为既有工作项响应。普通流转仍严格校验已配置边。

### UI-57 报表与启停兼容

项目overview和复用report的迭代统计新增severities数组（code/count，按工作项去重），members每行新增id（未分配为null），其他字段兼容。导出table未知返回422；报表权限、项目访问和导出权限/非只读角色均在服务端复查，q、迭代、类型、状态、负责人、字典及日期筛选与overview共用。states表头类型/状态/数量；members为处理人/未完成/其中逾期/本期完成；bugs为状态/严重程度/处理人/数量，名称使用所属项目配置，文本公式前缀转义。成员本期完成仍按completed_at日期口径。

启停不增加接口：职务、用户组、项目分类和字典PATCH仅提交version/enabled；普通编辑不提交enabled，新建使用模型默认true。用户沿用activate/deactivate及移交事务。权限码与策略不变，system_settings/manage_users保留兼容但不作为普通组系统菜单授权。

### UI-58 菜单权限、共享上下文与工作台

UserGroup读响应新增menu_permissions（null兼容旧组或字符串数组）；POST/PATCH支持该字段，校验为当前菜单键且不能重复，PATCH须version，需user-groups:edit功能授权；未提交permissions不改变既有值，新建菜单组且未传permissions时采用DEFAULT_PERMISSIONS角色操作基线。auth/me新增有效menu_permissions数组，超级管理员全部，普通显式组按配置，旧null组沿用原菜单范围（报表需view_reports）。功能权限由UI-73的action_permissions独立控制。

显式组由check_menu_route集中校验资源路径，拒绝返回403统一格式。工作项详情/评论/附件可由工作台入口共享，项目切换候选和通知为共享入口；项目切换仍仅返回可访问项目，菜单不是跨项目授权。系统菜单只读授权后可读相应GET，写入仍由admin服务策略拒绝；项目配置写入仍走原manage角色。

GET /projects/{id}/context：受项目访问和至少一项项目/工作台菜单权限校验，返回project、members、iterations、categories、workflow、dictionaries，供表单选项/标签渲染；不因对应列表菜单关闭而失败。GET /workspace/context：有用户/组/职务菜单之一方可读，返回positions/groups的id/name/enabled，供系统页面标签，不返回密码或完整权限。两个接口只读，不改变功能授权。

GET /me/todos新增todo_scope=all（默认）/today/overdue，非法422；按本人未完成、启用且可访问项目、北京时间due_date筛选，再应用原搜索/分页。GET /me/dashboard新增types（type/count）、project_progress（最多6项最近更新项目id/name/member_count/total/completed/unfinished，total不含取消，unfinished为我的待办），原unfinished/due_today/overdue/projects/activity兼容。

UI-58成员上下文与成员列表共用MemberSerializer，均包含display_name；只读字段不参与业务写入，查询预取user避免逐行姓名查询。

### UI-60 通知文案兼容

GET /me/notifications 的 message 为中文事件描述，历史生成的英文事件后缀在序列化时转换，不修改用户标题。q 同时匹配消息内容与中文事件描述。event_type 仍使用原有稳定代码，路径和字段不变；无需迁移。

### UI-64 强制改密

POST /auth/change-password：已认证且must_change_password=true时无需old_password；普通改密仍必需且校验旧密码。两种情况均禁止新密码与当前哈希匹配，保留至少10位要求、事务、审计及会话更新。无新增字段或迁移。

## UI-69 工作项编辑与处理人校验

工作项列表移除编辑入口，详情编辑不再限制创建人或处理人身份；具有项目写权限的成员可编辑所属项目全部工作项。只读角色、用户组写权限、项目关闭及跨项目隔离保持生效。DELETE /work-items/{id}仍仅允许创建人或项目管理员。处理人初次展示不标红，点击确认流转或重新激活时才进行必填校验；缺失时阻止请求并提示，服务端继续拒绝空处理人。无接口字段、数据表或迁移变更。

迭代读取性能优化：GET /projects/{id}/iterations及项目context中的iterations只返回迭代基础字段、owner_name、item_total、item_completed；不返回items_by_state、overdue_items、recent_changes。列表关联负责人一次预加载，工作项数量使用数据库条件聚合，排除软删除工作项，完成数按completed类别统计。GET /iterations/{id}继续提供完整统计、逾期项和最近记录，点击迭代时按需加载。权限及写入规则不变，无数据迁移。


## UI-73 功能权限契约

附件响应新增scope（items/documents），用于预览页选择对应下载授权，不作为服务端授权依据。

UserGroup新增可空JSON数组 `action_permissions`，POST/PATCH可提交功能键列表（如 `users:edit`），必须唯一、存在于 `core/action-catalog.json` 且所属菜单同时选中；非法值返回422。null仅表示旧组兼容，UI保存为明确数组；[]为只读。用户组读响应增加只读 `effective_action_permissions`，用于回显null旧组实际操作。`GET /auth/me`增加有效 `action_permissions` 数组，permissions返回兼容的有效粗权限，前端使用细权限控制按钮。超级管理员返回全部功能键。新字段由0013新增，不改变其他请求格式。

业务写入服务分别校验对应功能键；没有授权返回统一403/FORBIDDEN，批量操作保留逐项结果，批量入口本身未授权直接403。字典混合修改enabled和其他字段同时要求toggle与edit，不能通过edit绕过启停授权。用户管理普通账号可按create/edit/toggle/reset_password/delete授权维护，但不能授予系统管理员身份或维护系统管理员账号；用户组授权者不能改内置系统管理员组或旧permissions码。项目写入同时保持项目角色、归属、版本、状态等校验。

`GET /attachments/{id}`为正式下载，按所属工作项/文档的download权限鉴权；`?preview=1`为线上预览原件读取，`?inline=1`为正文图片读取，继续按项目范围与菜单权限鉴权。文档原件download接口需documents:download，preview接口为已有查看权限。预览读取数据可被浏览器保存，下载授权控制产品下载入口，不构成DRM。


## UI-74 会话与分享路径契约

- `POST /auth/activity`：已认证且未过期的实际操作续期，需CSRF；返回session_expires_at（Unix秒）与session_remaining_seconds，将会话与Cookie过期时间续至当前操作后7天，不设置绝对上限。GET请求不更新活动时间。
- `GET /auth/me`增加session_expires_at、session_remaining_seconds及session_idle_timeout_seconds。真实登录会话有到期值，测试强制认证但未建立Session时可为null。认证相关响应no-store。服务端会话中间件拒绝过期/旧会话，返回401/SESSION_EXPIRED及统一错误结构；Cookie已自然过期或未登录仍为401/UNAUTHENTICATED。旧会话缺少期限元数据时重新登录，不自动升级为永久有效。
- `GET /links/{project_code}/{kind}/{reference}`：kind为requirement/task/bug时reference为该类型编号最后一段正整数；document/iteration时为UUID。先按现有项目及菜单可见范围解析，返回id、project、project_code、type、web_url；匿名401、无菜单403、无项目/已删/无对应记录404。ID定位不授予任何额外操作，后续继续使用原详情及写入接口。
- `GET /attachments/{id}/metadata`：返回现有鉴权附件元信息，用于不在URL放文件名的附件预览，仍校验项目/菜单/父记录未删除；不返回文件内容或公开地址。
- 工作项、文档、迭代响应新增只读web_url。详情URL为前端路径，Nginx按现有SPA回退处理；旧API路径和UUID保持。所有路径分享均非匿名共享。列表迭代/文档读取预加载project，避免生成链接时出现逐行额外项目查询。

配置默认SESSION_IDLE_TIMEOUT_SECONDS=604800，可经部署环境覆盖；已移除SESSION_ABSOLUTE_TIMEOUT_SECONDS，不再执行固定最长登录限制。主动退出注销当前会话，密码重置和账号停用注销账号全部会话。会话开始时间、最后活动时间保存在既有Django Session中，无新增业务表或迁移。账号/组/项目及按钮授权规则不因链接或续期改变。

项目编码重复时统一提示“项目编码已存在，请更换”，包括多人并发创建触发数据库唯一约束的情况；编码唯一性及权限规则不变，无数据库迁移。

## UI-75 运行日志

`GET /operation-logs`：仅系统管理员或显式具有operation-logs菜单权限的用户可读，全系统范围，不按当前项目过滤；未登录401、无权403。方法仅GET/OPTIONS，其他方法405。

筛选参数：q（操作人姓名/账号、对象ID、项目名称/编码，最长200字）、action（操作码）、resource_type（对象码）、date_from/date_to（含边界的YYYY-MM-DD）、page（默认1）、page_size（默认20、1至100）。非法枚举、日期范围或分页422。

响应items、total、page、page_size、actions、resource_types；选项为value/label。每条含字符串id、created_at、actor、actor_name、actor_username、可空project、project_name、action/action_label、resource_type/resource_label、resource_id；不返回业务快照或请求内容。按时间倒序、ID倒序稳定分页。权限来自共享菜单目录，无可写功能权限；旧组不会自动取得日志查看权。

UI-79复制为前端预填流程：copy_from仅出现在新建页面URL，来源仍使用GET /work-items/{id}及鉴权附件元数据/preview读取；后续POST /projects/{id}/work-items与原multipart上传契约不变。无匿名克隆、直接复制或绕过权限的新接口；新记录编号/状态/作者由现有服务生成，删除契约不变。
