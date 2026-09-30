# API 概览

接口以 `/api` 为前缀。浏览器同源调用时带 Cookie；所有写请求带 `X-Requested-With: open-workstations`，登录后再带 `/api/session` 返回的 `X-CSRF-Token`。错误返回 `{ "error": "..." }`。

| 方法与路径                              | 权限             | 作用                                                 |
| --------------------------------------- | ---------------- | ---------------------------------------------------- |
| `GET /health`                           | 公开             | 数据库健康检查                                       |
| `GET /site`                             | 公开             | 布局、类型、当日占用和候选数量                       |
| `GET /session`                          | 公开             | 当前用户和 CSRF 令牌                                 |
| `POST /auth/register`                   | 公开，受配置控制 | 创建申请人账号                                       |
| `POST /auth/login`、`POST /auth/logout` | 公开/已登录      | 登录、退出                                           |
| `GET /applications`                     | 已登录           | 本人申请；管理员可看最近 200 条                      |
| `POST /applications`                    | 申请人           | `multipart/form-data`，`payload` JSON 与可选 `files` |
| `GET /applications/:id`                 | 本人或管理员     | 详情、附件元数据和事件                               |
| `POST /applications/:id/withdraw`       | 本人             | 撤回待审核申请                                       |
| `GET /attachments/:id`                  | 本人或管理员     | 下载附件                                             |
| `POST /admin/applications/:id/decision` | 管理员           | 审核决定、意见与版本号                               |

`POST /applications` 的 `payload` 包含 `seatId`、`startDate`、`endDate`、`purpose`、`outcome`，固定工位还需要 `termId`。日期格式是 `YYYY-MM-DD`。管理员决定正文包含 `decision`（`approved` 或 `rejected`）、至少 3 字的 `note` 和详情中的整数 `version`。冲突时返回 409，客户端应刷新后重试。
