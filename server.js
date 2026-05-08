import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 80;

const AUTH_USER = "kay";
const AUTH_PASS = "kaixuan@123";
const TOKEN_SECRET = "cih-secret-token-2026"; // 简单起见，直接使用固定字符串作为 Token

app.use(express.json());
app.use(cookieParser());

// 鉴权中间件
const authenticate = (req, res, next) => {
  const token = req.cookies.auth_token;
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
    res.cookie("auth_token", TOKEN_SECRET, { httpOnly: true, maxAge: 86400000 });
    res.json({ success: true });
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
  const token = req.cookies.auth_token;
  res.json({ authenticated: token === TOKEN_SECRET });
});

// 静态文件服务
app.use(express.static(__dirname));

// 所有其他路由返回 index.html（支持单页应用模式，虽然目前主要是多页）
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) {
    return next();
  }
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
