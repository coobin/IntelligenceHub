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
    if (req.url === "/v1/chat-messages") {
      const payload = JSON.parse(body);
      if (payload.conversation_id === "legacy-conversation") {
        res.statusCode = 404;
        return res.end(JSON.stringify({ code: "conversation_not_exists" }));
      }
      res.setHeader("Content-Type", "text/event-stream");
      return res.end('data: {"event":"message_end","conversation_id":"new-conversation"}\n\n');
    }
    if (req.url.startsWith("/v1/messages?")) {
      const conversation = new URL(req.url, "http://upstream.invalid").searchParams.get("conversation_id");
      if (conversation === "legacy-conversation") {
        res.statusCode = 404;
        return res.end('{"code":"not_found","message":"Conversation Not Exists."}');
      }
      if (conversation === "unavailable") {
        res.statusCode = 503;
        return res.end('{"code":"unavailable"}');
      }
      return res.end('{"data":[]}');
    }
    if (req.url === "/v1/files/upload") return res.end('{"id":"file-1"}');
    if (req.url === "/v1/audio-to-text") return res.end('{"text":"查询通讯费"}');
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
  await copyFile(path.join(root, "package.json"), path.join(folder, "package.json"));
  await symlink(path.join(root, "node_modules"), path.join(folder, "node_modules"));
  const child = spawn(process.execPath, [path.join(folder, "server.js")], { env: {
    ...process.env, PORT: String(port), INVOICE_HOST: "127.0.0.1", INVOICE_PORT: String(upstreamPort),
    DIFY_API_URL: `http://127.0.0.1:${upstreamPort}/v1/chat-messages`, DIFY_API_KEY: "test-only", ADMIN_REMOTE_USER: "admin",
  }, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CIH test server did not start")), 5000);
      child.stdout.on("data", () => { clearTimeout(timer); resolve(); });
      child.on("error", reject);
    });
    const base = `http://127.0.0.1:${port}`;
    const chat = (headers, extra = {}) => fetch(`${base}/api/chat`, { method: "POST", headers: {
      ...headers, "Content-Type": "application/json",
    }, body: JSON.stringify({ query: "通讯费报销记录", user: "spoofed-user", inputs: { user_id: "spoofed-user" }, ...extra }) });

    await t.test("ordinary account and admin checks retain their existing identity", async () => {
      const auth = await fetch(`${base}/api/check-auth`, { headers: { "remote-user": "employee" } });
      assert.deepEqual(await auth.json(), { authenticated: false, user: "employee" });
      await (await chat({ "remote-user": "employee" })).text();
      assert.equal(JSON.parse(calls.at(-1).body).user, "employee");
      const admin = await fetch(`${base}/api/check-auth`, { headers: { "remote-user": "admin" } });
      assert.equal((await admin.json()).authenticated, true);
    });
    await t.test("cloud session, tool inputs and file owner use the same directory account", async () => {
      const auth = await fetch(`${base}/api/check-auth`, { headers: cloudHeaders });
      assert.deepEqual(await auth.json(), { authenticated: false, user: "employee" });
      await (await chat(cloudHeaders)).text();
      const payload = JSON.parse(calls.at(-1).body);
      assert.equal(payload.user, "employee");
      assert.equal(payload.inputs.user_id, "employee");
      assert.equal(payload.inputs.user_name, "员工");
      const file = new FormData();
      file.append("file", new Blob(["test"], { type: "application/pdf" }), "test.pdf");
      assert.equal((await fetch(`${base}/api/chat/upload`, { method: "POST", headers: cloudHeaders, body: file })).status, 200);
      assert.match(calls.at(-1).body, /name="user"\r\n\r\nemployee/);
      const audio = new FormData();
      audio.append("file", new Blob(["test"], { type: "audio/wav" }), "test.wav");
      assert.equal((await fetch(`${base}/api/chat/audio`, { method: "POST", headers: cloudHeaders, body: audio })).status, 200);
      assert.match(calls.at(-1).body, /name="user"\r\n\r\nemployee/);
    });
    await t.test("native invoice proxy forwards verified employee identity and JSON body", async () => {
      await fetch(`${base}/invoice-proxy/api/invoices/example`, { method: "POST", headers: {
        ...cloudHeaders, "Content-Type": "application/json",
      }, body: JSON.stringify({ example: true }) });
      assert.equal(calls.at(-1).headers["remote-user"], "employee");
      assert.equal(decodeURIComponent(calls.at(-1).headers["remote-name"]), "员工");
      assert.deepEqual(JSON.parse(calls.at(-1).body), { example: true });
    });
    await t.test("unmatched and unavailable identities stop before a workflow or upload", async () => {
      for (const name of ["unknown", "unavailable"]) {
        const before = calls.filter((call) => call.url === "/v1/chat-messages").length;
        const response = await chat({ ...cloudHeaders, "remote-name": name });
        assert.equal(response.status, name === "unknown" ? 409 : 503);
        assert.equal((await response.json()).message, "身份核验失败");
        assert.equal(calls.filter((call) => call.url === "/v1/chat-messages").length, before);
      }
    });
    await t.test("old provider conversation is checked before workflow execution; valid employee conversations continue", async () => {
      const before = calls.filter((call) => call.url === "/v1/chat-messages").length;
      assert.equal((await chat(cloudHeaders, { conversation_id: "legacy-conversation" })).status, 200);
      const newCalls = calls.filter((call) => call.url === "/v1/chat-messages").slice(before).map((call) => JSON.parse(call.body));
      assert.equal(newCalls.length, 1);
      assert.equal(newCalls[0].conversation_id, "");
      assert.ok(newCalls.every((call) => call.user === "employee"));
      const ownership = calls.find((call) => call.url.startsWith("/v1/messages?"));
      assert.equal(new URL(ownership.url, "http://upstream.invalid").searchParams.get("user"), "employee");
      assert.equal((await chat(cloudHeaders, { conversation_id: "employee-conversation" })).status, 200);
      assert.equal(JSON.parse(calls.at(-1).body).conversation_id, "employee-conversation");
      const ordinaryBefore = calls.length;
      assert.equal((await chat({ "remote-user": "employee" }, { conversation_id: "legacy-conversation" })).status, 404);
      assert.equal(calls.length, ordinaryBefore + 1);
    });
    await t.test("ownership service outage does not start or repeat a workflow", async () => {
      const before = calls.filter((call) => call.url === "/v1/chat-messages").length;
      const response = await chat(cloudHeaders, { conversation_id: "unavailable" });
      assert.equal(response.status, 502);
      assert.match((await response.json()).message, /新建对话/);
      assert.equal(calls.filter((call) => call.url === "/v1/chat-messages").length, before);
    });
  } finally {
    child.kill("SIGTERM");
    await exited;
    await new Promise((resolve) => upstream.close(resolve));
    await rm(folder, { recursive: true, force: true });
  }
});
