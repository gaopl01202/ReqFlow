# 数据模型设计

本文按当前 Django ORM 与迁移描述物理实现，业务语义见[业务功能说明](../业务功能说明.md)。截至 2026-10-23，本地迁移为 `0001_initial` 至 `0013_usergroup_action_permissions`。模型代码以 `backend/core/models.py` 为准；字段命名、约束及索引以迁移为准。数据库为 PostgreSQL，主记录使用 UUID，时间戳由 Django 管理，界面按北京时间显示。

## 1. 通用模型约定

`Record` 抽象模型提供 `id`、`created_at`、`updated_at`、`version`、`deleted_at`。它被用户组、职务、项目、工作流模板、成员、字典项、分类、迭代、工作项、文档、评论、附件及通知继承。`User` 继承 Django `AbstractUser` 并采用 UUID 主键；`Counter` 与 `Audit` 是服务内部表，不独立软删除。模型使用 `PROTECT` 保留业务引用；是否软删除、字段级联和跨记录一致性由领域服务处理。

密码经 Django 密码哈希保存。文件只保存在私有存储，附件 API 不暴露物理路径。工作项描述和文档正文保存 Markdown 字符串，图片是既有鉴权附件引用；不保存预览转换件。`Document.preview_file` 是旧版本兼容字段，当前代码不写入或读取。

## 2. 身份、菜单与项目成员

| Django 模型 / 表 | 当前字段与关系 | 约束及语义 |
| --- | --- | --- |
| `User` / `core_user` | Django 账号字段；`display_name`、`group`、`position`、`must_change_password`、`deleted_at`、时间戳、`version` | 登录名沿用 Django 用户名约束；软删除用户不出现在常规目录。系统管理员账号的编辑、停用、删除与密码重置由服务策略保护。 |
| `UserGroup` / `core_usergroup` | `name`、`enabled`、`builtin`、`permissions` JSON、`menu_permissions`、`action_permissions` 可空 JSON | `permissions` 保留既有业务能力码；`menu_permissions=null` 表示历史兼容规则，数组表示菜单白名单，空数组表示无菜单。action_permissions保存菜单内操作，null保留旧操作、[]仅查看。系统管理员菜单和操作不受白名单锁定。 |
| `Position` / `core_position` | `name`、`sort_order`、`enabled` | 名称唯一；排序由服务维护；被用户引用时不可删除。 |
| `Project` / `core_project` | `code`、`name`、`description`、`owner`、`status`、计划日期、`workflow` JSON | `code` 唯一；日期检查约束阻止开始日晚于结束日；工作流配置与项目同版本保存。 |
| `Member` / `core_member` | `project`、`user`、`role` 及 Record 字段 | 项目/用户唯一；移除用 `deleted_at`；角色为 admin/member/readonly。 |

项目负责人需为项目管理员；成员角色、用户组能力和项目状态共同决定写权限。菜单权限控制页面入口，不能扩大项目数据范围或代替业务授权。

## 3. 字典、分类与工作流

| Django 模型 / 表 | 当前字段与关系 | 约束及语义 |
| --- | --- | --- |
| `Priority` / `core_priority` | `project` 可空、`kind`、`code`、`name`、`color`、`sort_order`、`enabled` | 同一张表保存默认模板（project=NULL）及项目副本；kind 为 environment/severity/priority/source。名称与 code 在各作用域、kind 内唯一；项目创建时复制模板。 |
| `Category` / `core_category` | `project`、`name`、`sort_order`、`enabled` | 项目内名称唯一；工作项 category 可空，空值即默认分类。删除分类时服务事务将引用工作项转入默认分类。 |
| `WorkflowTemplate` / `core_workflowtemplate` | `key`、`workflow` JSON 及 Record 字段 | 默认模板由 key=default 标识；模板及 Project.workflow 保存需求/任务/缺陷各自状态、初始标记、类别、颜色、顺序和允许流转边，不建立状态/边关系表。 |

新项目创建时复制工作流模板和字典模板，复制后相互独立。`WorkItem.status_category` 是服务维护的 pending/completed/cancelled 快照，不接受客户端直接写入。引用中的状态不能删除或改变类别。语义配色清单由 `backend/core/color-presets.json` 提供。

## 4. 迭代与工作项

| Django 模型 / 表 | 当前字段与关系 | 约束及语义 |
| --- | --- | --- |
| `Iteration` / `core_iteration` | `project`、`name`、`goal`、`owner`、`start_date`、`end_date`、`status` 及 Record 字段 | 日期检查约束保证 end_date 不早于 start_date；状态使用 planned/active/finished。列表只返回概要及聚合计数，详情按需加载完整统计。 |
| `Counter` / `core_counter` | `project`、`item_type`、`value` | 项目/类型唯一；编号分配的内部事务计数，不提供独立 API。 |
| `WorkItem` / `core_workitem` | 项目、类型、编号、标题、描述、状态/类别快照、优先级、可空分类、兼容 `assignee`、多对多 `handlers`、创建人、可空迭代、计划/截止日期、完成时间及 Record 字段 | 编号全局唯一；项目/类型/创建时间、负责人/状态/截止日期有查询索引；日期检查约束防止 due_date 早于 planned_start_date。处理人集合由服务统一维护。 |
| `RequirementDetail` / `core_requirementdetail` | 工作项一对一、`source`、文本 `proposer`、历史验收字段、历史预计完成日期 | 当前表单不展示验收标准和预计完成日期；字段为兼容历史数据而保留。 |
| `TaskDetail` / `core_taskdetail` | 工作项一对一、可空同项目需求外键 | 任务可独立存在。 |
| `BugDetail` / `core_bugdetail` | 工作项一对一、复现/结果历史字段、环境和严重程度、报告人、可空需求/任务关系、提交验证/验证人时间 | 旧复现及结果字段仍保留但非当前表单字段；环境、严重程度作为项目字典 code 保存。 |

需求关联任务、缺陷可关联需求和任务，关系保存在明细表的外键中，没有通用 `work_item_links` 表。跨项目合法性、负责人资格及状态一致性由锁定相关项目/工作项的服务事务检查。

## 5. 文档、附件、评论、审计与通知

| Django 模型 / 表 | 当前字段与关系 | 约束及语义 |
| --- | --- | --- |
| `Document` / `core_document` | 自引用可空 `parent`、项目、标题、可空正文、`document_type`、原始文件名、大小、私有 source/兼容 preview 文件、作者/最后编辑人及 Record 字段 | `document_type=folder` 表示目录；非空目录禁止删除。Markdown 历史文档可编辑；上传文件只读预览/下载。 |
| `Attachment` / `core_attachment` | 项目、可空工作项/文档父级、上传人、私有文件、原名、大小、`is_inline_image` 及 Record 字段 | 数据库检查约束要求工作项或文档父级恰有一个非空。富文本中引用的粘贴图片持久标记为内联图片，编辑后即使从正文移除也不会出现在工作项独立附件列表。下载/预览须经父记录项目权限验证。 |
| `Comment` / `core_comment` | 工作项、作者、Markdown body、`workflow_status`、`workflow_status_name`、mentions 多对多及 Record 字段 | 状态字段记录评论提交时的状态快照；评论按创建时间倒序显示。当前界面不提供 @ 选择器。 |
| `Audit` / `core_audit` | 可空项目、操作者、实体类型/ID、动作、before/after JSON、创建时间 | 只追加、不软删除；保存删除人及回收站来源记录。敏感凭据和文件正文不得写入。 |
| `Notification` / `core_notification` | 收件人、项目、工作项、事件类型、中文 message、read_at、dedupe_key 及 Record 字段 | 收件人/dedupe_key 唯一；通知查询重新检查项目访问权限。 |
| `NotificationEvent` / `core_notificationevent` | 工作项、可空操作者、事件类型、收件人 ID JSON、唯一去重键、投递时间、尝试数及 Record 字段 | 写事务登记事件，提交后投递；`remind` 重试未投递事件。评论通知按评论ID和评论版本去重，连续评论不会因工作项版本不变而冲突。无独立队列/定时提醒表。 |

## 6. 迁移与索引基线

当前迁移链：`0001_initial` 建立首版模型，`0002_notificationevent` 增加通知投递事件，`0003` 调整项目描述及约束，`0004` 增加多处理人和评论状态快照，`0005` 增加文档原件字段，`0006_document_folders` 增加文档目录，`0007_project_dictionaries` 将字典拆为默认模板和项目副本，`0008_configurable_workflows` 配置状态语义，`0009_semantic_configuration_colors` 补齐语义色，`0010_menu_permissions` 增加独立菜单权限，`0011_attachment_inline_image` 持久标记工作项富文本内联图片并回填当前正文引用，`0012_recover_inline_images_from_audit` 按历史审计正文回填已从正文移除的内联图片，`0013_usergroup_action_permissions` 增加用户组细功能授权，`0014_operation_log` 新增精简运行日志表。

工作项索引支持项目/软删除/类型/创建时间及负责人/软删除/状态/截止日期查询；其他外键、唯一性和检查约束见 ORM 与迁移。列表 q 使用参数化数据库查询，目前没有独立搜索服务。任何结构变化必须经迁移；数据恢复以迁移前数据库及私有文件的同一时点备份为准，具体步骤见 [deployment.md](deployment.md)。

## 7. 模型与接口边界

`Counter`、`Audit`、通知投递事件、类型明细和附件父级关系不提供绕过领域服务的独立业务写入。接口对工作项、文档和项目成员使用版本检查；独立排序字段由服务计算。工作项列表和迭代列表的概要/统计均为查询时派生值，不持久化额外统计表。详细 JSON 契约见 [api.md](api.md) 和由当前代码生成的 [openapi.yaml](openapi.yaml)。

工作项附件列表只显示用户上传文件。被描述或评论内联引用的附件会持久标记 `is_inline_image=true`，即使正文编辑后移除图片引用仍保持隐藏；读取时也会检查现有 Markdown 的 `?inline=1` URL 作为兼容保护。图片仍保存在 `Attachment` 并按原权限提供内容。迁移会依据当前描述、评论及历史审计正文，回填仍在使用或曾经使用的内联图片。


## UI-73 用户组操作授权（0013）

UserGroup.action_permissions为nullable JSONField，default=null，值为唯一的`菜单键:操作键`数组。null兼容旧组原操作，[]表示不授予任何写入操作；服务端校验功能所属菜单已选中。目录在core/action-catalog.json，与前端共用。字段不建立索引，无额外业务表；effective_action_permissions为响应计算字段，不落库。menu_permissions和旧permissions保留，已有数据不批量改写。升级前备份数据库，应用0013；回滚到0012将移除细权限并恢复旧规则，必须按备份恢复对应授权数据，不能将回滚当作撤权方式。新字段可空，无历史记录回填、删除或数据迁移。


## UI-74 会话与链接数据

UI-74本身无新表、字段或迁移；后续UI-75迁移链增加至0014。会话期限使用django_session.session_data中的reqflow_started_at、reqflow_activity_at及Django已有_session_expiry，登录时重建，实际操作将最后活动时间和过期日期同步续至7天后，过期flush；开始时间仅保留元数据，不作为绝对上限。密码重置与账号停用清除该账号全部django_session，主动退出清除当前会话。业务UUID、项目code、计数器与工作项number均不变；可读链接由现有不可变项目编码、type与number尾部序号生成，文档/迭代采用既有UUID。web_url及会话剩余时间均为响应计算字段，不落库；不生成匿名分享令牌。旧会话缺少期限字段时失效，不批量改写业务数据。

## UI-75 精简运行日志（0014_operation_log）

新增core_operationlog：BigAutoField id、actor用户外键PROTECT、project可空项目外键PROTECT、action varchar(32)、resource_type varchar(32)、resource_id varchar(50)、created_at时间索引；外键有默认索引。只存引用和短操作码，无正文、快照、IP、凭据或请求体。独立于core_audit，沿用业务写事务记录成功操作，回滚同步回滚；无数据回填，不复制既有审计快照。新增菜单来自共享JSON，无需改写旧组授权。

此表为只追加系统日志，不支持业务编辑或删除，因此无updated_at、version和deleted_at。名称展示关联当前值；可引用软删除实体。迁移只增加表，可逆；回滚先备份日志，并配套回退代码，逆迁移会删除新增日志，不影响原Audit。

UI-79复制无需新表、字段或迁移：提交仍生成新的WorkItem和正常初始状态；描述图片复用现有multipart机制生成新的Attachment并标记is_inline_image，独立附件/评论/Audit不迁移到副本。来源与副本无数据库克隆关系，源记录不更新。
