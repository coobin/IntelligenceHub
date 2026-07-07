import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, "data/icons");
const CATALOG_FILE = path.join(__dirname, "data/catalog.json");
const STATS_FILE = path.join(__dirname, "data/stats.json");
const ASSETS_DIR = path.join(__dirname, "assets");
const DOWNLOADS_DIR = path.join(__dirname, "downloads");
const DEFAULT_STATS = {
  pageViews: 0,
  clicks: {},
  daily: {},
  recent: []
};
const PUBLIC_ROOT_FILES = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "admin.js",
  "manifest.webmanifest",
  "sw.js",
  "config.js",
  "config.local.js"
]);

// 确保目录存在
if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR, { recursive: true });

// 配置上传
const allowedImageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const allowedImageMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ICONS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `icon-${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedImageExtensions.has(ext) || !allowedImageMimeTypes.has(file.mimetype)) {
      return cb(new Error("仅支持 PNG、JPG、WEBP 或 GIF 图片，且大小不超过 2MB"));
    }
    cb(null, true);
  }
});

const chatUpload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // Dify API allows up to 15MB
    files: 1
  }
});

// 语音转文字：用内存存储，音频不落盘（小文件、用完即弃，避免落到公开目录）
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 1
  }
});

function readJsonFile(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

function truncateText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

// 仅保留最近 STATS_RETENTION_DAYS 天的每日统计，避免 daily/dailyUV 无限增长
const STATS_RETENTION_DAYS = 180;
function pruneStats(stats) {
  const cutoff = new Date(Date.now() - STATS_RETENTION_DAYS * 86400000)
    .toISOString()
    .split("T")[0];
  for (const map of [stats.daily, stats.dailyUV]) {
    if (!map) continue;
    for (const day of Object.keys(map)) {
      if (day < cutoff) delete map[day]; // YYYY-MM-DD 可直接按字典序比较
    }
  }
}

function validateCatalog(data) {
  if (!data || !Array.isArray(data.sections)) return false;
  return data.sections.every((section) => (
    typeof section.id === "string" &&
    typeof section.title === "string" &&
    Array.isArray(section.items) &&
    section.items.every((item) => (
      typeof item.name === "string" &&
      typeof item.url === "string" &&
      typeof item.type === "string" &&
      (!item.tags || Array.isArray(item.tags))
    ))
  ));
}

// 初始化统计文件
const initStats = () => {
  if (!fs.existsSync(STATS_FILE) || fs.readFileSync(STATS_FILE, "utf8").trim() === "") {
    writeJsonFile(STATS_FILE, DEFAULT_STATS);
  }
};
initStats();

const app = express();
const port = process.env.PORT || 80;

app.set("trust proxy", 1);

const ADMIN_REMOTE_USER = process.env.ADMIN_REMOTE_USER || "admin";

app.use(express.json());

import http from "http";

// 鉴权中间件
const authenticate = (req, res, next) => {
  // 1. 优先检查 Authelia 的 SSO 身份
  const remoteUser = req.headers["remote-user"];
  if (remoteUser === ADMIN_REMOTE_USER) {
    return next();
  }

  res.status(401).json({ success: false, message: "Unauthorized" });
};

// 代理发票系统的 API (绕过外网的 SSO Auth Proxy 和 CORS)
app.use("/invoice-proxy", (req, res) => {
  const targetPath = req.originalUrl.replace(/^\/invoice-proxy/, "");
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.origin;
  delete headers.referer;

  // express.json() 已把 JSON body 读走，req 流为空；若仍带原 Content-Length 头
  // 直接 pipe，后端会一直等 body 而挂起。这里把已解析的 JSON 重新序列化转发。
  // multipart（如发票上传）不会被 json 解析器消费，仍走流式 pipe。
  const contentType = req.headers["content-type"] || "";
  const hasParsedJson = contentType.includes("application/json")
    && req.body && typeof req.body === "object";
  let bodyBuf = null;
  if (hasParsedJson) {
    bodyBuf = Buffer.from(JSON.stringify(req.body));
    headers["content-length"] = Buffer.byteLength(bodyBuf);
  }

  const options = {
    hostname: process.env.INVOICE_HOST || "127.0.0.1",
    port: Number(process.env.INVOICE_PORT) || 8082,
    path: targetPath,
    method: req.method,
    headers
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    console.error("Invoice proxy error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: "Proxy connection failed" });
  });

  if (bodyBuf !== null) {
    proxyReq.end(bodyBuf);
  } else {
    req.pipe(proxyReq, { end: true });
  }
});

// Dify API 代理接口
app.post("/api/chat", async (req, res) => {
  // 生产环境可以加上 authenticate，或者仅允许内网/有效 session 请求
  const remoteUser = req.headers["remote-user"] || "anonymous";
  const DIFY_API_URL = process.env.DIFY_API_URL || "";
  const DIFY_API_KEY = process.env.DIFY_API_KEY || "";
  
  if (!DIFY_API_KEY) {
    res.status(500).json({ success: false, message: "Server configuration error: DIFY_API_KEY is missing." });
    return;
  }

  try {
    const payload = {
      ...req.body,
      user: remoteUser
    };
    
    // 中文名转换逻辑：仅使用 Authelia 注入的 remote-name 头
    let remoteNameRaw = req.headers["remote-name"] || req.headers["x-forwarded-user"] || "";
    let chineseName = remoteUser;

    if (remoteNameRaw) {
      try {
        chineseName = decodeURIComponent(remoteNameRaw);
        // 如果 header 传来的是 base64 或者是 raw bytes，可能还需要特殊处理
        // 由于 express 会将 header 解析为 latin1，如果是 utf8 被识别为 latin1 需要转换：
        // chineseName = Buffer.from(remoteNameRaw, 'latin1').toString('utf8');
      } catch(e) {
        chineseName = remoteNameRaw;
      }
    }
    
    // 注入大模型所需的环境变量
    payload.inputs = {
      ...(payload.inputs || {}),
      user_id: remoteUser,
      user_name: chineseName,
      current_time: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
    };

    const response = await fetch(DIFY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DIFY_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    res.writeHead(response.status, {
      "Content-Type": response.headers.get("Content-Type") || "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });

    if (response.body) {
      for await (const chunk of response.body) {
        res.write(chunk);
      }
      res.end();
    } else {
      res.end();
    }
  } catch (error) {
    console.error("Dify proxy error:", error);
    res.status(500).json({ success: false, message: "Dify API proxy failed" });
  }
});

// Dify 文件上传代理
app.post("/api/chat/upload", chatUpload.single("file"), async (req, res) => {
  const remoteUser = req.headers["remote-user"] || req.headers["x-forwarded-user"] || "anonymous";
  const DIFY_API_URL = process.env.DIFY_API_URL || "";
  const DIFY_API_KEY = process.env.DIFY_API_KEY || "";
  
  if (!req.file || !DIFY_API_URL || !DIFY_API_KEY) {
    return res.status(400).json({ success: false, message: "Missing file or Dify config" });
  }

  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const fileBlob = new Blob([fileBuffer], { type: req.file.mimetype });
    
    const formData = new FormData();
    formData.append("file", fileBlob, req.file.originalname);
    formData.append("user", remoteUser);

    const uploadUrl = DIFY_API_URL.replace("/chat-messages", "/files/upload");

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DIFY_API_KEY}`
      },
      body: formData
    });

    const result = await response.json();
    
    // 清理临时文件
    try {
      fs.unlinkSync(req.file.path);
    } catch(e) {}

    if (response.ok && result.id) {
      res.json({ success: true, file: result });
    } else {
      res.status(response.status).json({ success: false, message: result.message || "Upload failed", details: result });
    }
  } catch (error) {
    console.error("Dify upload proxy error:", error);
    res.status(500).json({ success: false, message: "Upload proxy failed" });
  }
});
// Dify 语音转文字代理 (audio-to-text)
app.post("/api/chat/audio", audioUpload.single("file"), async (req, res) => {
  const remoteUser = req.headers["remote-user"] || req.headers["x-forwarded-user"] || "anonymous";
  const DIFY_API_URL = process.env.DIFY_API_URL || "";
  const DIFY_API_KEY = process.env.DIFY_API_KEY || "";

  if (!req.file || !DIFY_API_URL || !DIFY_API_KEY) {
    return res.status(400).json({ success: false, message: "Missing audio or Dify config" });
  }

  console.log(`[Audio] incoming: name=${req.file.originalname} mime=${req.file.mimetype} size=${req.file.size}`);
  try {
    const fileBlob = new Blob([req.file.buffer], { type: req.file.mimetype });
    const formData = new FormData();
    formData.append("file", fileBlob, req.file.originalname || "audio.webm");
    formData.append("user", remoteUser);

    const sttUrl = DIFY_API_URL.replace("/chat-messages", "/audio-to-text");

    const response = await fetch(sttUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${DIFY_API_KEY}` },
      body: formData
    });

    const result = await response.json();

    if (response.ok && typeof result.text === "string") {
      res.json({ success: true, text: result.text });
    } else {
      console.error(`[Audio] Dify STT failed: HTTP ${response.status}`, JSON.stringify(result));
      res.status(response.status).json({ success: false, message: result.message || "语音识别失败", details: result });
    }
  } catch (error) {
    console.error("Dify audio proxy error:", error);
    res.status(500).json({ success: false, message: "Audio proxy failed" });
  }
});

// 获取配置接口
app.get("/api/catalog", (req, res) => {
  try {
    const data = fs.readFileSync(CATALOG_FILE, "utf8");
    res.setHeader("Cache-Control", "no-store");
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ success: false, message: "无法读取数据文件" });
  }
});

// 更新配置接口
app.post("/api/catalog", authenticate, (req, res) => {
  try {
    if (!validateCatalog(req.body)) {
      return res.status(400).json({ success: false, message: "数据格式不正确" });
    }
    writeJsonFile(CATALOG_FILE, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: "无法写入数据文件" });
  }
});

// 检查登录状态
app.get("/api/check-auth", (req, res) => {
  const remoteUser = req.headers["remote-user"] || "";
  
  // 如果是 SSO 指定用户，则视为已登录
  const authenticated = remoteUser === ADMIN_REMOTE_USER;
  res.json({ authenticated, user: remoteUser });
});

// 统计接口 (公开)
app.post("/api/track", (req, res) => {
  const { type, target } = req.body;
  if (type !== "pageview" && type !== "click") {
    return res.status(400).json({ success: false });
  }

  try {
    const stats = readJsonFile(STATS_FILE, { ...DEFAULT_STATS, clicks: {}, daily: {}, dailyUV: {}, recent: [] });
    const today = new Date().toISOString().split("T")[0];
    stats.clicks = stats.clicks || {};
    stats.daily = stats.daily || {};
    stats.dailyUV = stats.dailyUV || {};
    stats.recent = stats.recent || [];

    if (type === "pageview") {
      stats.pageViews = (stats.pageViews || 0) + 1;
      stats.daily[today] = (stats.daily[today] || 0) + 1;
      
      const userKey = req.headers["remote-user"] || "匿名用户";
      stats.dailyUV[today] = stats.dailyUV[today] || [];
      if (!stats.dailyUV[today].includes(userKey)) {
        stats.dailyUV[today].push(userKey);
      }
      
      // 记录最近访问
      const visitor = {
        time: new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }),
        user: truncateText(userKey, 80), // 读取 Authelia 传来的用户名
        ip: truncateText(req.ip.replace("::ffff:", ""), 80),
        ua: truncateText(req.headers["user-agent"], 300)
      };
      stats.recent = [visitor, ...(stats.recent || [])].slice(0, 20);
    } else if (type === "click" && target) {
      const clickTarget = truncateText(target, 120);
      if (!clickTarget) return res.status(400).json({ success: false });
      console.log(`[Track] Click registered for: ${clickTarget}`);
      stats.clicks[clickTarget] = (stats.clicks[clickTarget] || 0) + 1;
    }

    pruneStats(stats);
    writeJsonFile(STATS_FILE, stats);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// 获取统计数据 (需鉴权)
app.get("/api/stats", authenticate, (req, res) => {
  try {
    const stats = readJsonFile(STATS_FILE, DEFAULT_STATS);
    res.setHeader("Cache-Control", "no-store");
    res.json(stats);
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// 图标上传接口
app.post("/api/upload-icon", authenticate, (req, res) => {
  upload.single("icon")(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message || "上传失败" });
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    res.json({ success: true, filepath: `data/icons/${req.file.filename}` });
  });
});

// 静态文件服务
app.use("/assets", express.static(ASSETS_DIR, { fallthrough: false }));
app.use("/downloads", express.static(DOWNLOADS_DIR, {
  fallthrough: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".reg")) {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
    }
  }
}));
app.use("/data/icons", express.static(ICONS_DIR, { fallthrough: false }));

app.get("/data/catalog.json", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(CATALOG_FILE);
});

app.get("/:file", (req, res, next) => {
  if (!PUBLIC_ROOT_FILES.has(req.params.file)) return next();
  const filePath = path.join(__dirname, req.params.file);
  if (!fs.existsSync(filePath)) return next();

  if (req.params.file === "sw.js" || req.params.file === "config.local.js") {
    res.setHeader("Cache-Control", "no-store");
  }
  res.sendFile(filePath);
});

// 后台管理页面路由
app.get("/admin", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(__dirname, "admin.html"));
});

// 所有其他路由返回 index.html（支持单页应用模式）
// 仅对不带扩展名的路径（或 explicitly .html）返回 index.html
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.includes(".")) {
    return next();
  }
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
