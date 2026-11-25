import assert from "node:assert/strict";
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
  assert.equal((await rooms.json()).text, "已查询会议室空闲时段");
  const policy = await fetch(base + "/api/new/chat", { method: "POST",
    headers: { "Content-Type": "application/json", "Remote-User": "first", Origin: process.env.PORTAL_ORIGIN, Cookie: "authelia_session=test" },
    body: JSON.stringify({ query: "差旅制度", session: "policy" }) });
  assert.deepEqual((await policy.json()).citations, [{ documentName: "差旅", content: "出差应事先批准。" }]);
});
