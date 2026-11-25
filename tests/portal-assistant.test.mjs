import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import multer from "multer";
import { installPortalAssistant } from "../portal-assistant.js";

test("portal scopes confirmation to employee and conversation and consumes it once", async t => {
  const upstream = express();
  upstream.use(express.json());
  let writes = 0;
  upstream.post("/mcp", (req, res) => {
    assert.equal(req.headers.cookie, "authelia_session=test");
    const { method, params, id } = req.body;
    if (method === "notifications/initialized") return res.sendStatus(202);
    let result;
    if (method === "initialize") result = { protocolVersion: "2025-06-18" };
    if (method === "tools/list") result = { tools: ["meet_preview_booking", "meet_confirm_booking"].map(name => ({
      name, inputSchema: { type: "object" },
    })) };
    if (method === "tools/call") {
      if (params.name === "invoice_list_reimbursements") {
        const records = [{ amount: "123.45", billing_periods: ["202605", "202606"], status: "archived", created_at: "2026-07-01" }];
        return res.json({ id, jsonrpc: "2.0", result: { structuredContent: { status: "succeeded",
          summary: "共两条记录", data: { records, page: 1, total: 2 } } } });
      }
      if (params.name === "meet_list_meetings") {
        const meetings = [{ date: params.arguments.date, title: "例会", attendees: [{ name: "测试" }], start: "10:00", end: "11:00" }];
        return res.json({ id, jsonrpc: "2.0", result: { structuredContent: { status: "succeeded",
          summary: "共一场会议", data: { meetings } } } });
      }
      if (params.name === "meet_check_availability") {
        assert.deepEqual(params.arguments, { date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()) });
        return res.json({ id, jsonrpc: "2.0", result: { structuredContent: { status: "succeeded",
          summary: "已查询会议室空闲时段", data: { rooms: [] } } } });
      }
      if (params.name === "policy_search") {
        assert.equal(params.arguments.query, "差旅制度");
        return res.json({ id, jsonrpc: "2.0", result: { structuredContent: { status: "succeeded",
          summary: "制度", data: { citations: [{ documentName: "差旅", content: "出差应事先批准。" }] } } } });
      }
      if (params.name === "meet_confirm_booking") {
        writes++;
        assert.deepEqual(params.arguments, { operation_id: "preview-1" });
      }
      result = { structuredContent: { status: writes ? "succeeded" : "pending_confirmation",
        summary: writes ? "已预约" : "请确认", data: { operation_id: "preview-1" } } };
    }
    res.json({ result, id, jsonrpc: "2.0" });
  });
  upstream.post("/chat/completions", (req, res) => {
    assert.ok(!req.body.tools.some(tool => tool.function.name.includes("confirm")));
    res.json({ choices: [{ message: { tool_calls: [{ function: { name: "meet_preview_booking", arguments: "{}" } }] } }] });
  });
  const listen = async app => {
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => server.close());
    return `http://127.0.0.1:${server.address().port}`;
  };
  const upstreamUrl = await listen(upstream);
  Object.assign(process.env, { PORTAL_MCP_URL: upstreamUrl + "/mcp", PORTAL_MCP_SECRET: "test",
    PORTAL_MODEL_BASE: upstreamUrl, PORTAL_MODEL_KEY: "test", PORTAL_MODEL: "test", PORTAL_ORIGIN: "https://portal.example", PORTAL_PROXY_IPS: "127.0.0.1" });
  const app = express();
  app.use(express.json());
  installPortalAssistant(app, { assistantUser: req => req.headers["remote-user"], audioUpload: multer(), root: "." });
  const base = await listen(app);
  const chat = (user, session, confirm, query = confirm ? "确认" : "预约会议") => fetch(base + "/api/new/chat", { method: "POST",
    headers: { "Content-Type": "application/json", "Remote-User": user, Origin: process.env.PORTAL_ORIGIN, Cookie: "irrelevant=private; authelia_session=test" },
    body: JSON.stringify({ query, session, confirm }) });
  const preview = await (await chat("first", "one")).json();
  assert.ok(preview.confirm);
  assert.equal(writes, 0);
  assert.equal((await chat("second", "one", preview.confirm)).status, 409);
  assert.equal((await chat("first", "other", preview.confirm)).status, 409);
  assert.equal((await (await chat("first", "one", preview.confirm)).json()).status, "succeeded");
  assert.equal((await chat("first", "one", preview.confirm)).status, 409);
  assert.equal(writes, 1);
  delete process.env.PORTAL_MODEL_KEY;
  const rooms = await chat("first", "rooms", undefined, "今天的会议室情况是啥？");
  const empty = await rooms.json();
  assert.equal(empty.text, "已查询会议室空闲时段");
  assert.equal(empty.card.type, "availability_empty");
  const expense = (await (await chat("first", "expense", undefined, "查询我的通讯费报销记录")).json()).card;
  assert.equal(expense.type, "invoice_list");
  assert.equal(expense.range.label, "第 1 页 · 共 2 条");
  assert.equal(expense.summary.invoiceAmount, 123.45);
  assert.deepEqual(expense.records[0].periods, ["202605", "202606"]);
  assert.equal(expense.records[0].status, "已归档");
  const meeting = (await (await chat("first", "meetings", undefined, "查一下我今天的会议")).json()).card;
  assert.equal(meeting.type, "query_results");
  assert.equal(meeting.meetings[0].attendeeCount, 1);
  const policy = await fetch(base + "/api/new/chat", { method: "POST",
    headers: { "Content-Type": "application/json", "Remote-User": "first", Origin: process.env.PORTAL_ORIGIN, Cookie: "authelia_session=test" },
    body: JSON.stringify({ query: "差旅制度", session: "policy" }) });
  assert.deepEqual((await policy.json()).citations, [{ documentName: "差旅", content: "出差应事先批准。" }]);
});

test("portal persists sanitized chat logs, prunes expired files, and exposes admin query APIs", async testContext => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cih-chat-logs-"));
  testContext.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const expiredFile = path.join(tempDir, "2020-01-01.jsonl");
  fs.writeFileSync(expiredFile, JSON.stringify({ user: "old", query: "stale" }) + "\n");

  const upstream = express();
  upstream.use(express.json());
  let modelStep = 0;
  upstream.post("/mcp", (req, res) => {
    const { method, params, id } = req.body;
    if (method === "notifications/initialized") return res.sendStatus(202);
    if (method === "initialize") return res.json({ id, jsonrpc: "2.0", result: { protocolVersion: "2025-06-18" } });
    if (method === "tools/list") {
      return res.json({ id, jsonrpc: "2.0", result: { tools: [
        { name: "meet_check_availability", inputSchema: { type: "object" } },
        { name: "policy_search", inputSchema: { type: "object" } },
      ] } });
    }
    if (method === "tools/call" && params.name === "meet_check_availability") {
      return res.json({ id, jsonrpc: "2.0", result: { structuredContent: {
        status: "succeeded",
        summary: "已查询空闲会议室",
        trace_id: "trace-room-001",
        data: { rooms: [{ room: { name: "D01" }, freeSlots: [{ start: "10:00", end: "11:00" }] }] },
      } } });
    }
    res.json({ id, jsonrpc: "2.0", result: { structuredContent: { status: "succeeded", summary: "ok", data: {} } } });
  });
  upstream.post("/chat/completions", (req, res) => {
    modelStep += 1;
    if (modelStep === 1) {
      return res.json({
        choices: [{ message: { tool_calls: [{ id: "tc-1", function: { name: "meet_check_availability", arguments: "{\"date\":\"2026-11-26\"}" } }] } }],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      });
    }
    res.json({
      choices: [{ message: { content: "明天 D01 10:00-11:00 空闲。" } }],
      usage: { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 },
    });
  });

  const listen = async app => {
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    testContext.after(() => server.close());
    return `http://127.0.0.1:${server.address().port}`;
  };
  const upstreamUrl = await listen(upstream);
  Object.assign(process.env, {
    PORTAL_MCP_URL: upstreamUrl + "/mcp",
    PORTAL_MCP_SECRET: "secret-mcp-token-xyz",
    PORTAL_MODEL_BASE: upstreamUrl,
    PORTAL_MODEL_KEY: "secret-model-key-xyz",
    PORTAL_MODEL: "deepseek-v4-flash",
    PORTAL_ORIGIN: "https://portal.example",
    PORTAL_PROXY_IPS: "127.0.0.1",
    PORTAL_CHAT_LOG_DAYS: "30",
  });

  const app = express();
  app.use(express.json());
  const authenticate = (req, res, next) => req.headers["remote-user"] === "admin" ? next() : res.status(401).json({ message: "Unauthorized" });
  installPortalAssistant(app, {
    assistantUser: req => req.headers["remote-user"],
    assistantDisplayName: req => req.headers["remote-name"] || req.headers["remote-user"],
    audioUpload: multer(),
    authenticate,
    chatLogDir: tempDir,
  });
  const base = await listen(app);

  const postChat = (user, name, session, query) => fetch(base + "/api/new/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Remote-User": user,
      "Remote-Name": name,
      Origin: process.env.PORTAL_ORIGIN,
      Cookie: "authelia_session=secret-cookie-val",
    },
    body: JSON.stringify({ query, session }),
  });

  const firstTurn = await postChat("alice", "Alice", "sess-1", "明天有哪些会议室空闲？");
  assert.equal(firstTurn.status, 200);
  const reply = await firstTurn.json();
  assert.equal(reply.text, "明天 D01 10:00-11:00 空闲。");
  assert.equal(reply.card.rooms[0].freeSlots[0].start, "10:00");
  assert.equal(reply.showAnswer, true);

  const secondTurn = await postChat("alice", "Alice", "sess-1", "今天的会议室情况是啥？");
  assert.equal(secondTurn.status, 200);

  const thirdTurn = await postChat("bob", "Bob", "sess-2", "确认");
  assert.equal(thirdTurn.status, 200);

  assert.equal(fs.existsSync(expiredFile), false, "expired log file should be pruned");
  const writtenFiles = fs.readdirSync(tempDir).filter(name => name.endsWith(".jsonl"));
  assert.equal(writtenFiles.length, 1);
  const rawLog = fs.readFileSync(path.join(tempDir, writtenFiles[0]), "utf8");
  assert.equal(rawLog.includes("secret-model-key-xyz"), false);
  assert.equal(rawLog.includes("secret-mcp-token-xyz"), false);
  assert.equal(rawLog.includes("secret-cookie-val"), false);

  assert.equal((await fetch(base + "/api/admin/chat-logs", { headers: { "Remote-User": "alice" } })).status, 401);
  assert.equal((await fetch(base + "/api/admin/chat-logs/session?user=alice&session=sess-1", { headers: { "Remote-User": "alice" } })).status, 401);

  const listRes = await fetch(base + "/api/admin/chat-logs?days=7", { headers: { "Remote-User": "admin" } });
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.equal(listBody.retentionDays, 30);
  assert.equal(listBody.summary.totalTurns, 3);
  assert.equal(listBody.summary.uniqueUsers, 2);
  assert.equal(listBody.summary.uniqueSessions, 2);
  assert.equal(listBody.summary.totalTokens, 630);
  assert.equal(listBody.summary.promptTokens, 520);
  assert.equal(listBody.summary.completionTokens, 110);

  const traceSearch = await fetch(base + "/api/admin/chat-logs?q=trace-room-001", { headers: { "Remote-User": "admin" } });
  const traceBody = await traceSearch.json();
  assert.equal(traceBody.total, 2);
  assert.equal(traceBody.items.some(item => item.route === "model" && item.tools[0]?.traceId === "trace-room-001"), true);

  const sessionRes = await fetch(base + "/api/admin/chat-logs/session?user=alice&session=sess-1", { headers: { "Remote-User": "admin" } });
  assert.equal(sessionRes.status, 200);
  const sessionBody = await sessionRes.json();
  assert.equal(sessionBody.totalTurns, 2);
  assert.equal(sessionBody.items[0].query, "明天有哪些会议室空闲？");
  assert.equal(sessionBody.items[1].query, "今天的会议室情况是啥？");
});
