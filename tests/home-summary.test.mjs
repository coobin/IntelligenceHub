import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, copyFile, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function startTestServer(upstreamHandler, extraEnv = {}) {
  const calls = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    calls.push({ url: req.url, headers: req.headers, body });
    await upstreamHandler(req, res, body);
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamPort = upstream.address().port;

  const reservation = http.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));

  const folder = await mkdtemp(path.join(tmpdir(), "cih-home-summary-"));
  await mkdir(path.join(folder, "data"));
  await copyFile(path.join(root, "server.js"), path.join(folder, "server.js"));
  await copyFile(path.join(root, "package.json"), path.join(folder, "package.json"));
  await writeFile(path.join(folder, "data/stats.json"), JSON.stringify({
    pageViews: 20,
    clicks: { "企业邮箱": 18, "金蝶系统": 32, "企业云盘": 9, "零点击入口": 0 },
    daily: {},
    dailyUV: {},
    dailyUVNames: {},
    recent: []
  }));
  await symlink(path.join(root, "node_modules"), path.join(folder, "node_modules"));

  const child = spawn(process.execPath, [path.join(folder, "server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      INVOICE_HOST: "127.0.0.1",
      INVOICE_PORT: String(upstreamPort),
      CHENCY_MEET_API_URL: `http://127.0.0.1:${upstreamPort}`,
      CHENCY_MEET_AI_SECRET: "meet-secret",
      ADMIN_REMOTE_USER: "admin",
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const exited = once(child, "exit");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CIH test server did not start")), 5000);
    child.stdout.on("data", () => { clearTimeout(timer); resolve(); });
    child.on("error", reject);
  });

  const cleanup = async () => {
    child.kill("SIGTERM");
    await exited;
    await new Promise((resolve) => upstream.close(resolve));
    await rm(folder, { recursive: true, force: true });
  };

  return { base: `http://127.0.0.1:${port}`, calls, cleanup };
}

test("home-summary aggregates meetings, current-period expense, popular entries and cloud identity", async () => {
  const nowParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const byType = Object.fromEntries(nowParts.map((part) => [part.type, part.value]));
  const currentPeriod = `${byType.year}${byType.month}`;
  const todayIso = `${byType.year}-${byType.month}-${byType.day}`;

  const server = await startTestServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/auth/identity") {
      return res.end(JSON.stringify({ username: "zhangsan", name: "张三" }));
    }
    if (req.url === "/api/ai/meetings-query") {
      return res.end(JSON.stringify({
        ok: true,
        ui: {
          schema: "chency.meeting.v1",
          meetings: [
            { title: "产品复盘", date: todayIso, start: "23:30", end: "23:55", roomName: "D02" },
            { title: "早会", date: todayIso, start: "00:01", end: "00:05", roomName: "D01" }
          ]
        }
      }));
    }
    if (req.url === "/api/invoices/dify/history") {
      return res.end(JSON.stringify({
        status: "ok",
        ui: {
          schema: "chency.expense.v1",
          type: "history_results",
          records: [
            { period: currentPeriod, invoiceAmount: 128, reimbursedAmount: 100, invoiceCount: 1 },
            { period: "202601", invoiceAmount: 90, reimbursedAmount: 90, invoiceCount: 1 }
          ],
          summary: { count: 2, invoiceAmount: 218, reimbursedAmount: 190 }
        }
      }));
    }
    res.statusCode = 404;
    res.end("{}");
  });

  try {
    const anonRes = await fetch(`${server.base}/api/home-summary`);
    assert.equal(anonRes.status, 200);
    const anonData = await anonRes.json();
    assert.equal(anonData.user, "");
    assert.equal(anonData.meetings.status, "unauthenticated");
    assert.equal(anonData.expense.status, "unauthenticated");
    assert.deepEqual(anonData.popularNames, ["金蝶系统", "企业邮箱", "企业云盘"]);

    const cloudRes = await fetch(`${server.base}/api/home-summary`, {
      headers: {
        "remote-user": "0123456789abcdef01234567",
        "remote-name": encodeURIComponent("张三")
      }
    });
    assert.equal(cloudRes.status, 200);
    const cloudData = await cloudRes.json();
    assert.equal(cloudData.user, "zhangsan");
    assert.equal(cloudData.displayName, "张三");
    assert.equal(cloudData.meetings.status, "ok");
    assert.equal(cloudData.meetings.totalCount, 2);
    assert.equal(cloudData.meetings.nextMeeting?.title, "产品复盘");
    assert.equal(cloudData.meetings.nextMeeting?.roomName, "D02");
    assert.equal(cloudData.expense.status, "ok");
    assert.equal(cloudData.expense.currentPeriodSubmitted, true);
    assert.equal(cloudData.expense.currentPeriodRecord?.reimbursedAmount, 100);
    assert.equal(cloudData.expense.yearSummary.count, 2);

    const meetCall = server.calls.find((call) => call.url === "/api/ai/meetings-query");
    assert.equal(meetCall.headers["x-chency-user"], "zhangsan");
    assert.equal(JSON.parse(meetCall.body).queryScope, "mine");
    const expenseCall = server.calls.find((call) => call.url === "/api/invoices/dify/history");
    assert.equal(JSON.parse(expenseCall.body).user_id, "zhangsan");
  } finally {
    await server.cleanup();
  }
});

test("home-summary degrades gracefully when upstream services fail", async () => {
  const server = await startTestServer((req, res) => {
    res.statusCode = 502;
    res.end("bad gateway");
  });

  try {
    const response = await fetch(`${server.base}/api/home-summary`, {
      headers: { "remote-user": "lisi", "remote-name": encodeURIComponent("李四") }
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.user, "lisi");
    assert.equal(data.displayName, "李四");
    assert.equal(data.meetings.status, "unavailable");
    assert.equal(data.expense.status, "unavailable");
    assert.deepEqual(data.popularNames, ["金蝶系统", "企业邮箱", "企业云盘"]);
  } finally {
    await server.cleanup();
  }
});
