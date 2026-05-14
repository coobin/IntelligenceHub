import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, "data/icons");
const CATALOG_FILE = path.join(__dirname, "data/catalog.json");
const STATS_FILE = path.join(__dirname, "data/stats.json");
const ASSETS_DIR = path.join(__dirname, "assets");
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

const AUTH_USER = process.env.ADMIN_USER || "kay";
const AUTH_PASS = process.env.ADMIN_PASSWORD || "";
const TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || crypto.randomBytes(32).toString("hex");
const COOKIE_OPTIONS = {
  httpOnly: true,
  maxAge: 86400000,
  path: "/",
  sameSite: "Lax",
  secure: process.env.COOKIE_SECURE === "true"
};

if (!AUTH_PASS) {
  console.warn("[Auth] ADMIN_PASSWORD 未设置，本地账号密码登录已禁用，仅允许 Authelia remote-user 直通或已有有效 Cookie。");
}

app.use(express.json());
app.use(cookieParser());

// 鉴权中间件
const authenticate = (req, res, next) => {
  // 1. 优先检查 Authelia 的 SSO 身份
  const remoteUser = req.headers["remote-user"];
  if (remoteUser === "hekaixuan") {
    return next();
  }

  // 2. 检查 Token
  const token = req.cookies.auth_token || req.headers.authorization?.split(" ")[1];
  if (token === TOKEN_SECRET) {
    next();
  } else {
    res.status(401).json({ success: false, message: "Unauthorized" });
  }
};

// 登录接口
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (AUTH_PASS && username === AUTH_USER && password === AUTH_PASS) {
    res.cookie("auth_token", TOKEN_SECRET, COOKIE_OPTIONS);
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: "用户名或密码错误" });
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

// 登出接口
app.post("/api/logout", (req, res) => {
  res.clearCookie("auth_token", { path: "/", sameSite: "Lax", secure: COOKIE_OPTIONS.secure });
  res.json({ success: true });
});

// 检查登录状态
app.get("/api/check-auth", (req, res) => {
  const remoteUser = req.headers["remote-user"];
  const token = req.cookies.auth_token || req.headers.authorization?.split(" ")[1];
  
  // 如果是 SSO 指定用户，或者有正确 Token，都视为已登录
  const authenticated = (remoteUser === "hekaixuan") || (token === TOKEN_SECRET);
  res.json({ authenticated });
});

// 统计接口 (公开)
app.post("/api/track", (req, res) => {
  const { type, target } = req.body;
  if (type !== "pageview" && type !== "click") {
    return res.status(400).json({ success: false });
  }

  try {
    const stats = readJsonFile(STATS_FILE, { ...DEFAULT_STATS, clicks: {}, daily: {}, recent: [] });
    const today = new Date().toISOString().split("T")[0];
    stats.clicks = stats.clicks || {};
    stats.daily = stats.daily || {};
    stats.recent = stats.recent || [];

    if (type === "pageview") {
      stats.pageViews = (stats.pageViews || 0) + 1;
      stats.daily[today] = (stats.daily[today] || 0) + 1;
      
      // 记录最近访问
      const visitor = {
        time: new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }),
        user: truncateText(req.headers["remote-user"] || "匿名用户", 80), // 读取 Authelia 传来的用户名
        ip: truncateText(req.ip.replace("::ffff:", ""), 80),
        ua: truncateText(req.headers["user-agent"], 300)
      };
      stats.recent = [visitor, ...(stats.recent || [])].slice(0, 10);
    } else if (type === "click" && target) {
      const clickTarget = truncateText(target, 120);
      if (!clickTarget) return res.status(400).json({ success: false });
      console.log(`[Track] Click registered for: ${clickTarget}`);
      stats.clicks[clickTarget] = (stats.clicks[clickTarget] || 0) + 1;
    }

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
