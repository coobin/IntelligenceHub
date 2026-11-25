import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, copyFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cloudHeaders = { "remote-user": "0123456789abcdef01234567", "remote-name": encodeURIComponent("员工") };

test("employee identity stays consistent across CIH chat, uploads and invoice proxy", async (t) => {
  const calls = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    calls.push({ url: req.url, headers: req.headers, body });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/auth/identity") {
      const name = decodeURIComponent(req.headers["remote-name"] || "");
      if (name !== "员工") {
        res.statusCode = name === "unavailable" ? 503 : 409;
        return res.end(JSON.stringify({ detail: "身份核验失败" }));
      }
      return res.end(JSON.stringify({ username: "employee", name }));
    }
    if (req.url === "/mcp") {
      const rpc = JSON.parse(body);
      if (rpc.method === "notifications/initialized") {
        res.statusCode = 202;
        return res.end();
      }
      if (rpc.method === "initialize") {
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18" } }));
      }
      if (rpc.method === "tools/call") {
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { structuredContent: { status: "succeeded", summary: "ok", data: { records: [] } } } }));
      }
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { tools: [] } }));
    }
    res.end('{"ok":true}');
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamPort = upstream.address().port;
  const reservation = http.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const folder = await mkdtemp(path.join(tmpdir(), "cih-sso-test-"));
  await mkdir(path.join(folder, "data"));
  await copyFile(path.join(root, "server.js"), path.join(folder, "server.js"));
  await copyFile(path.join(root, "portal-assistant.js"), path.join(folder, "portal-assistant.js"));
  await copyFile(path.join(root, "package.json"), path.join(folder, "package.json"));
  await symlink(path.join(root, "node_modules"), path.join(folder, "node_modules"));
  const child = spawn(process.execPath, [path.join(folder, "server.js")], { env: {
    ...process.env, PORT: String(port), INVOICE_HOST: "127.0.0.1", INVOICE_PORT: String(upstreamPort),
    PORTAL_MCP_URL: `http://127.0.0.1:${upstreamPort}/mcp`, PORTAL_MCP_SECRET: "test-secret",
    PORTAL_ORIGIN: "https://portal.example", PORTAL_PROXY_IPS: "127.0.0.1", ADMIN_REMOTE_USER: "admin",
  }, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CIH test server did not start")), 5000);
      child.stdout.on("data", () => { clearTimeout(timer); resolve(); });
      child.on("error", reject);
    });
    const base = `http://127.0.0.1:${port}`;
    const chat = (headers, query = "查询我的通讯费报销记录") => fetch(`${base}/api/new/chat`, { method: "POST", headers: {
      ...headers,
      "Content-Type": "application/json",
      Origin: "https://portal.example",
      Cookie: "authelia_session=test",
    }, body: JSON.stringify({ query, session: "sso-test-session" }) });

    await t.test("ordinary account and admin checks retain their existing identity", async () => {
      const auth = await fetch(`${base}/api/check-auth`, { headers: { "remote-user": "employee" } });
      assert.deepEqual(await auth.json(), { authenticated: false, user: "employee" });
      assert.equal((await chat({ "remote-user": "employee" })).status, 200);
      assert.equal(calls.filter((call) => call.url === "/mcp").at(-1).headers["x-portal-employee"], "employee");
      const admin = await fetch(`${base}/api/check-auth`, { headers: { "remote-user": "admin" } });
      assert.equal((await admin.json()).authenticated, true);
    });
    await t.test("cloud session forwards resolved directory account to portal MCP", async () => {
      const auth = await fetch(`${base}/api/check-auth`, { headers: cloudHeaders });
      assert.deepEqual(await auth.json(), { authenticated: false, user: "employee" });
      assert.equal((await chat(cloudHeaders)).status, 200);
      assert.equal(calls.filter((call) => call.url === "/mcp").at(-1).headers["x-portal-employee"], "employee");
    });
    await t.test("native invoice proxy forwards verified employee identity and JSON body", async () => {
      await fetch(`${base}/invoice-proxy/api/invoices/example`, { method: "POST", headers: {
        ...cloudHeaders, "Content-Type": "application/json",
      }, body: JSON.stringify({ example: true }) });
      assert.equal(calls.at(-1).headers["remote-user"], "employee");
      assert.equal(decodeURIComponent(calls.at(-1).headers["remote-name"]), "员工");
      assert.deepEqual(JSON.parse(calls.at(-1).body), { example: true });
    });
    await t.test("unmatched and unavailable identities stop before reaching portal MCP", async () => {
      for (const name of ["unknown", "unavailable"]) {
        const before = calls.filter((call) => call.url === "/mcp").length;
        const response = await chat({ ...cloudHeaders, "remote-name": name });
        assert.equal(response.status, name === "unknown" ? 409 : 503);
        assert.equal((await response.json()).message, "身份核验失败");
        assert.equal(calls.filter((call) => call.url === "/mcp").length, before);
      }
    });
    await t.test("retired legacy Dify endpoints return 410 and /new redirects to /", async () => {
      for (const route of ["/api/chat", "/api/chat/upload", "/api/chat/audio", "/api/meeting-intent"]) {
        const res = await fetch(`${base}${route}`, { method: "POST" });
        assert.equal(res.status, 410);
      }
      const redirectRes = await fetch(`${base}/new`, { redirect: "manual" });
      assert.equal(redirectRes.status, 302);
      assert.equal(redirectRes.headers.get("location"), "/");
    });
  } finally {
    child.kill("SIGTERM");
    await exited;
    await new Promise((resolve) => upstream.close(resolve));
    await rm(folder, { recursive: true, force: true });
  }
});
