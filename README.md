# ReqFlow

面向小团队的需求、任务、缺陷、迭代与协作管理应用。后端为 Django / DRF / PostgreSQL，前端为 React / TypeScript / Ant Design。

## 本地运行

需要 Python 3.14、Node.js 22.12+、PostgreSQL 17。文档预览在浏览器本地完成，后端无需LibreOffice或转换服务。依赖精确版本见 `requirements.lock` 与 `frontend/package-lock.json`。

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.lock
cd frontend
npm ci
cd ..
cp .env.example .env
```

准备 PostgreSQL（已运行自己的数据库时，直接修改 `.env`）：

```sh
initdb -D .local/postgres -A trust -U reqflow
pg_ctl -D .local/postgres -l .local/postgres.log -o '-p 55432 -h 127.0.0.1 -k /tmp' start
createdb -h 127.0.0.1 -p 55432 -U reqflow reqflow
set -a
source .env
set +a
.venv/bin/python backend/manage.py migrate
.venv/bin/python backend/manage.py bootstrap --username admin
```

初始化命令交互读取密码，不提供共享默认密码；仅空用户库可执行。终端一：

```sh
.venv/bin/python backend/manage.py runserver 127.0.0.1:8000
```

终端二：

```sh
cd frontend
npm run dev
```

打开 [本地应用](http://127.0.0.1:5173)。通过“用户管理”创建用户时，一次性临时密码只显示本次，首次登录强制修改。API 文档位于 [接口文档](http://127.0.0.1:8000/api/v1/docs)。

## Docker 部署

生产 Docker 部署文件位于 `deploy/`。服务器准备 Docker Engine 与 Compose 插件，按 [部署说明](docs/deployment.md) 配置域名/TLS、`.env`、数据库卷和附件卷；首次启动运行迁移，再执行 `bootstrap --username admin` 交互设置管理员密码。迁移自动提供默认工作流和四类字典模板，初始化命令创建系统管理员组、普通用户组、团队成员职务及默认优先级。迁移服务器可运行 `scripts/export_docker_bundle.sh`，把 OCI 镜像、源码、Compose 配置、数据库转储及附件归档成一个带校验和的压缩包。

## 验证

```sh
.venv/bin/ruff check backend scripts
.venv/bin/ruff format --check backend scripts
.venv/bin/python backend/manage.py check
.venv/bin/python backend/manage.py makemigrations --check --dry-run
.venv/bin/python backend/manage.py test core --noinput
.venv/bin/python backend/manage.py spectacular --file docs/openapi.yaml --validate
cd frontend
npm run format:check
npm run typecheck
npm run build
npx playwright install chromium
```

浏览器验收应在专用开发测试数据库运行，避免添加验收记录到日常使用数据。使用开发模式专用随机凭据（不用于生产）：在根目录运行 `python backend/manage.py seed_e2e`（使用虚拟环境并导出数据库环境变量）；启动前后端，再在 `frontend` 运行 `npm run test:e2e`。凭据、截图和追踪文件位于忽略的 `.local/` 中。

业务来源见 [业务功能说明](业务功能说明.md)，部署与恢复见 [部署说明](docs/deployment.md)，本次验证记录见 [验收记录](docs/verification.md)。

## 本次已启动的本地交付

打开 http://127.0.0.1:5173，账号 `admin`，初始随机密码读取本机 `.local/initial-admin-password.txt`，首次登录必须改密。当前 `reqflow` 数据库不含验收项目；验收库与恢复核对结果见 docs/verification.md。该本地文件不会进入版本控制。

新建空开发环境时，可用 `bootstrap --username admin --generate-local-password` 代替交互初始化；该选项只允许 DEBUG 模式，拒绝覆盖现有初始密码文件。生产初始化继续使用交互方式。

编辑器使用 Markdown 即时渲染并支持图片粘贴；`npm run dev` / `npm run build` 前自动从锁定依赖复制必要运行时到同源静态目录，不依赖 CDN。直接调用 Vite 时先运行 `node frontend/scripts/sync-editor.mjs`（项目根目录）。

## 项目文档与附件预览

项目文档采用简洁网盘列表，支持文件夹及上传文档，不再提供新建正文；历史Markdown保留编辑。上传单文件默认10MB，支持Office六格式、PDF、XMind、Markdown、CSV/TXT、图片等21种扩展名，完整白名单见[支持格式](docs/document-formats.md)。上传后保留列表，点击文件名在新标签页只读预览；原件下载与预览都使用现有项目权限。

统一使用File Viewer React 3.2.2按需渲染器，浏览器本地加载同源Worker/WASM/字体，后端只做大小、格式和权限校验并事务保存原件及审计，不转换文件，也不把私有原件传给外部预览服务。复杂排版与原应用可能存在差异，可通过悬浮工具栏下载原件。工作项附件同样使用该预览入口。历史preview_file字段和旧转换副本仅用于兼容，不再读写；升级无需删除历史文件。

### 本地文件预览运行时

项目文档使用锁定版本File Viewer React 3.2.2 按需渲染器。`npm run dev`及`npm run build`通过Vite插件发布同源`file-viewer/`资源，部署时须完整保留`frontend/dist/file-viewer/`及上游LICENSE/NOTICE；不得仅部署入口JS。静态预览运行时约31MB，按文件类型加载，不会在登录时全部下载。完整名单见[docs/document-formats.md](docs/document-formats.md)，使用标准React包及独立渲染器，21种扩展名以frontend/document-preview-formats.json为唯一清单。predev/prebuild清除旧Full生成资源并保留当前许可文件。升级组件后在frontend执行`npm run sync:document-formats`并同步验收。旧PPT引擎保留上游水印。

项目文档现采用网盘式目录：新建文件夹、上传文档，支持嵌套目录和文件类型图标。历史Markdown文档保留编辑，不再新建正文；文档目录结构由`0006_document_folders`迁移引入，当前迁移链已到`0014_operation_log`。父目录可空，迁移前的文档留在根目录。恢复说明见docs/data-model.md。

## 长期使用模拟数据

仅本地开发模式可执行`manage.py seed_demo --actor <系统管理员账号> --batch demo26`。默认生成24位随机姓名用户、11项目，每项目110需求/320任务/520缺陷/24文档，含历史迭代、合法流转、评论、图片和多附件。先备份；独立批次不覆盖原业务，随机凭据仅保存在受忽略的`.local/demo-data/<批次>/credentials.json`（0600）。续跑、校验及数据范围见[模拟数据说明](docs/demo-data.md)。


登录默认连续7天未操作后失效，正常使用滚动续期，无固定最长登录限制；可用SESSION_IDLE_TIMEOUT_SECONDS配置（默认604800秒）。主动退出使当前会话失效，密码重置和账号停用使该账号全部会话失效。工作项详情链接形如`/p/PROJECT/task/123`，详情可复制分享；接收者仍须登录且有项目/菜单权限。旧查询式详情地址继续兼容；部署更新后旧会话需重新登录一次。会话与链接细则见docs/frontend.md中的UI-74。

系统管理“运行日志”提供成功登录、改密及各类业务操作的精简摘要查询，按菜单授权查看全系统记录。部署需应用0014_operation_log；正文、密码和修改快照不存入运行日志，原详细审计继续保留。新功能启用前历史不回填。
