import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Exercise the production stream loop with a real ReadableStream and a small
// browser surface, without executing the rest of the page's initialization.
const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const helpers = source.slice(
  source.indexOf("function assistantStreamError("),
  source.indexOf("function normalizeCitationResources("),
);
const streamLoop = source.slice(
  source.indexOf("const reader = response.body.getReader();"),
  source.indexOf("const cleanFullReply = stripThinkingContent(fullReply, true);"),
);
assert.ok(helpers.includes("assistantErrorMessage"));
assert.ok(streamLoop.includes("assistantStreamError"));

async function consume(events, { split = false } = {}) {
  const saved = [];
  const displayed = { innerHTML: "", textContent: "" };
  let cancelled = false;
  const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  const stream = new ReadableStream({
      start(controller) {
        if (split) {
          for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7));
        } else {
          controller.enqueue(bytes);
        }
        controller.close();
      },
  });
  const response = { body: { getReader() {
    const reader = stream.getReader();
    return {
      read: () => reader.read(),
      cancel: () => { cancelled = true; return reader.cancel(); },
    };
  } } };
  const context = vm.createContext({
    response, displayed, TextDecoder,
    replyContentDiv: displayed,
    messagesEl: { scrollTop: 0, scrollHeight: 1 },
    holdStructuredCardStream: false,
    findMeetingUiPayload: () => null,
    findExpenseUiPayload: () => null,
    normalizeCitationResources: () => [],
    stripThinkingContent: (text) => text,
    renderSystemReply: (_element, text) => { displayed.textContent = text; },
    rememberMessage: (role, text) => saved.push({ role, text }),
  });
  const result = await vm.runInContext(`${helpers}\n(async () => {
    let chatConversationId = "";
    ${streamLoop}
    return { reply: fullReply, conversationId: chatConversationId };
  })()`, context);
  return { result, saved, displayed, cancelled };
}

test("failed workflow shows the attachment error when no message arrives", async () => {
  const output = await consume([
    { event: "workflow_started", data: { id: "run" } },
    { event: "workflow_finished", data: { status: "failed", error: "Invalid serial index: must be <= 0, got 1" } },
  ], { split: true });
  assert.equal(output.displayed.textContent, "犇犇助手未能处理上传的附件，请联系管理员。");
  assert.deepEqual(output.saved, [{ role: "system", text: output.displayed.textContent }]);
  assert.equal(output.cancelled, true);
});

test("failed workflow replaces an incomplete reply instead of presenting success", async () => {
  const output = await consume([
    { event: "message", answer: "开始处理" },
    { event: "workflow_finished", data: { status: "failed", error: "Model deepseek-chat not exist." } },
  ]);
  assert.equal(output.displayed.textContent, "犇犇助手暂时无法回复：AI 模型配置异常，请联系管理员。");
  assert.equal(output.saved.length, 1);
  assert.equal(output.cancelled, true);
});

test("ordinary error events retain their existing useful messages", async () => {
  const output = await consume([{ event: "error", code: "rate_limit", message: "Rate limit exceeded" }]);
  assert.match(output.displayed.textContent, /额度或频率受限/);
  assert.equal(output.cancelled, true);
});

test("recoverable node failure and a successful workflow keep the reply", async () => {
  const output = await consume([
    { event: "node_finished", data: { status: "failed", error: "handled by fallback" } },
    { event: "message", answer: "识别完成，请确认" },
    { event: "workflow_finished", data: { status: "succeeded" } },
    { event: "message_end", conversation_id: "existing-conversation" },
  ], { split: true });
  assert.equal(output.result.reply, "识别完成，请确认");
  assert.equal(output.result.conversationId, "existing-conversation");
  assert.equal(output.saved.length, 0);
  assert.equal(output.cancelled, false);
});

test("unknown workflow errors do not expose internal diagnostics", async () => {
  const output = await consume([
    { event: "workflow_finished", data: { status: "failed", error: "internal endpoint and request details" } },
  ]);
  assert.equal(output.displayed.textContent, "犇犇助手处理失败，请联系管理员。");
  assert.equal(output.cancelled, true);
});
