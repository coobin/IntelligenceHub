import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("function stripThinkingContent("), source.indexOf("function normalizeCitationResources("));
const sendSource = source.slice(source.indexOf("const sendMessage = async (options = {}) => {"), source.indexOf('sendBtn.addEventListener("click", sendMessage);'));
const receipt = "✅ 发票识别完成，初步校验通过：\n- 发票号：TEST-001\n确认无误请回复「确认」提交。";
const confirmed = { status: "ok", message: "✅ 已确认提交报销，进入报销池。", invoice_id: 42 };
const decisionEvents = (decision) => [
  { event: "node_finished", data: { title: "confirmLatestInvoice", outputs: { json: [{ json: decision }] } } },
  { event: "message", answer: "an unrelated model reply" },
  { event: "message_end", conversation_id: "conversation" },
];

function element() {
  return { style: {}, children: [], listeners: {}, disabled: false,
    appendChild(child) { this.children.push(child); },
    addEventListener(name, callback) { this.listeners[name] = callback; },
  };
}

function response(events) {
  return { ok: true, body: new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")));
    controller.close();
  } }) };
}

function page({ history = [], text = "确认", responses = [] } = {}) {
  const requests = [];
  const replies = [];
  const saved = [];
  const context = vm.createContext({
    TextDecoder, console,
    requestInFlight: false,
    pendingMeetingAction: null,
    pendingMeetingContinuation: null,
    inputEl: { value: text, style: {}, focus() {} },
    uploadedFiles: [], chatHistory: history, latestRequestText: "",
    chatConversationId: "conversation",
    assistantPanel: { classList: { contains: () => true } },
    state: { user: "test-user" },
    window: {}, document: { createElement: element },
    attachPool: { style: {} }, messagesEl: { scrollTop: 0, scrollHeight: 10 },
    ensureDailySessionBeforeSend() {},
    setAssistantExpanded() {},
    escapeHtml: (value) => value,
    meetingQueryDateRange: () => null,
    meetingAvailabilityRequest: () => null,
    shouldClassifyMeetingAvailability: () => false,
    findMeetingUiPayload: () => null,
    findExpenseUiPayload: () => null,
    selectMeetingUiCandidate: () => null,
    filterMeetingUiByDateRange: () => null,
    normalizeCitationResources: () => [],
    EXPENSE_UI_START: "", EXPENSE_UI_END: "", MEETING_UI_START: "", MEETING_UI_END: "", CITATIONS_UI_START: "", CITATIONS_UI_END: "",
    appendMessage(role, message) {
      const node = element();
      node.textContent = message;
      if (role === "system") replies.push(node);
      return node;
    },
    renderSystemReply(node, message) { node.textContent = message; },
    rememberMessage(role, message) { saved.push({ role, message }); },
    setSessionControlsLocked(locked) { context.requestInFlight = locked; },
    fetch(url, options) {
      requests.push({ url, body: JSON.parse(options.body) });
      const next = responses.shift();
      return typeof next === "function" ? next() : Promise.resolve(response(next));
    },
  });
  vm.runInContext(`${helpers}\n${sendSource}\nglobalThis.send = sendMessage;`, context);
  return { context, requests, replies, saved, send: (options) => context.send(options) };
}

test("typed short confirmation uses the pending invoice receipt and actual tool response", async () => {
  const ui = page({ history: [{ role: "system", text: receipt }], responses: [decisionEvents(confirmed)] });
  const result = await ui.send();
  assert.equal(ui.requests[0].body.query, "确认报销");
  assert.equal(result.invoiceConfirmed, true);
  assert.equal(ui.replies.at(-1).textContent, confirmed.message);
  assert.equal(ui.saved.at(-1).message, confirmed.message);
});

test("short confirmation preserves meeting priority and requires an unresolved invoice", () => {
  const ui = page();
  const normalize = ui.context.invoiceConfirmationQuery;
  const history = [{ role: "system", text: receipt }];
  assert.equal(normalize("确认", history, { meetingAction: true }), "确认");
  assert.equal(normalize("确认", history, { hasFiles: true }), "确认");
  assert.equal(normalize("确认", []), "确认");
  assert.equal(normalize("确认预定", history), "确认预定");
  assert.equal(normalize("确认", [...history, { role: "system", text: confirmed.message }]), "确认");
  assert.equal(normalize("确认", [...history, { role: "system", text: "a failed generic reply" }]), "确认报销");
});

test("button waits for a successful tool response before marking the invoice confirmed", async () => {
  let complete;
  const ui = page({ text: "上传发票", responses: [
    [{ event: "message", answer: receipt }, { event: "message_end" }],
    () => new Promise((resolve) => { complete = resolve; }),
  ] });
  await ui.send();
  const bar = ui.replies[0].children[0];
  const button = bar.children[0];
  const click = button.listeners.click();
  assert.equal(button.textContent, "正在确认...");
  assert.equal(button.disabled, true);
  assert.equal(ui.requests[1].body.query, "确认报销");
  complete(response(decisionEvents(confirmed)));
  await click;
  assert.equal(button.textContent, "已确认报销");
  assert.equal(button.disabled, true);
});

test("failed confirmation is displayed and its button can be retried", async () => {
  const failure = { status: "error", message: "没有待确认的发票。" };
  const ui = page({ text: "上传发票", responses: [
    [{ event: "message", answer: receipt }, { event: "message_end" }],
    decisionEvents(failure),
  ] });
  await ui.send();
  const bar = ui.replies[0].children[0];
  await bar.children[0].listeners.click();
  assert.equal(ui.replies.at(-1).textContent, failure.message);
  assert.equal(bar.children[0].textContent, "重试确认");
  assert.equal(bar.children[0].disabled, false);
  assert.equal(bar.children[1].disabled, false);
});

test("an LLM reply without a confirmation tool result cannot claim success", async () => {
  const ui = page({ text: "确认报销", responses: [[
    { event: "message", answer: "✅ 已确认提交报销，进入报销池。" },
    { event: "message_end" },
  ]] });
  const result = await ui.send();
  assert.equal(result, undefined);
  assert.equal(ui.replies.at(-1).textContent, "报销确认未完成，请重试或联系管理员。");
});
