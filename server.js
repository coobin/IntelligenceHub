import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import multer from "multer";
import { installPortalAssistant } from "./portal-assistant.js";

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
  dailyUV: {},
  dailyUVNames: {},
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

function decodeHeaderText(value) {
  const text = truncateText(value, 120);
  if (!text) return "";
  try {
    return decodeURIComponent(text);
  } catch (err) {
    return text;
  }
}

function getVisitorIdentity(req) {
  const userKey = truncateText(req.headers["remote-user"] || "匿名用户", 80);
  const displayName = truncateText(
    decodeHeaderText(req.headers["remote-name"] || req.headers["x-forwarded-user"]) || userKey,
    80
  );
  return { userKey, displayName };
}

// 仅保留最近 STATS_RETENTION_DAYS 天的每日统计，避免 daily/dailyUV 无限增长
const STATS_RETENTION_DAYS = 180;
function pruneStats(stats) {
  const cutoff = new Date(Date.now() - STATS_RETENTION_DAYS * 86400000)
    .toISOString()
    .split("T")[0];
  for (const map of [stats.daily, stats.dailyUV, stats.dailyUVNames]) {
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

// Cloud Home provider IDs differ from employee UIDs used by business tools
// and Dify file ownership. Resolve verified headers through the existing
// invoice directory connection before invoking those tools.
app.use(["/api/new", "/api/check-auth", "/api/home-summary", "/api/meeting-availability", "/invoice-proxy"], async (req, res, next) => {
  const providerUser = req.headers["remote-user"] || "";
  if (!/^[0-9a-f]{24}$/i.test(providerUser)) return next();
  const identityHeaders = { "Remote-User": providerUser };
  for (const header of ["remote-name", "remote-email"]) {
    if (req.headers[header]) identityHeaders[header] = req.headers[header];
  }
  try {
    const host = process.env.INVOICE_HOST || "127.0.0.1";
    const invoicePort = Number(process.env.INVOICE_PORT) || 8082;
    const response = await fetch(`http://${host}:${invoicePort}/api/auth/identity`, {
      headers: identityHeaders,
      signal: AbortSignal.timeout(8000),
    });
    const identity = await response.json();
    if (!response.ok) {
      return res.status([401, 409, 503].includes(response.status) ? response.status : 502).json({
        success: false,
        message: typeof identity.detail === "string" ? identity.detail : "员工身份核验失败，请稍后重试。",
      });
    }
    if (!identity.username || !identity.name || /^[0-9a-f]{24}$/i.test(identity.username)) {
      throw new Error("Directory returned an invalid employee identity");
    }
    req.assistantIdentity = identity;
    next();
  } catch (error) {
    console.error("Employee identity resolution failed:", error.name);
    res.status(503).json({ success: false, message: "员工身份核验服务暂时不可用，请稍后重试。" });
  }
});

function assistantUser(req) {
  return req.assistantIdentity?.username || req.headers["remote-user"] || "anonymous";
}

function assistantDisplayName(req) {
  return truncateText(
    req.assistantIdentity?.name
    || decodeHeaderText(req.headers["remote-name"] || req.headers["x-forwarded-user"])
    || assistantUser(req),
    80
  );
}

installPortalAssistant(app, {
  assistantUser,
  assistantDisplayName,
  audioUpload,
  authenticate: (req, res, next) => authenticate(req, res, next),
  chatLogDir: path.join(__dirname, "data/chat-logs"),
});
app.get(["/new", "/new/"], (req, res) => {
  res.redirect(302, "/");
});

function getShanghaiNowParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    todayIso: `${parts.year}-${parts.month}-${parts.day}`,
    currentPeriod: `${parts.year}${parts.month}`,
    nowTime: `${hour}:${parts.minute}`,
  };
}

const HOME_SUMMARY_CACHE_TTL_MS = 20000;
const HOME_SUMMARY_CACHE_MAX = 200;
const homeSummaryCache = new Map();

function readHomeSummaryCache(cacheKey) {
  const entry = homeSummaryCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.at > HOME_SUMMARY_CACHE_TTL_MS) {
    homeSummaryCache.delete(cacheKey);
    return null;
  }
  return entry.data;
}

function writeHomeSummaryCache(cacheKey, data) {
  if (homeSummaryCache.size >= HOME_SUMMARY_CACHE_MAX) {
    const oldestKey = homeSummaryCache.keys().next().value;
    if (oldestKey) homeSummaryCache.delete(oldestKey);
  }
  homeSummaryCache.set(cacheKey, { at: Date.now(), data });
}

function readPopularEntryNames(limit = 6) {
  const stats = readJsonFile(STATS_FILE, DEFAULT_STATS);
  const clicks = stats?.clicks && typeof stats.clicks === "object" ? stats.clicks : {};
  return Object.entries(clicks)
    .filter(([name, count]) => name && Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, limit)
    .map(([name]) => name);
}

async function fetchTodayMeetingSummary(username, displayName, todayIso, nowTime) {
  const apiBase = String(process.env.CHENCY_MEET_API_URL || "").replace(/\/$/, "");
  const apiSecret = process.env.CHENCY_MEET_AI_SECRET || "";
  if (!apiBase || !apiSecret) return { status: "unconfigured" };

  try {
    const response = await fetch(`${apiBase}/api/ai/meetings-query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiSecret}`,
        "X-Chency-User": username,
        "X-Chency-Name": encodeURIComponent(displayName || username),
      },
      body: JSON.stringify({
        date: todayIso,
        queryScope: "mine",
        requesterUser: username,
      }),
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return { status: "unavailable" };
    const data = await response.json();
    const rawMeetings = Array.isArray(data?.ui?.meetings) ? data.ui.meetings : [];
    const meetings = rawMeetings
      .map((meeting) => ({
        title: truncateText(meeting?.title || "未命名会议", 80),
        date: truncateText(meeting?.date || todayIso, 10),
        start: truncateText(meeting?.start || "", 5),
        end: truncateText(meeting?.end || "", 5),
        roomName: truncateText(meeting?.roomName || meeting?.room || "", 40),
      }))
      .sort((a, b) => a.start.localeCompare(b.start));
    const upcoming = meetings.filter((meeting) => {
      const compareTime = meeting.end || meeting.start;
      return !compareTime || compareTime > nowTime;
    });
    return {
      status: "ok",
      date: todayIso,
      totalCount: meetings.length,
      upcomingCount: upcoming.length,
      nextMeeting: upcoming[0] || null,
      meetings: meetings.slice(0, 3),
    };
  } catch (error) {
    console.error("Home summary meetings fetch failed:", error.name || error.message);
    return { status: "unavailable" };
  }
}

async function fetchExpenseSummary(username, currentPeriod) {
  const host = String(process.env.INVOICE_HOST || "").trim();
  if (!host) return { status: "unconfigured", currentPeriod };
  const invoicePort = Number(process.env.INVOICE_PORT) || 8082;

  try {
    const response = await fetch(`http://${host}:${invoicePort}/api/invoices/dify/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: username }),
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return { status: "unavailable", currentPeriod };
    const data = await response.json();
    if (data?.status !== "ok" || data?.ui?.schema !== "chency.expense.v1") {
      return { status: "unavailable", currentPeriod };
    }
    const records = data.ui.records;
    if (!Array.isArray(records)) return { status: "unavailable", currentPeriod };
    const pickRecord = (record) => (record ? {
      period: truncateText(record.period || "", 32),
      invoiceAmount: Number(record.invoiceAmount || 0),
      reimbursedAmount: Number(record.reimbursedAmount || 0),
      invoiceCount: Number(record.invoiceCount || 0),
    } : null);
    const currentPeriodRecord = records.find((record) => String(record?.period || "").includes(currentPeriod)) || null;
    const latestRecord = records[0] || null;
    const summary = data.ui.summary || {};
    const previousMonths = [1, 2, 3].map((offset) => {
      const firstDay = new Date(Date.UTC(Number(currentPeriod.slice(0, 4)), Number(currentPeriod.slice(4)) - 1 - offset, 1));
      const period = firstDay.toISOString().slice(0, 7).replace("-", "");
      let invoiceCount = 0;
      let reimbursedCents = 0;
      let hasSharedPeriod = false;
      for (const record of records) {
        const periods = String(record.period || "").split(",").map((part) => part.trim());
        if (!periods.includes(period)) continue;
        if (periods.length > 1) {
          hasSharedPeriod = true;
          continue;
        }
        invoiceCount += Number(record.invoiceCount);
        reimbursedCents += Math.round(Number(record.reimbursedAmount) * 100);
      }
      return { period, invoiceCount, reimbursedAmount: reimbursedCents / 100, hasSharedPeriod };
    });
    return {
      status: "ok",
      currentPeriod,
      previousMonths,
      currentPeriodSubmitted: Boolean(currentPeriodRecord),
      currentPeriodRecord: pickRecord(currentPeriodRecord),
      latestRecord: pickRecord(latestRecord),
      yearSummary: {
        count: Number(summary.count || 0),
        invoiceAmount: Number(summary.invoiceAmount || 0),
        reimbursedAmount: Number(summary.reimbursedAmount || 0),
      },
    };
  } catch (error) {
    console.error("Home summary expense fetch failed:", error.name || error.message);
    return { status: "unavailable", currentPeriod };
  }
}

function resolveKingdeeWorkflowUser(req, username, displayName) {
  const source = String(process.env.KINGDEE_QUERY_USER_SOURCE || "remote_name").trim().toLowerCase();
  if (source === "remote_user") return username;
  if (source === "kingdee_header") {
    return decodeHeaderText(req.headers["remote-kingdee-username"]) || displayName || username;
  }
  return displayName || username;
}

async function fetchWorkflowSummary(kingdeeUser) {
  const apiBase = String(process.env.KINGDEE_QUERY_API_URL || "").replace(/\/$/, "");
  const apiKey = process.env.KINGDEE_QUERY_API_KEY || "";
  if (!apiBase || !apiKey) return { status: "unconfigured" };
  const user = truncateText(kingdeeUser, 80);
  if (!user) return { status: "unavailable" };

  const userHeader = String(process.env.KINGDEE_QUERY_USER_HEADER || "x-end-user").trim() || "x-end-user";
  try {
    const response = await fetch(`${apiBase}/api/dify/v1/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        [userHeader]: encodeURIComponent(user),
      },
      body: JSON.stringify({
        tool: "workflow_progress",
        arguments: { limit: 10 },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 403) return { status: "forbidden" };
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.data || !Array.isArray(payload.data.rows)) {
      return { status: "unavailable" };
    }
    const items = payload.data.rows.map((row) => ({
      billNumber: truncateText(row?.["单据编号"], 60),
      processName: truncateText(row?.["流程名称"], 80),
      currentNode: truncateText(row?.["当前节点"], 80),
      reviewer: truncateText(row?.["当前处理人"], 120),
      arrivedAt: truncateText(row?.["节点到达时间"], 40),
      createdAt: truncateText(row?.["发起时间"], 40),
      status: truncateText(row?.["状态"], 30) || "审批中",
    }));
    return {
      status: "ok",
      count: Number(payload.data.count ?? items.length),
      truncated: Boolean(payload.data.truncated),
      items,
    };
  } catch (error) {
    console.error("Home summary workflow fetch failed:", error.name || error.message);
    return { status: "unavailable" };
  }
}

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
  if (req.assistantIdentity) {
    headers["remote-user"] = req.assistantIdentity.username;
    headers["remote-name"] = encodeURIComponent(req.assistantIdentity.name);
  }
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

// 可用会议室查询直接调用希会，避免把“可预定”误解为“已有会议列表”。
app.post("/api/meeting-availability", async (req, res) => {
  const date = truncateText(req.body?.date, 10);
  const start = truncateText(req.body?.start, 5);
  const end = truncateText(req.body?.end, 5);
  const mode = req.body?.mode === "exact" ? "exact" : "window";
  const validDate = /^20\d{2}-\d{2}-\d{2}$/.test(date);
  const validTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!validDate || Boolean(start) !== Boolean(end) || (start && (!validTime(start) || !validTime(end) || start >= end))) {
    res.status(400).json({ success: false, message: "会议室查询日期或时间格式不正确。" });
    return;
  }

  const apiBase = String(process.env.CHENCY_MEET_API_URL || "").replace(/\/$/, "");
  const apiSecret = process.env.CHENCY_MEET_AI_SECRET || "";
  if (!apiBase || !apiSecret) {
    res.status(500).json({ success: false, message: "会议室查询服务尚未配置。" });
    return;
  }

  const keyword = start && end
    ? `__availability__:${mode}:${start}-${end}`
    : "__availability__:day";
  try {
    const response = await fetch(`${apiBase}/api/ai/meetings-query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiSecret}`,
        "X-Chency-User": assistantUser(req),
        "X-Chency-Name": req.headers["remote-name"] || "",
      },
      body: JSON.stringify({ date, keyword, requesterUser: assistantUser(req) }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    const ui = data?.ui?.schema === "chency.meeting.v1" ? data.ui : null;
    if (!ui) {
      res.status(502).json({ success: false, message: "会议室查询结果格式不正确。" });
      return;
    }
    // 只把展示所需的结构化卡片返回浏览器，不透传希会内部的会议/人员明细。
    res.status(response.status).json({ ok: Boolean(data.ok), message: truncateText(data.message, 4000), ui });
  } catch (error) {
    console.error("Meeting availability proxy error:", error);
    res.status(502).json({ success: false, message: "会议室查询服务暂时不可用。" });
  }
});

app.post(["/api/chat", "/api/chat/upload", "/api/chat/audio", "/api/meeting-intent"], (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(410).json({ success: false, message: "旧版对话接口已下线，请刷新页面使用当前智能助手。" });
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

// 模块排序只更新分类顺序，保留目录中已有的内容。
app.put("/api/catalog/order", authenticate, (req, res) => {
  const { sectionIds } = req.body || {};
  if (!Array.isArray(sectionIds) || !sectionIds.every((id) => typeof id === "string")
    || new Set(sectionIds).size !== sectionIds.length) {
    return res.status(400).json({ success: false, message: "模块顺序格式不正确" });
  }

  try {
    const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
    const sectionsById = new Map(catalog.sections.map((section) => [section.id, section]));
    if (sectionIds.length !== catalog.sections.length || sectionsById.size !== catalog.sections.length
      || sectionIds.some((id) => !sectionsById.has(id))) {
      return res.status(409).json({ success: false, message: "导航目录已更新，请刷新后重新排序" });
    }
    catalog.sections = sectionIds.map((id) => sectionsById.get(id));
    writeJsonFile(CATALOG_FILE, catalog);
    res.json(catalog);
  } catch {
    res.status(500).json({ success: false, message: "无法保存模块顺序" });
  }
});

// 项目没有固定 ID：核对打开排序窗口时的项目列表，再按索引重排当前数据。
app.put("/api/catalog/item-order", authenticate, (req, res) => {
  const { sectionId, expectedItems, order } = req.body || {};
  if (typeof sectionId !== "string" || !Array.isArray(expectedItems) || !Array.isArray(order)
    || order.length !== expectedItems.length || new Set(order).size !== order.length
    || !order.every((index) => Number.isInteger(index) && index >= 0 && index < order.length)) {
    return res.status(400).json({ success: false, message: "项目顺序格式不正确" });
  }

  try {
    const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
    const sections = catalog.sections.filter((section) => section.id === sectionId);
    if (sections.length !== 1 || JSON.stringify(sections[0].items) !== JSON.stringify(expectedItems)) {
      return res.status(409).json({ success: false, message: "模块内容已更新，请刷新后重新排序" });
    }
    const section = sections[0];
    section.items = order.map((index) => section.items[index]);
    writeJsonFile(CATALOG_FILE, catalog);
    res.json(catalog);
  } catch {
    res.status(500).json({ success: false, message: "无法保存项目顺序" });
  }
});

// 检查登录状态
app.get("/api/check-auth", (req, res) => {
  const remoteUser = req.headers["remote-user"] || "";
  
  // 如果是 SSO 指定用户，则视为已登录
  const authenticated = remoteUser === ADMIN_REMOTE_USER;
  res.json({ authenticated, user: req.assistantIdentity?.username || remoteUser });
});

// 首页工作台轻量聚合概览（金蝶流程审批、个人今日日程、通讯费报销状态与热门入口）
app.get("/api/home-summary", async (req, res) => {
  const username = assistantUser(req);
  const hasUser = Boolean(username && username !== "anonymous");
  const displayName = hasUser
    ? truncateText(
        req.assistantIdentity?.name
        || decodeHeaderText(req.headers["remote-name"] || req.headers["x-forwarded-user"])
        || username,
        80
      )
    : "";
  const { todayIso, currentPeriod, nowTime } = getShanghaiNowParts();
  const popularNames = readPopularEntryNames(6);

  if (!hasUser) {
    res.json({
      user: "",
      displayName: "",
      today: todayIso,
      currentPeriod,
      popularNames,
      workflows: { status: "unauthenticated" },
      meetings: { status: "unauthenticated" },
      expense: { status: "unauthenticated", currentPeriod },
    });
    return;
  }

  const forceRefresh = req.query.refresh === "1";
  const cacheKey = `${username}:${todayIso}`;
  if (!forceRefresh) {
    const cached = readHomeSummaryCache(cacheKey);
    if (cached) {
      res.json({ ...cached, popularNames });
      return;
    }
  }

  const kingdeeUser = resolveKingdeeWorkflowUser(req, username, displayName);
  const [workflowsResult, meetingsResult, expenseResult] = await Promise.allSettled([
    fetchWorkflowSummary(kingdeeUser),
    fetchTodayMeetingSummary(username, displayName, todayIso, nowTime),
    fetchExpenseSummary(username, currentPeriod),
  ]);

  const payload = {
    user: username,
    displayName,
    today: todayIso,
    currentPeriod,
    popularNames,
    workflows: workflowsResult.status === "fulfilled" ? workflowsResult.value : { status: "unavailable" },
    meetings: meetingsResult.status === "fulfilled" ? meetingsResult.value : { status: "unavailable" },
    expense: expenseResult.status === "fulfilled" ? expenseResult.value : { status: "unavailable", currentPeriod },
  };
  writeHomeSummaryCache(cacheKey, payload);
  res.json(payload);
});

// 统计接口 (公开)
app.post("/api/track", (req, res) => {
  const { type, target } = req.body;
  if (type !== "pageview" && type !== "click") {
    return res.status(400).json({ success: false });
  }

  try {
    const stats = readJsonFile(STATS_FILE, {
      ...DEFAULT_STATS,
      clicks: {},
      daily: {},
      dailyUV: {},
      dailyUVNames: {},
      recent: []
    });
    const today = new Date().toISOString().split("T")[0];
    stats.clicks = stats.clicks || {};
    stats.daily = stats.daily || {};
    stats.dailyUV = stats.dailyUV || {};
    stats.dailyUVNames = stats.dailyUVNames || {};
    stats.recent = stats.recent || [];

    if (type === "pageview") {
      stats.pageViews = (stats.pageViews || 0) + 1;
      stats.daily[today] = (stats.daily[today] || 0) + 1;
      
      const { userKey, displayName } = getVisitorIdentity(req);
      stats.dailyUV[today] = stats.dailyUV[today] || [];
      if (!stats.dailyUV[today].includes(userKey)) {
        stats.dailyUV[today].push(userKey);
      }
      stats.dailyUVNames[today] = stats.dailyUVNames[today] || {};
      stats.dailyUVNames[today][userKey] = displayName;
      
      // 记录最近访问
      const visitor = {
        time: new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }),
        user: userKey, // 稳定身份值，用于兼容旧数据和追踪去重
        displayName, // 展示名称，云之家用户可能与 user 不同
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
