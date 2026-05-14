# 承希智汇 | Intelligence Hub

![Version](https://img.shields.io/badge/version-v2.1.0-blue)
![Platform](https://img.shields.io/badge/platform-Docker-green)
![Auth](https://img.shields.io/badge/Auth-Authelia-orange)

承希智汇（Intelligence Hub）是一个专为企业内部打造的一站式导航与智能问答工作台。它集成了内部系统导航、本地客户端唤起、AI 助手接入以及实时访问统计，旨在提升团队的日常工作效率。

## 🌟 核心功能

- **统一资源导航**：一站式访问内部 H5 系统、本地客户端协议（如企业微信、RDP）、开源工具及常用网址。
- **AI 智能助手**：深度集成 FastGPT，右侧浮动窗口支持实时制度查询与智能问答。
- **管理后台 (Admin)**：
  - **可视化编辑**：无需修改代码，直接在后台增删改查导航目录。
  - **数据仪表盘**：实时统计全站 PV、今日访问量及活跃入口。
  - **热门排行**：自动计算并展示各系统入口的点击热度。
  - **访客追踪**：集成 Authelia 身份认证，支持展示最近访客的真实姓名、IP 及设备类型。
- **PWA 支持**：支持安装到桌面，提供类原生应用的使用体验及离线缓存能力。
- **安全集成**：完美兼容 Authelia 认证网关，支持 Header 级的用户身份识别。

## 🏗️ 技术架构

- **前端**：原生 HTML5 / Vanilla CSS3 / Modern JavaScript (ES6+)。
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
   cp config.js config.local.js
   cp .env.example .env
   ```
   并在 `config.local.js` 中配置您的 FastGPT 嵌入链接。如需启用本地账号密码登录，请在 `.env` 中设置 `ADMIN_PASSWORD` 和 `AUTH_TOKEN_SECRET`；Authelia 传入 `remote-user=hekaixuan` 时仍可直接访问后台。
3. 启动容器：
   ```bash
   docker-compose up -d --build
   ```
4. 在 Nginx 中配置反向代理（参考 `/admin` 页面说明），并接入 Authelia。

## 📊 数据统计说明

系统会自动创建 `data/stats.json` 用于记录：
- `pageViews`: 总访问量。
- `clicks`: 各入口点击热度。
- `daily`: 每日访问趋势。
- `recent`: 最近 10 条详细访问记录（时间、用户名、IP、设备）。

## ⚙️ 管理员操作

- **访问地址**：`https://your-domain/admin`
- **本地账号**：由环境变量 `ADMIN_USER`、`ADMIN_PASSWORD` 和 `AUTH_TOKEN_SECRET` 定义；未设置 `ADMIN_PASSWORD` 时仅允许 Authelia 直通或已有有效 Cookie。
- **功能切换**：左侧边栏可快速切换“数据仪表盘”与“导航目录编辑”。

## 📄 开源协议

本项目按 [MIT License](LICENSE) 开源。
