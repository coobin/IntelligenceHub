# Intelligence Hub

![Version](https://img.shields.io/badge/version-v2.1.0-blue)
![Platform](https://img.shields.io/badge/platform-Docker-green)
![Auth](https://img.shields.io/badge/Auth-Authelia-orange)

Intelligence Hub 是一个面向企业内部的一站式导航与智能问答工作台。它集成了内部系统导航、本地客户端唤起、AI 助手接入以及实时访问统计，旨在提升团队的日常工作效率。

> 这是一个可复用的开源模板。所有公司专属信息（品牌、域名、密钥、内网地址）都通过本地配置注入，仓库本身不含任何真实环境数据。

## 🌟 核心功能

- **统一资源导航**：一站式访问内部 H5 系统、本地客户端协议（如企业微信、RDP）、开源工具及常用网址。
- **AI 智能助手**：右侧浮动窗口支持嵌入 Dify 或其他企业助手，实现实时制度查询与智能问答。
- **管理后台 (Admin)**：
  - **可视化编辑**：无需修改代码，直接在后台增删改查导航目录。
  - **数据仪表盘**：实时统计全站 PV、今日访问量及活跃入口。
  - **热门排行**：自动计算并展示各系统入口的点击热度。
  - **访客追踪**：集成 Authelia 身份认证，支持展示最近访客信息。
- **PWA 支持**：支持安装到桌面，提供类原生应用的使用体验及离线缓存能力。
- **安全集成**：兼容 Authelia 认证网关，支持 Header 级的用户身份识别。

## 🏗️ 技术架构

- **前端**：原生 HTML5 / Vanilla CSS3 / Modern JavaScript (ES6+)，零框架、零构建。
- **后端**：Node.js + Express，提供轻量级 RESTful API。
- **数据存储**：基于 JSON 文件的轻量化存储方案。
- **认证**：对接 Authelia 认证网关。
- **部署**：Docker / Docker Compose 容器化部署。

## 🚀 快速部署

### 环境要求
- Docker & Docker Compose
- Nginx 反向代理（推荐 Nginx Proxy Manager）

### 部署步骤
1. 克隆/上传项目代码到服务器。
2. 准备配置文件：
   ```bash
   cp config.example.js config.local.js   # 前端品牌 / 链接（本地，不进仓库）
   cp .env.example .env                    # 后端密钥（本地，不进仓库）
   ```
   - 在 `config.local.js` 中填入你的站点品牌、AI 助手名称、`assistantChatUrl` 等。
   - 在 `.env` 中填入 `DIFY_API_URL` / `DIFY_API_KEY`、后台账号 `ADMIN_REMOTE_USER`，以及发票后端 `INVOICE_HOST` / `INVOICE_PORT`（如使用发票功能）。
3. 启动容器：
   ```bash
   docker-compose up -d --build
   ```
4. 在 Nginx 中配置反向代理，并接入 Authelia。

## ⚙️ 配置说明

| 配置项 | 位置 | 说明 |
|---|---|---|
| 站点 / 助手品牌、嵌入聊天链接、每日图片 | `config.local.js`（前端，gitignore） | 覆盖 `config.js` 中的占位默认值 |
| `DIFY_API_URL` / `DIFY_API_KEY` | `.env`（后端，gitignore） | AI 助手代理目标与密钥 |
| `ADMIN_REMOTE_USER` | `.env` | 允许访问 `/admin` 的 Authelia 账号 |
| `INVOICE_HOST` / `INVOICE_PORT` | `.env` | 发票代理后端地址（可选） |
| 导航目录 | `data/catalog.json` | 仓库内为示例数据，部署后通过 `/admin` 编辑 |

## 📊 数据统计说明

系统会自动创建 `data/stats.json`（不进仓库）用于记录：
- `pageViews`: 总访问量。
- `clicks`: 各入口点击热度。
- `daily`: 每日访问趋势。
- `recent`: 最近 10 条详细访问记录。

## ⚙️ 管理员操作

- **访问地址**：`https://your-domain/admin`
- **后台权限**：由 Authelia 的 `remote-user` 请求头控制，通过环境变量 `ADMIN_REMOTE_USER` 设置允许访问的账号。
- **功能切换**：左侧边栏可快速切换“数据仪表盘”与“导航目录编辑”。

## 📄 开源协议

本项目按 [MIT License](LICENSE) 开源。
