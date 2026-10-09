# Tools Portal

轻量工具门户：7 个工具直达链接、按工具展示更新日志、管理员上传 Markdown/TXT、手动维护卡片版本，以及历史备份与恢复。前端使用原生 HTML/CSS/JavaScript，后端使用 Node.js / Express。

## 功能

- 卡片主区域打开对应网站；日志按钮在 Portal 内打开独立日志中心。
- 每个工具以稳定工具 ID 关联网址、版本和更新记录。
- 按日期倒序展示历史；导入只记录实际提供的日期/版本，不推算或编造版本。
- 管理员选择工具、上传文件、填写版本、查看服务端解析结果并确认发布。
- 默认合并记录，重复上传跳过未变化条目；相同标题的内容变化按修订处理。
- 单独修改卡片版本；补充旧日志时可关闭同步版本。
- 每次发布或版本修改保存修改前后的备份，支持恢复。
- 安全：服务端上传限制、管理员鉴权、CSRF、同源检查、安全 Markdown、静态资源白名单、并发 ETag 校验。

预置 AOAI 的 18 条日期日志来自管理员提供的《更新日志.md》。原文件没有版本号，因此初始卡片显示“版本未设置”；管理员填写真实版本后再显示 `Version 2.0` 等标识。

## 本地运行

需要 Node.js 22 或更高版本。

```powershell
npm ci --ignore-scripts
npm test
npm start
```

默认仅监听本机 `127.0.0.1:8080`，数据存储在 `.portal-data/`，该目录不会提交 Git。默认管理员功能未配置，因此上传接口关闭，不存在默认密码。

### 配置本地管理员

```powershell
npm run admin:hash
```

此命令交互读取密码而不显示输入，密码需至少 16 个字符。将输出的 `scrypt:...` 哈希设置为进程环境变量，并提供随机 32 字符以上的会话密钥。

```powershell
$env:NODE_ENV = 'development'
$env:PORTAL_ADMIN_PASSWORD_HASH = '<上一步生成的哈希>'
$env:PORTAL_SESSION_SECRET = '<随机生成的 32 字符以上密钥>'
$env:PORTAL_ORIGIN = 'http://127.0.0.1:8080'
npm start
```

进入“日志管理”，输入自己设置的管理员密码。凭据只能放在服务器环境或安全配置中，禁止写入前端、源码或 Git。配置模板见 `.env.example`；应用不会自动加载 `.env` 文件。

### 上传文件格式

支持 UTF-8 编码 `.md`、`.txt`，单文件最大 1 MB。可以上传完整历史，也可以只上传新发布条目。

```markdown
# 更新日志

## v2.1.0 - 2026-10-09

1. 新增功能。
2. 修复问题。

## 2026-09-30

1. 只有日期的历史记录也支持。
```

`##` 日期/版本标题是发布边界；其他标题属于正文。同一天多次更新请使用不同标题或版本，避免歧义。没有发布标题的普通文本会使用填写的发布日期。

版本号 `1.0`、`2.0.0`、`2.0.0-beta` 均可手动填写。它表示管理员维护的展示版本，Portal 不探测目标网站的真实软件版本。

## App Service 配置

推荐 Linux App Service Node 22/24 + 私有 Blob Storage + 系统/用户分配托管身份。无需 SQL 或 Cosmos DB。

### 持久存储（生产推荐）

1. 使用现有或经批准新建的存储账号，创建**私有** `tools-portal` 容器。
2. 为 App Service 启用托管身份，并在该容器范围授予 `Storage Blob Data Contributor`。
3. 在 App Service 环境变量配置：

| 名称 | 值 |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORTAL_ORIGIN` | Portal 的 HTTPS 实际地址，例如 `https://tools-portal-site.azurewebsites.net` |
| `PORTAL_STORAGE` | `blob` |
| `PORTAL_BLOB_ACCOUNT_URL` | 实际存储账号 Blob HTTPS 地址，不包含 SAS 或密钥 |
| `PORTAL_BLOB_CONTAINER` | `tools-portal` |
| `PORTAL_SESSION_SECRET` | 随机 32 字符以上密钥；可以用 Key Vault 引用 |
| `AZURE_CLIENT_ID` | 仅使用用户分配身份时填写 |

生产使用 `ManagedIdentityCredential`；明确设置 `NODE_ENV=development` 时才使用 `DefaultAzureCredential`。后端不自动创建存储账号、容器或角色分配。配置错误会失败关闭，不会静默回落到临时数据。

Blob 结构：

```text
records/<toolId>.json             # 当前版本与历史记录；条件写入
previews/<uuid>.json              # 10 分钟有效的发布预览；仅管理员后端访问
archives/<toolId>/<timestamp>.json # 每次修改前后的归档、原始上传文件、操作者
```

预览文件在成功发布后删除。未发布或失败的预览失效后不能使用；生产可为 `previews/` 单独设置 1 天自动删除的生命周期规则。不要对 `records/` 或 `archives/` 使用相同清理规则。归档保留策略由管理员决定。

本地文件模式只用于单进程部署。若选择 App Service 持久文件模式，必须设置 `PORTAL_DATA_DIR` 为部署目录之外的持久目录，如 `/home/data/tools-portal`，确认持久存储启用且只有一个 Node 进程/实例；多实例必须使用 Blob。绝不能保存到 `/home/site/wwwroot`，更不能使用 PM2 cluster 模式搭配本地文件存储。

### 管理员认证（二选一）

**密码方式**：配置 `PORTAL_ADMIN_PASSWORD_HASH`（`npm run admin:hash` 的输出）及上述会话密钥和 HTTPS 来源。登录会话 8 小时过期，Cookie 为 HttpOnly / Secure / SameSite=Strict，连续失败限制为每客户端地址 15 分钟内 5 次。此简单模式适合单实例内部管理员；多实例或更复杂安全需求优先 Entra。

**Microsoft Entra（推荐组织管理）**：

- 在 App Service Authentication 中配置 Microsoft 登录，保持普通读取可匿名访问。
- 设置 `PORTAL_TRUST_APP_SERVICE_AUTH=true`、`PORTAL_ADMIN_TENANT_ID`。
- 设置 `PORTAL_ADMIN_OBJECT_IDS` 为管理员对象 ID（逗号分隔），或为授权管理员分配 `PortalAdmin` 应用角色。
- `PORTAL_ADMIN_ROLE` 可自定义。普通登录用户无该对象 ID/角色不会获得写权限。
- 必须确保请求经过 App Service Easy Auth，不得为此应用配置绕过身份代理的入口。仅当运行在 App Service 且平台认证启用时才信任身份头。

不配置管理员时，已发布日志仍可读，所有写入功能关闭。不配置生产存储时，App Service 默认只读展示预置日志，不会把上传数据写进部署目录。

### 发布代码

当前 GitHub 凭据没有创建工作流的权限，因此 `docs/github-tests.yml` 仅作为可启用的 Node 22 / 24 自动测试模板，不是运行中的工作流。以后使用具有工作流权限的凭据，将它放到 `.github/workflows/test.yml` 即可启用；该模板**不会自动部署 Azure**。发布前请配置认证、存储并确认费用/资源授权。

```powershell
npm ci --ignore-scripts
npm test
npm run package
```

部署包位于 `dist/tools-portal.zip`。此包只包含运行源码、lockfile 和预置日志，不包含 `.env`、上传记录、测试文件、Git、凭据或 `node_modules`。旧仓库里的根目录 `deploy.zip` 已过时，**不要用它发布**。

ZIP 发布时，App Service 需开启服务端构建安装依赖（例如 `SCM_DO_BUILD_DURING_DEPLOYMENT=true`），并使用 `npm start` 启动。部署前备份当前版本及 App Service 设置，优先在已有测试槽验收，再使用既有 ZIP 发布或流水线方式更新生产。

代码只读展示可以先验收；真正上传在管理员认证和存储就绪后才能使用。再次部署代码不会删除独立 Blob 里的日志。回滚代码和恢复日志是两个独立操作。

## 接口

- `GET /api/health`：应用版本、存储模式、上传是否已配置。
- `GET /api/tools`：工具网址、版本、最近日志日期和数量。
- `GET /api/tools/:toolId/changelog`：安全渲染的日志。
- `GET /api/me`、`POST /api/login`、`POST /api/logout`：管理员登录状态。
- `POST /api/admin/tools/:toolId/changelog/preview`：multipart 文件与版本/日期/模式/摘要。
- `POST /api/admin/tools/:toolId/changelog/publish`：确认预览 ID 后发布。
- `PATCH /api/admin/tools/:toolId/version`：手动版本修改。
- `GET /api/admin/tools/:toolId/archives`：备份列表。
- `POST /api/admin/tools/:toolId/restore`：确认恢复修改前状态。

写接口必须同时通过管理员身份、同源和 CSRF 校验；预览绑定工具、管理员、会话和清单修订号，有效期 10 分钟。并发冲突返回 409，要求重新预览。

## 测试与维护

`npm test` 覆盖日志解析、编码/大小/安全校验、中文文件名、登录权限、跨站请求、同日多版本、合并/覆盖、真实 multipart、并发保护、备份恢复及只读启动。新增工具请编辑 `lib/tools.js`；稳定工具 ID 不要随名称更改。

Markdown 原始 HTML 不执行，外部图片不加载，链接经过安全协议检查。只有明确列出的前端文件公开可访问，后端代码/归档/环境配置不会作为静态资源提供。

## 官方参考

- [App Service 托管身份](https://learn.microsoft.com/azure/app-service/overview-managed-identity)
- [App Service 认证](https://learn.microsoft.com/azure/app-service/overview-authentication-authorization)
- [App Service 用户身份头](https://learn.microsoft.com/azure/app-service/configure-authentication-user-identities)
- [Blob 并发与 ETag](https://learn.microsoft.com/azure/storage/blobs/concurrency-manage)
- [ZIP 发布](https://learn.microsoft.com/azure/app-service/deploy-zip)
