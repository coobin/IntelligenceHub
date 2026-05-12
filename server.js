import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, "data/icons");

// 确保目录存在
if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR, { recursive: true });

// 配置上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ICONS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `icon-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

const STATS_FILE = path.join(__dirname, "data/stats.json");

// 初始化统计文件
const initStats = () => {
  if (!fs.existsSync(STATS_FILE) || fs.readFileSync(STATS_FILE, "utf8").trim() === "") {
    fs.writeFileSync(STATS_FILE, JSON.stringify({
      pageViews: 0,
      clicks: {},
      daily: {},
      recent: [] // 增加最近访问记录
    }, null, 2));
  }
};
initStats();

const app = express();
const port = process.env.PORT || 80;

app.set("trust proxy", 1);

const AUTH_USER = "kay";
const AUTH_PASS = "kaixuan@123";
const TOKEN_SECRET = "cih-secret-token-2026"; // 简单起见，直接使用固定字符串作为 Token

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
  if (username === AUTH_USER && password === AUTH_PASS) {
    res.cookie("auth_token", TOKEN_SECRET, { 
      httpOnly: true, 
      maxAge: 86400000,
      path: "/",
      sameSite: "Lax"
    });
    res.json({ success: true, token: TOKEN_SECRET });
  } else {
    res.status(401).json({ success: false, message: "用户名或密码错误" });
  }
});

// 获取配置接口
app.get("/api/catalog", (req, res) => {
  const filePath = path.join(__dirname, "data/catalog.json");
  try {
    const data = fs.readFileSync(filePath, "utf8");
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ success: false, message: "无法读取数据文件" });
  }
});

// 更新配置接口
app.post("/api/catalog", authenticate, (req, res) => {
  const filePath = path.join(__dirname, "data/catalog.json");
  try {
    const data = JSON.stringify(req.body, null, 2);
    fs.writeFileSync(filePath, data, "utf8");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: "无法写入数据文件" });
  }
});

// 登出接口
app.post("/api/logout", (req, res) => {
  res.clearCookie("auth_token");
  res.json({ success: true });
});

// 检查登录状态
app.get("/api/check-auth", (req, res) => {
  const token = req.cookies.auth_token || req.headers.authorization?.split(" ")[1];
  res.json({ authenticated: token === TOKEN_SECRET });
});

// 统计接口 (公开)
app.post("/api/track", (req, res) => {
  const { type, target } = req.body;
  try {
    const stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    const today = new Date().toISOString().split("T")[0];

    if (type === "pageview") {
      stats.pageViews = (stats.pageViews || 0) + 1;
      stats.daily[today] = (stats.daily[today] || 0) + 1;
      
      // 记录最近访问
      const visitor = {
        time: new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }),
        user: req.headers["remote-user"] || "匿名用户", // 读取 Authelia 传来的用户名
        ip: req.ip.replace('::ffff:', ''),
        ua: req.headers["user-agent"]
      };
      stats.recent = [visitor, ...(stats.recent || [])].slice(0, 10);
    } else if (type === "click" && target) {
      console.log(`[Track] Click registered for: ${target}`);
      stats.clicks[target] = (stats.clicks[target] || 0) + 1;
    }

    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// 获取统计数据 (需鉴权)
app.get("/api/stats", authenticate, (req, res) => {
  try {
    const stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    res.json(stats);
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// 图标上传接口
app.post("/api/upload-icon", authenticate, upload.single("icon"), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
  res.json({ success: true, filepath: `data/icons/${req.file.filename}` });
});

// 静态文件服务
app.use("/data/icons", express.static(ICONS_DIR));
app.use(express.static(__dirname));

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
