# 部署说明

先在本机用示例配置走完注册、申请、审核、到期检查，再部署到服务器。生产环境不要沿用示例名称、空间和学期。

1. 安装 Node.js 24.15+，执行 `npm ci && npm run check`。
2. 复制 `.env.example` 为 `.env`，把 `CONFIG_FILE` 指向自己的 JSON 配置，设置独立的 `DATA_DIR`。生产环境设置 `NODE_ENV=production`、公开的 `https://` 站点地址 `PUBLIC_ORIGIN`。服务默认只监听 `127.0.0.1:4312`。
3. 用 `ADMIN_PASSWORD` 临时环境变量和 `npm run admin:create -- <用户名> <显示名称>` 创建管理员，完成后立即清除环境变量。
4. 执行 `npm run build && npm start`。把 Nginx 或其他反向代理的 HTTPS 请求转发至本地 4312，传递原始 `Host`、`X-Forwarded-For` 和协议头。Node 服务不要直接暴露在公网。
5. 验证 `/api/health`、登录、申请、审核及附件访问控制，再开放注册和申请。

也可用仓库的 `Dockerfile` 和 `compose.yaml`。先创建自己的 `config/site.local.json`，将 `PUBLIC_ORIGIN` 设为外部 HTTPS 地址；Compose 只把端口绑定在主机回环地址，仍需单独配置 HTTPS 反向代理。不要在同一主机直接占用其他站点的 80/443 端口。

SQLite 在 `DATA_DIR/workstations.db` 中。备份时使用 SQLite Online Backup API 或 `VACUUM INTO` 创建一致性副本，不要在进程运行时只复制主 `.db` 文件而忽略 WAL。至少做一次恢复演练，并把备份放在服务器之外的受控位置。材料和账号均在数据库内；这也是备份文件必须加密并限制访问的原因。

更新前先备份并记录当前版本。这个 0.1.0 仓库尚未提供数据库迁移框架；升级到未来版本时要先阅读 release notes，在测试环境验证后再更新生产实例。需要长期维护的部署还应加入监控、告警、数据保留期限和外部身份认证。
