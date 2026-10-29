# Docker 部署、备份与迁移

生产部署使用 `deploy/compose.yaml`，由 PostgreSQL、Django/Gunicorn、Nginx 与提醒调度服务组成。数据库与附件分别保存在 Docker 卷中；数据库端口不直接发布到宿主机。

## 首次部署

准备安装 Docker Engine 和 Compose 插件的 Linux 主机、域名及对应 TLS 证书。将源码与前端构建产物放入自选的应用目录，以下以环境变量 `${REQFLOW_HOME}` 表示该目录。创建 `${REQFLOW_HOME}/deploy/.env` 并限制其读取权限；将证书放入 `${REQFLOW_HOME}/tls/fullchain.pem` 与 `${REQFLOW_HOME}/tls/privkey.pem`。至少配置 `SECRET_KEY`、数据库凭据、`ALLOWED_HOSTS` 和 HTTPS `CSRF_TRUSTED_ORIGINS`。TLS 证书 SAN 必须匹配实际访问的主机名。systemd 与 Nginx 示例默认使用 `/opt/reqflow`，更换安装目录时需同步调整这两个示例文件。

```sh
cd "${REQFLOW_HOME}/deploy"
docker compose build
docker compose up -d db
docker compose run --rm app python manage.py migrate --noinput
docker compose run --rm -it app python manage.py bootstrap --username admin
docker compose up -d
docker compose ps
```

`bootstrap` 在交互终端设置管理员密码，仅适用于尚未初始化用户的数据库。迁移创建默认工作流和字典模板；初始化命令创建管理员组、普通用户组、团队成员职务、默认优先级及管理员账号，不会生成示例业务数据。部署后检查 `https://<域名>/api/v1/health` 并登录验证。若调整上传大小，需同步修改 Nginx 与 Django 配置。

Nginx 对文本静态资源启用 gzip，并为带哈希的静态资源设置缓存。File Viewer 运行时资源必须随 `frontend/dist/file-viewer/` 一并发布。

## 更新

更新前先备份数据库和附件。替换应用源码及前端构建资源后执行：

```sh
cd "${REQFLOW_HOME}/deploy"
docker compose build
docker compose run --rm app python manage.py migrate --noinput
docker compose up -d
docker compose ps
docker compose logs --tail=100 app web db
```

应用会执行尚未应用的迁移；不要在生产数据库手工修改结构。Docker 卷不是备份。

## 备份与恢复

一致备份前暂停所有业务写入者，再运行：

```sh
python3 scripts/backup.py "${BACKUP_DIR}" --storage "${PRIVATE_STORAGE}" --maintenance-confirmed
```

备份目录须为新目录并限制访问。备份含业务数据，应加密保存并按运维策略轮换。恢复脚本只创建新数据库，并要求附件目标目录不存在：

```sh
python3 scripts/restore.py "${BACKUP_DIR}" --database reqflow_restore --storage "${RESTORE_DIR}"
```

先核对记录数、附件哈希、健康检查和业务流程，再切换应用配置。恢复失败时不要切换；保留原数据，直到确认恢复成功。

## 迁移到另一台主机

`scripts/export_docker_bundle.sh` 可将源码、Compose 配置、运行镜像、数据库转储及附件打包，并生成校验和。先在源主机停止写入并重新导出当前数据；切勿复用旧快照。归档可能含数据库、账号密钥、环境配置、附件及 TLS 私钥，必须限制访问并加密传输，不得提交到 Git。

在目标主机安装 Docker/Compose 后，解包到权限受限的临时目录并先校验 SHA-256。配置目标环境的主机名、TLS 证书及 `.env`，加载归档镜像，再启动数据库、恢复转储和附件，最后启动应用。恢复到新主机时使用空数据库卷和空附件卷；核对健康检查、账号和附件后再考虑下线源主机。具体命令和选项以 `scripts/export_docker_bundle.sh` 与 `scripts/volume_archive.py` 为准。

## 安全要求

生产环境必须使用随机 `SECRET_KEY`、受保护的数据库凭据和 HTTPS。不要发布 `.env`、TLS 私钥、备份归档或生产数据。重置密码会使旧会话失效；用户权限及项目成员范围由服务端校验。备份频率和保留周期需由部署者设置并定期验证恢复流程。
