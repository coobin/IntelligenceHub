# 承希智汇 Chency Intelligence Hub

承希智汇是一个企业内部导航与智能问答工作台，用于统一访问内部 H5 系统、本地客户端、开源工具、常用网址，并预留 FastGPT 实时问答集成能力。

## 当前功能

- 内部 H5 系统导航
- 本地客户端协议入口，例如企业微信、远程桌面等
- 开源工具入口，例如 Stirling PDF、draw.io、Excalidraw
- 常用网址导航与全局搜索
- FastGPT 问答区域预留，支持通过本地配置嵌入公开分享或聊天页面

## 本地运行

这个版本是静态前端，无需安装依赖。可以直接打开 `index.html`，或用任意静态服务器运行：

```bash
python3 -m http.server 5173
```

然后访问 `http://localhost:5173`。

## 配置入口

导航数据在 `data/catalog.json` 中维护。每个入口包含：

- `name`：显示名称
- `description`：说明
- `url`：访问地址，可为 `https://`、内部域名或客户端协议
- `type`：`h5`、`client`、`tool`、`website`
- `tags`：搜索和分类标签
- `status`：状态说明

## FastGPT 集成

前端只应保存可公开访问的嵌入地址，不要把 API Key 写入浏览器代码。

1. 复制 `config.example.js` 为 `config.local.js`
2. 在 `config.local.js` 中配置 `fastgptChatUrl`
3. 如需使用 FastGPT API Key，后续应增加后端代理，并把真实密钥放入本地 `.env.local`

`.gitignore` 已排除 `config.local.js`、`.env`、`.env.*`，避免敏感信息提交到 GitHub。

## 开源协议

本项目按 MIT License 开源，详见 `LICENSE`。
