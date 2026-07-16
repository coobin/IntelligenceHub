const typeLabels = {
  h5: "H5",
  client: "客户端",
  tool: "工具",
  website: "网址"
};

const iconMapping = {
  "邮件": "mail",
  "邮箱": "mail",
  "办公": "briefcase",
  "钉钉": "message-square",
  "微信": "message-circle",
  "代码": "code",
  "开发": "terminal",
  "文档": "file-text",
  "制度": "scroll",
  "知识": "book-open",
  "搜索": "search",
  "盘": "hard-drive",
  "云": "cloud",
  "存储": "database",
  "设计": "palette",
  "图片": "image",
  "视频": "video",
  "会议": "video",
  "财务": "credit-card",
  "审批": "check-square",
  "假": "calendar",
  "打卡": "map-pin",
  "设置": "settings",
  "工具": "tool",
  "助手": "bot",
  "问答": "message-circle-question"
};

function getIcon(name, customIcon) {
  if (customIcon) return customIcon;
  for (const key in iconMapping) {
    if (name.includes(key)) return iconMapping[key];
  }
  return "layout-grid"; // 默认图标
}

const state = {
  catalog: [],
  activeSection: "all",
  query: ""
};

const sectionNav = document.querySelector("#sectionNav");
const catalogArea = document.querySelector("#catalogArea");
const searchInput = document.querySelector("#globalSearch");
const assistantToggle = document.querySelector("#assistantToggle");
const assistantClose = document.querySelector("#assistantClose");
const assistantPanel = document.querySelector("#assistantPanel");
const adminEntry = document.querySelector("#adminEntry");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function safeUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "#";
  const schemeMatch = url.match(/^([a-z][a-z0-9+.-]*):/i);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    return ["javascript", "data", "vbscript", "file", "blob"].includes(scheme) ? "#" : url;
  }
  if (/^(\/|\.\/|\.\.\/|data\/icons\/|assets\/)/.test(url)) return url;
  return "#";
}

function safeHttpUrl(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "#";
}

function renderActions(item) {
  const actions = Array.isArray(item.actions) ? item.actions : [];
  if (actions.length === 0) return "";

  return `
    <span class="card-actions">
      ${actions.map((action) => `
        <a class="card-action-link" href="${escapeAttribute(safeUrl(action.url))}" data-track-name="${escapeAttribute(action.trackName || action.label || item.name)}" ${action.download ? "download" : ""}>
          ${action.icon ? `<i data-lucide="${escapeAttribute(action.icon)}"></i>` : ""}
          <span>${escapeHtml(action.label)}</span>
        </a>
        ${action.note ? `
          <span class="card-action-note" title="${escapeAttribute(action.note)}" aria-label="${escapeAttribute(action.note)}" role="img">
            <i data-lucide="circle-alert"></i>
          </span>
        ` : ""}
      `).join("")}
    </span>
  `;
}

function applyBranding() {
  const c = window.IntelligenceHubConfig || {};
  const setText = (sel, val) => { const el = document.querySelector(sel); if (el && val) el.textContent = val; };
  if (c.siteTitle) document.title = c.siteTitle;
  setText(".brand-name", c.brandName);
  setText(".brand-subtitle", c.brandSubtitle);
  setText(".topbar h1", c.brandName);
  setText(".assistant-fab-mark", c.assistantName);
  if (c.assistantName) setText(".assistant-message-system .assistant-message-content", `你好！我是${c.assistantName}，有什么我可以帮您的吗？`);
  if (c.poweredBy) setText(".assistant-footer", `POWERED BY ${c.poweredBy}`);

  const photoWrap = document.querySelector(".daily-photo-display");
  const photoImg = photoWrap && photoWrap.querySelector("img");
  if (photoWrap) {
    if (c.dailyPhotoUrl && photoImg) {
      photoImg.src = c.dailyPhotoUrl;
    } else {
      photoWrap.style.display = "none";
    }
  }
}

async function bootstrap() {
  await loadConfigs();
  applyBranding();
  const response = await fetch("./data/catalog.json", { cache: "no-store" });
  const data = await response.json();
  state.catalog = data.sections;
  
  try {
    const authRes = await fetch("/api/check-auth", { cache: "no-store" });
    if (authRes.ok) {
      const authData = await authRes.json();
      state.user = authData.user || "";
    }
  } catch(e) {}

  renderNavigation();
  renderCatalog();
  renderAssistant();
  initPhotoViewer();
  registerServiceWorker();
  trackEvent("pageview");
}

async function trackEvent(type, target) {
  console.log(`[App] Tracking event: ${type} - ${target}`);
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, target }),
      keepalive: true
    });
  } catch (err) {
    console.error("[App] Tracking error:", err);
  }
}
window.trackEvent = trackEvent;

function initPhotoViewer() {
  const photoDisplay = document.querySelector(".daily-photo-display img");
  const viewer = document.querySelector("#photoViewer");
  const viewerImg = document.querySelector("#photoViewerImg");
  const viewerClose = document.querySelector("#photoViewerClose");
  const viewerOverlay = document.querySelector("#photoViewerOverlay");

  if (!photoDisplay || !viewer || !viewerImg) return;

  const openViewer = () => {
    // 使用预览图地址
    viewerImg.src = photoDisplay.src;
    viewer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden"; // 禁止滚动
  };

  const closeViewer = () => {
    viewer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    // 延迟清空 src 避免下次打开闪烁旧图
    setTimeout(() => {
      if (viewer.getAttribute("aria-hidden") === "true") {
        viewerImg.src = "";
      }
    }, 300);
  };

  photoDisplay.addEventListener("click", openViewer);
  viewerClose.addEventListener("click", closeViewer);
  viewerOverlay.addEventListener("click", closeViewer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && viewer.getAttribute("aria-hidden") === "false") {
      closeViewer();
    }
  });
}

async function loadConfigs() {
  const load = (src) => new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = `${src}?t=${Date.now()}`;
    script.onload = resolve;
    script.onerror = resolve;
    document.head.append(script);
  });

  await load("./config.js");
  await load("./config.local.js");
}

function renderNavigation() {
  const total = state.catalog.reduce((sum, section) => sum + section.items.length, 0);
  const navItems = [
    { id: "all", title: "全部入口", count: total },
    ...state.catalog.map((section) => ({ id: section.id, title: section.title, count: section.items.length }))
  ];

  sectionNav.innerHTML = navItems.map((item) => `
    <button class="nav-button ${item.id === state.activeSection ? "active" : ""}" data-section="${escapeAttribute(item.id)}">
      <span>${escapeHtml(item.title)}</span>
      <span class="nav-count">${item.count}</span>
    </button>
  `).join("");

  sectionNav.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeSection = button.dataset.section;
      renderNavigation();
      renderCatalog();
    });
  });
}

function renderCatalog() {
  const filteredSections = state.catalog
    .filter((section) => state.activeSection === "all" || section.id === state.activeSection)
    .map((section) => ({ ...section, items: section.items }))
    .filter((section) => section.items.length > 0);

  if (filteredSections.length === 0) {
    catalogArea.innerHTML = `<div class="empty-state">未找到匹配的入口，请调整关键词或分类。</div>`;
    return;
  }

  catalogArea.innerHTML = filteredSections.map((section) => `
    <section class="catalog-section" id="section-${escapeAttribute(section.id)}">
      <div class="section-heading">
        <div>
          <h2>${escapeHtml(section.title)}</h2>
          ${section.description ? `<p>${escapeHtml(section.description)}</p>` : ""}
        </div>
        <span class="status-text">${section.items.length} 项</span>
      </div>
      <div class="item-grid">
        ${section.items.map(renderCard).join("")}
      </div>
    </section>
  `).join("");
  
  // 初始化 Lucide 图标
  if (window.lucide) {
    window.lucide.createIcons();
  }
}


function renderCard(item) {
  const typeClass = `type-${item.type}`;
  const label = typeLabels[item.type] || item.type;
  const isExternal = ["h5", "website", "tool"].includes(item.type);
  const target = isExternal ? 'target="_blank" rel="noopener noreferrer"' : "";
  const iconName = getIcon(item.name, item.icon);
  
  // 判断是 Lucide 图标还是图片路径
  const isImageIcon = iconName && (iconName.includes("/") || iconName.includes("."));
  const iconHtml = isImageIcon 
    ? `<img src="${escapeAttribute(safeUrl(iconName))}" alt="" style="width: 24px; height: 24px; object-fit: contain;">`
    : `<i data-lucide="${escapeAttribute(iconName)}"></i>`;
  const itemName = escapeHtml(item.name);
  const itemDescription = escapeHtml(item.description);
  const actionsHtml = renderActions(item);
  const detailHtml = item.description
    ? `<p>${itemDescription}</p>`
    : actionsHtml;
  const itemUrl = escapeAttribute(safeUrl(item.url));

  return `
    <article class="hub-resource-card">
      <a class="resource-card-link" href="${itemUrl}" ${target} data-track-name="${escapeAttribute(item.name)}" aria-label="${escapeAttribute(item.name)}"></a>
      <div class="card-icon">
        ${iconHtml}
      </div>
      <div class="card-content">
        <div class="card-top">
          <h3>${itemName}</h3>
          <span class="type-pill ${escapeAttribute(typeClass)}">${escapeHtml(label)}</span>
        </div>
        ${detailHtml}
      </div>
    </article>
  `;
}

let chatConversationId = "";

const MEETING_UI_START = "[CHENCY_MEETING_UI]";
const MEETING_UI_END = "[/CHENCY_MEETING_UI]";

function parseMeetingUiReply(text) {
  const source = String(text || "");
  const start = source.lastIndexOf(MEETING_UI_START);
  if (start === -1) return { cleanText: source, ui: null };
  const end = source.indexOf(MEETING_UI_END, start + MEETING_UI_START.length);
  const cleanText = source.slice(0, start).trim();
  if (end === -1) return { cleanText, ui: null };
  try {
    const raw = source.slice(start + MEETING_UI_START.length, end).trim();
    const ui = JSON.parse(raw);
    return ui && ui.schema === "chency.meeting.v1" ? { cleanText, ui } : { cleanText: source, ui: null };
  } catch (error) {
    console.warn("[Meeting UI] invalid payload", error);
    return { cleanText: source, ui: null };
  }
}

function formatMeetingDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  if (!match) return String(date || "日期待定");
  const value = new Date(`${date}T12:00:00`);
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(value);
  return `${Number(match[2])}月${Number(match[3])}日 ${weekday}`;
}

function meetingDurationLabel(meeting) {
  const toMinutes = (value) => {
    const [hours, minutes] = String(value || "").split(":").map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 0;
  };
  const duration = toMinutes(meeting?.end) - toMinutes(meeting?.start);
  if (duration <= 0) return "";
  if (duration % 60 === 0) return `${duration / 60} 小时`;
  if (duration > 60) return `${Math.floor(duration / 60)} 小时 ${duration % 60} 分钟`;
  return `${duration} 分钟`;
}

function meetingStatusCopy(ui) {
  const mapping = {
    booking_preview: ["待确认", "尚未预定", "calendar-clock"],
    booking_success: ["已完成", "已写入日程", "circle-check-big"],
    booking_conflict: ["时间冲突", "本次未预定", "calendar-x-2"],
    booking_needs_info: ["需要补充", "尚未预定", "circle-help"],
    cancel_preview: ["待确认", "会议仍保留", "triangle-alert"],
    cancel_candidates: ["请选择", "会议仍保留", "list-checks"],
    cancel_success: ["已完成", "时段已释放", "circle-check-big"],
    cancel_not_found: ["未找到", "没有执行取消", "search-x"],
    confirmation_error: ["操作未执行", "请重新发起", "shield-alert"],
    query_results: ["会议日程", `${Number(ui?.meta?.count || ui?.meetings?.length || 0)} 场`, "calendar-range"],
    query_empty: ["会议日程", "暂无会议", "calendar-search"],
  };
  return mapping[ui?.type] || ["会议助手", "", "calendar-days"];
}

function renderMeetingTicket(meeting, options = {}) {
  if (!meeting) return "";
  const attendeeText = meeting.attendeeCount
    ? `${meeting.attendeeCount} 位参会对象`
    : "未添加参会人";
  const summary = meeting.summary
    ? `<p class="meeting-ticket-summary">${escapeHtml(meeting.summary)}</p>`
    : "";
  const cancelButton = options.cancelToken
    ? `<button class="meeting-text-action meeting-action-preview-cancel" type="button" data-token="${escapeAttribute(options.cancelToken)}" data-meeting-id="${escapeAttribute(meeting.id)}">取消这场</button>`
    : "";

  return `
    <article class="meeting-ticket">
      <div class="meeting-time-rail" aria-hidden="true"><span></span><i></i><span></span></div>
      <div class="meeting-ticket-body">
        <div class="meeting-ticket-date-row">
          <span class="meeting-ticket-date">${escapeHtml(formatMeetingDate(meeting.date))}</span>
          <span class="meeting-room-chip"><i data-lucide="map-pin"></i>${escapeHtml(meeting.roomName || "会议室待定")}</span>
        </div>
        <h4>${escapeHtml(meeting.title || "无主题会议")}</h4>
        <div class="meeting-ticket-time"><strong>${escapeHtml(meeting.start || "--:--")}</strong><span>—</span><strong>${escapeHtml(meeting.end || "--:--")}</strong></div>
        <div class="meeting-ticket-meta">
          <span><i data-lucide="user-round"></i>${escapeHtml(meeting.organizerName || "组织人待定")}</span>
          <span><i data-lucide="clock-3"></i>${escapeHtml(meetingDurationLabel(meeting))}</span>
          <span><i data-lucide="users-round"></i>${escapeHtml(attendeeText)}</span>
        </div>
        ${summary}
        ${cancelButton ? `<div class="meeting-ticket-inline-action">${cancelButton}</div>` : ""}
      </div>
    </article>
  `;
}

function renderMeetingList(ui) {
  const meetings = Array.isArray(ui.meetings) ? ui.meetings : [];
  if (!meetings.length) return "";
  const groups = meetings.reduce((result, meeting) => {
    const date = meeting.date || "日期待定";
    if (!result[date]) result[date] = [];
    result[date].push(meeting);
    return result;
  }, {});

  return Object.entries(groups).map(([date, items]) => `
    <section class="meeting-day-group">
      <div class="meeting-day-heading"><span>${escapeHtml(formatMeetingDate(date))}</span><span>${items.length} 场</span></div>
      <div class="meeting-day-list">
        ${items.map((meeting) => renderMeetingTicket(meeting, {
          cancelToken: (ui.type === "query_results" && meeting.canCancel) || ui.type === "cancel_candidates"
            ? meeting.actionToken
            : ""
        })).join("")}
      </div>
    </section>
  `).join("");
}

function renderMeetingUi(ui) {
  const [eyebrow, statusNote, icon] = meetingStatusCopy(ui);
  const status = ["pending", "success", "danger", "warning", "info"].includes(ui.status) ? ui.status : "info";
  const issues = Array.isArray(ui.issues) && ui.issues.length
    ? `<ul class="meeting-issues">${ui.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>`
    : "";
  const suggestions = Array.isArray(ui.suggestions) && ui.suggestions.length
    ? `<div class="meeting-suggestions"><span>可选时间</span><div>${ui.suggestions.map((slot) => `<button class="meeting-suggestion" type="button" data-date="${escapeAttribute(ui.meeting?.date || "")}" data-start="${escapeAttribute(slot.start)}" data-end="${escapeAttribute(slot.end)}">${escapeHtml(slot.start)}–${escapeHtml(slot.end)}</button>`).join("")}</div></div>`
    : "";
  const mainMeeting = ui.meeting ? renderMeetingTicket(ui.meeting) : "";
  const meetingList = renderMeetingList(ui);
  const isBookingPreview = ui.type === "booking_preview";
  const isCancelPreview = ui.type === "cancel_preview";
  const actionToken = ui.action?.token || "";
  const actions = isBookingPreview || isCancelPreview
    ? `
      <div class="meeting-ui-actions">
        <button class="meeting-primary-action meeting-action-confirm" type="button" data-operation="${isCancelPreview ? "cancel" : "book"}" data-token="${escapeAttribute(actionToken)}">
          ${escapeHtml(ui.action?.label || (isCancelPreview ? "确认取消" : "确认预定"))}
        </button>
        <button class="meeting-secondary-action ${isCancelPreview ? "meeting-action-dismiss" : "meeting-action-modify"}" type="button">
          ${isCancelPreview ? "保留会议" : "修改信息"}
        </button>
      </div>
    `
    : "";

  return `
    <section class="meeting-ui meeting-ui--${status}" data-meeting-ui="${escapeAttribute(ui.type)}">
      <header class="meeting-ui-header">
        <span class="meeting-ui-icon"><i data-lucide="${escapeAttribute(icon)}"></i></span>
        <span class="meeting-ui-heading"><small>${escapeHtml(eyebrow)}</small><strong>${escapeHtml(ui.title || "会议助手")}</strong></span>
        ${statusNote ? `<span class="meeting-ui-status-note">${escapeHtml(statusNote)}</span>` : ""}
      </header>
      <div class="meeting-ui-body">
        ${ui.message ? `<p class="meeting-ui-message">${escapeHtml(ui.message)}</p>` : ""}
        ${mainMeeting}
        ${meetingList}
        ${issues}
        ${suggestions}
        ${actions}
      </div>
    </section>
  `;
}

function renderAssistant() {
  const config = window.IntelligenceHubConfig || {};
  const title = config.assistantTitle || "智能问答";
  assistantToggle.setAttribute("aria-label", `打开${title}`);
  
  const inputEl = document.getElementById("assistantInput");
  const sendBtn = document.getElementById("assistantSendBtn");
  const messagesEl = document.getElementById("assistantMessages");
  const attachBtn = document.getElementById("difyAttachmentBtn");
  const attachInput = document.getElementById("difyAttachmentInput");
  const attachPool = document.getElementById("assistantAttachmentPool");
  
  let uploadedFiles = [];
  let pendingMeetingAction = null;

  if (!inputEl || !sendBtn || !messagesEl) return;
  
  if (attachBtn && attachInput && attachPool) {
    attachBtn.addEventListener("click", () => attachInput.click());
    
    attachInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;
      attachPool.style.display = "flex";
      
      for (const file of files) {
        const chip = document.createElement("div");
        chip.className = "attachment-chip uploading";
        chip.innerHTML = `
          <i data-lucide="loader"></i>
          <span class="filename">${escapeHtml(file.name)}</span>
          <button class="remove-btn" type="button" aria-label="移除">×</button>
        `;
        attachPool.appendChild(chip);
        if (window.lucide) window.lucide.createIcons();
        
        try {
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch("/api/chat/upload", { method: "POST", body: formData });
          const result = await res.json();
          if (result.success && result.file) {
            chip.classList.remove("uploading");
            chip.innerHTML = `
              <i data-lucide="${file.type.startsWith('image/') ? 'image' : 'file-text'}"></i>
              <span class="filename">${escapeHtml(file.name)}</span>
              <button class="remove-btn" type="button" aria-label="移除">×</button>
            `;
            if (window.lucide) window.lucide.createIcons();
            
            const fileObj = {
              type: file.type.startsWith("image/") ? "image" : "document",
              transfer_method: "local_file",
              upload_file_id: result.file.id,
              name: file.name,
              chipEl: chip
            };
            uploadedFiles.push(fileObj);
            
            chip.querySelector(".remove-btn").addEventListener("click", () => {
              uploadedFiles = uploadedFiles.filter(f => f.upload_file_id !== fileObj.upload_file_id);
              chip.remove();
              if (uploadedFiles.length === 0) attachPool.style.display = "none";
            });
          } else {
            throw new Error("Upload failed");
          }
        } catch (error) {
          console.error(error);
          chip.remove();
          if (uploadedFiles.length === 0) attachPool.style.display = "none";
        }
      }
      attachInput.value = "";
    });
  }
  
  const appendMessage = (role, text) => {
    const msgDiv = document.createElement("div");
    msgDiv.className = `assistant-message assistant-message-${role}`;
    const contentDiv = document.createElement("div");
    contentDiv.className = "assistant-message-content";
    msgDiv.appendChild(contentDiv);
    messagesEl.appendChild(msgDiv);
    
    if (role === "system") {
      contentDiv.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(window.marked.parse(text || "")) : text;
    } else {
      contentDiv.innerHTML = text; // allow HTML for user if it's our own formatting (like attachment chips)
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return contentDiv;
  };

  const lockMeetingCard = (root, label = "已处理") => {
    if (!root) return;
    root.classList.add("meeting-ui--resolved");
    root.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    const primary = root.querySelector(".meeting-primary-action");
    if (primary) primary.textContent = label;
  };

  const bindMeetingUiActions = (contentDiv, ui) => {
    const root = contentDiv.querySelector(".meeting-ui");
    if (!root) return;

    if ((ui.type === "booking_preview" || ui.type === "cancel_preview") && ui.action?.token) {
      pendingMeetingAction = {
        operation: ui.type === "cancel_preview" ? "cancel" : "book",
        token: ui.action.token,
        root,
      };
    } else if (["booking_success", "cancel_success", "booking_conflict", "confirmation_error"].includes(ui.type)) {
      pendingMeetingAction = null;
    }

    root.querySelectorAll(".meeting-action-confirm").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        const operation = button.dataset.operation === "cancel" ? "cancel" : "book";
        const token = button.dataset.token || "";
        const label = operation === "cancel" ? "确认取消" : "确认预定";
        lockMeetingCard(root, "正在确认...");
        pendingMeetingAction = null;
        sendMessage({
          queryText: label,
          displayText: label,
          meetingAction: { operation, token },
        });
      });
    });

    root.querySelectorAll(".meeting-action-dismiss").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        lockMeetingCard(root, "已保留会议");
        pendingMeetingAction = null;
        appendMessage("user", "保留会议");
      });
    });

    root.querySelectorAll(".meeting-action-modify").forEach((button) => {
      button.addEventListener("click", () => {
        const title = ui.meeting?.title ? `「${ui.meeting.title}」` : "这场会议";
        inputEl.value = `请把${title}修改为：`;
        inputEl.dispatchEvent(new Event("input"));
        inputEl.focus();
      });
    });

    root.querySelectorAll(".meeting-action-preview-cancel").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        const meeting = (ui.meetings || []).find((item) => item.id === button.dataset.meetingId);
        const token = button.dataset.token || meeting?.actionToken || "";
        if (!meeting || !token) return;
        appendMessage("user", "取消这场会议");
        const previewDiv = appendMessage("system", "");
        const previewUi = {
          schema: "chency.meeting.v1",
          type: "cancel_preview",
          status: "danger",
          title: "确认取消会议",
          message: "确认后将释放该会议室。",
          meeting,
          meetings: [],
          suggestions: [],
          issues: [],
          action: { kind: "confirm_cancel", label: "确认取消", token },
          meta: {},
        };
        previewDiv.classList.add("has-meeting-ui");
        previewDiv.innerHTML = renderMeetingUi(previewUi);
        bindMeetingUiActions(previewDiv, previewUi);
        if (window.lucide) window.lucide.createIcons();
        messagesEl.scrollTop = messagesEl.scrollHeight;
      });
    });

    root.querySelectorAll(".meeting-suggestion").forEach((button) => {
      button.addEventListener("click", () => {
        const title = ui.meeting?.title ? `「${ui.meeting.title}」` : "这场会议";
        const date = button.dataset.date ? `${button.dataset.date} ` : "";
        inputEl.value = `把${title}改到 ${date}${button.dataset.start}-${button.dataset.end}`;
        inputEl.dispatchEvent(new Event("input"));
        inputEl.focus();
      });
    });
  };

  const renderSystemReply = (contentDiv, text, complete = false) => {
    const parsed = parseMeetingUiReply(text);
    if (complete && parsed.ui) {
      contentDiv.parentElement?.classList.add("assistant-message-meeting");
      contentDiv.classList.add("has-meeting-ui");
      contentDiv.innerHTML = renderMeetingUi(parsed.ui);
      bindMeetingUiActions(contentDiv, parsed.ui);
      if (window.lucide) window.lucide.createIcons();
      return;
    }
    contentDiv.parentElement?.classList.remove("assistant-message-meeting");
    contentDiv.classList.remove("has-meeting-ui");
    const visibleText = parsed.cleanText || (complete ? text : "");
    contentDiv.innerHTML = window.DOMPurify
      ? window.DOMPurify.sanitize(window.marked.parse(visibleText || ""))
      : escapeHtml(visibleText || "");
  };

  // 语音输入：录音 -> /api/chat/audio (Dify audio-to-text) -> 填入输入框
  const micBtn = document.getElementById("assistantMicBtn");
  if (micBtn && navigator.mediaDevices?.getUserMedia && window.MediaRecorder) {
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;

    // 把解码后的 AudioBuffer 编码成 16bit 单声道 WAV（SenseVoice 只认 wav/mp3，
    // 而浏览器 MediaRecorder 只能录 webm/opus 或 mp4/aac，所以必须前端转码）
    const audioBufferToWavBlob = (buffer) => {
      const ch0 = buffer.getChannelData(0);
      let samples = ch0;
      if (buffer.numberOfChannels > 1) {
        const ch1 = buffer.getChannelData(1);
        samples = new Float32Array(ch0.length);
        for (let i = 0; i < ch0.length; i++) samples[i] = (ch0[i] + ch1[i]) / 2;
      }
      const sr = buffer.sampleRate;
      const dataLen = samples.length * 2;
      const view = new DataView(new ArrayBuffer(44 + dataLen));
      const wstr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
      wstr(0, "RIFF"); view.setUint32(4, 36 + dataLen, true); wstr(8, "WAVE");
      wstr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, sr, true); view.setUint32(28, sr * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      wstr(36, "data"); view.setUint32(40, dataLen, true);
      let off = 44;
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
      return new Blob([view], { type: "audio/wav" });
    };

    const setMicState = (recording, busy) => {
      isRecording = recording;
      micBtn.classList.toggle("recording", recording);
      micBtn.classList.toggle("loading", !!busy);
      micBtn.disabled = !!busy;
      micBtn.setAttribute("aria-label", recording ? "停止录音" : busy ? "识别中" : "语音输入");
      micBtn.innerHTML = `<i data-lucide="${busy ? "loader" : recording ? "square" : "mic"}"></i>`;
      if (window.lucide) window.lucide.createIcons();
    };

    const transcribe = async (blob, ext) => {
      setMicState(false, true);
      try {
        const formData = new FormData();
        formData.append("file", blob, `voice.${ext}`);
        const res = await fetch("/api/chat/audio", { method: "POST", body: formData });
        const result = await res.json();
        if (result.success && result.text?.trim()) {
          inputEl.value = (inputEl.value ? inputEl.value + " " : "") + result.text.trim();
          inputEl.dispatchEvent(new Event("input")); // 触发自动高度调整
          inputEl.focus();
        } else {
          throw new Error(result.message || "未识别到内容");
        }
      } catch (err) {
        console.error("[Voice] transcription error:", err);
        appendMessage("system", "语音识别失败，请重试或改用文字输入。");
      } finally {
        setMicState(false, false);
      }
    };

    const startRecording = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.addEventListener("dataavailable", (e) => {
          if (e.data.size > 0) audioChunks.push(e.data);
        });
        mediaRecorder.addEventListener("stop", async () => {
          stream.getTracks().forEach((t) => t.stop());
          const mime = mediaRecorder.mimeType || "audio/webm";
          const recorded = new Blob(audioChunks, { type: mime });
          if (recorded.size === 0) return setMicState(false, false);
          setMicState(false, true);
          try {
            // 解码录音 -> PCM -> 重新编码为 WAV（SenseVoice 不接受 webm/aac）
            const arrayBuf = await recorded.arrayBuffer();
            const Ctx = window.AudioContext || window.webkitAudioContext;
            const ctx = new Ctx();
            const audioBuf = await ctx.decodeAudioData(arrayBuf);
            ctx.close();
            const wavBlob = audioBufferToWavBlob(audioBuf);
            await transcribe(wavBlob, "wav");
          } catch (err) {
            console.error("[Voice] decode/encode error:", err);
            appendMessage("system", "语音处理失败，请重试或改用文字输入。");
            setMicState(false, false);
          }
        });
        mediaRecorder.start();
        setMicState(true, false);
      } catch (err) {
        console.error("[Voice] mic access error:", err);
        appendMessage("system", "无法访问麦克风，请检查浏览器权限设置。");
        setMicState(false, false);
      }
    };

    micBtn.addEventListener("click", () => {
      if (isRecording && mediaRecorder) {
        mediaRecorder.stop();
      } else if (!micBtn.disabled) {
        startRecording();
      }
    });
  } else if (micBtn) {
    micBtn.style.display = "none"; // 浏览器不支持录音 API，隐藏按钮
  }

  const sendMessage = async (options = {}) => {
    const typedText = inputEl.value.trim();
    let text = options.queryText !== undefined ? options.queryText : typedText;
    let displayText = options.displayText !== undefined ? options.displayText : typedText;

    if (options.queryText === undefined && pendingMeetingAction && /^(确认|确认预定|确认取消|确定|可以|没问题)[。！!\s]*$/.test(typedText)) {
      const label = pendingMeetingAction.operation === "cancel" ? "确认取消" : "确认预定";
      text = label;
      displayText = typedText || label;
      options.meetingAction = {
        operation: pendingMeetingAction.operation,
        token: pendingMeetingAction.token,
      };
      lockMeetingCard(pendingMeetingAction.root, "正在确认...");
      pendingMeetingAction = null;
    } else if (options.queryText === undefined && pendingMeetingAction && /^(不取消|保留|算了|暂不|放弃)[。！!\s]*$/.test(typedText)) {
      lockMeetingCard(pendingMeetingAction.root, "已保留会议");
      pendingMeetingAction = null;
      inputEl.value = "";
      appendMessage("user", escapeHtml(typedText));
      inputEl.focus();
      return;
    } else if (options.queryText === undefined && pendingMeetingAction && typedText) {
      pendingMeetingAction = null;
    }

    if (!text && uploadedFiles.length === 0) return;
    
    inputEl.value = "";
    inputEl.style.height = "auto";
    
    const sendFiles = uploadedFiles.map(f => ({
      type: f.type,
      transfer_method: f.transfer_method,
      upload_file_id: f.upload_file_id
    }));
    
    let userMessageHTML = escapeHtml(displayText);
    if (uploadedFiles.length > 0) {
      const fileNames = uploadedFiles.map(f => `<span style="display:inline-flex;align-items:center;background:#ffffff;color:#1e293b;border-radius:4px;padding:2px 6px;font-size:12px;margin:2px 4px 2px 0;"><i data-lucide="${f.type === 'image' ? 'image' : 'file-text'}" style="width:14px;height:14px;margin-right:4px;"></i>${escapeHtml(f.name)}</span>`).join("");
      userMessageHTML = `<div style="margin-bottom:6px;">${fileNames}</div>` + userMessageHTML;
      // 带附件一律强化为「通讯费发票报销」意图，避免分类器把它误判到通用问答(CLASS3)，
      // 导致附件没送到发票工具。界面气泡仍只显示文件名，不受影响。
      text = text ? `${text}（通讯费发票报销）` : "我要报销这张通讯费发票";
    }
    
    appendMessage("user", userMessageHTML);
    if (window.lucide) window.lucide.createIcons();
    
    uploadedFiles.forEach(f => f.chipEl.remove());
    uploadedFiles = [];
    if (attachPool) attachPool.style.display = "none";
    
    const replyContentDiv = appendMessage("system", "正在思考...");
    sendBtn.disabled = true;
    
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs: options.meetingAction ? {
            meeting_action: options.meetingAction.operation,
            meeting_confirmation_token: options.meetingAction.token,
          } : {},
          query: text,
          response_mode: "streaming",
          conversation_id: chatConversationId || "",
          user: state.user || "anonymous",
          files: sendFiles.length > 0 ? sendFiles : undefined
        })
      });
      
      if (!response.ok) throw new Error("API request failed");
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullReply = "";
      replyContentDiv.innerHTML = '<span class="assistant-typing" aria-label="思考中"><span class="assistant-typing-dot"></span><span class="assistant-typing-dot"></span><span class="assistant-typing-dot"></span></span>';
      
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep the last partial line
        
        for (const line of lines) {
          if (line.startsWith("data:")) {
            const dataStr = line.slice(5).trim();
            if (!dataStr || dataStr === "[DONE]") continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.event === "message" || data.event === "agent_message") {
                if (fullReply === "") replyContentDiv.innerHTML = "";
                fullReply += data.answer || "";
                renderSystemReply(replyContentDiv, fullReply, false);
                messagesEl.scrollTop = messagesEl.scrollHeight;
              } else if (data.event === "message_end" || data.event === "agent_message_end") {
                if (data.conversation_id) {
                  chatConversationId = data.conversation_id;
                }
              }
            } catch (e) {}
          }
        }
      }

      renderSystemReply(replyContentDiv, fullReply, true);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      // 合规回执后追加「确认报销 / 放弃」按钮
      if (/初步校验通过/.test(fullReply)) {
        const bar = document.createElement("div");
        bar.style.cssText = "margin-top:10px;display:flex;gap:8px;";
        const cbtn = document.createElement("button");
        cbtn.type = "button";
        cbtn.textContent = "✅ 确认报销";
        cbtn.style.cssText = "background:#2563eb;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:14px;font-weight:600;cursor:pointer;";
        const rbtn = document.createElement("button");
        rbtn.type = "button";
        rbtn.textContent = "放弃";
        rbtn.style.cssText = "background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;border-radius:8px;padding:8px 16px;font-size:14px;font-weight:600;cursor:pointer;";
        const lockBoth = () => {
          cbtn.disabled = true; rbtn.disabled = true;
          cbtn.style.opacity = "0.6"; rbtn.style.opacity = "0.6";
          cbtn.style.cursor = "default"; rbtn.style.cursor = "default";
        };
        cbtn.addEventListener("click", () => {
          if (cbtn.disabled) return;
          lockBoth();
          cbtn.textContent = "已提交确认";
          inputEl.value = "确认";
          sendMessage();
        });
        rbtn.addEventListener("click", async () => {
          if (rbtn.disabled) return;
          lockBoth();
          rbtn.textContent = "已放弃";
          appendMessage("user", "放弃");
          const sysDiv = appendMessage("system", "正在处理...");
          try {
            const r = await fetch("/invoice-proxy/api/invoices/dify/reject-latest", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ user_id: state.user || "" })
            });
            const d = await r.json();
            sysDiv.textContent = d.message || "已放弃本次报销。";
          } catch (e) {
            sysDiv.textContent = "操作失败，请稍后再试。";
          }
          messagesEl.scrollTop = messagesEl.scrollHeight;
        });
        bar.appendChild(cbtn);
        bar.appendChild(rbtn);
        replyContentDiv.appendChild(bar);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    } catch (err) {
      replyContentDiv.textContent = "抱歉，请求出错，请稍后再试。";
    } finally {
      sendBtn.disabled = false;
      inputEl.focus();
    }
  };

  sendBtn.addEventListener("click", sendMessage);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  inputEl.addEventListener("input", function() {
    this.style.height = "auto";
    this.style.height = (this.scrollHeight) + "px";
  });
}

function setAssistantOpen(isOpen) {
  assistantPanel.classList.toggle("open", isOpen);
  assistantPanel.setAttribute("aria-hidden", String(!isOpen));
  assistantToggle.setAttribute("aria-expanded", String(isOpen));
  const assistantTitle = (window.IntelligenceHubConfig || {}).assistantTitle || "智能问答";
  assistantToggle.setAttribute("aria-label", (isOpen ? "关闭" : "打开") + assistantTitle);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.warn("Service worker registration failed:", error);
  });
}

async function tryOpenAdmin() {
  try {
    const response = await fetch("/api/check-auth", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (data.authenticated) {
      window.location.href = "/admin";
    }
  } catch (err) {
    // 未授权或网络异常时保持静默。
  }
}

assistantToggle.addEventListener("click", () => {
  setAssistantOpen(!assistantPanel.classList.contains("open"));
});

assistantClose.addEventListener("click", () => {
  setAssistantOpen(false);
});

catalogArea.addEventListener("click", (event) => {
  const link = event.target.closest("[data-track-name]");
  if (!link) return;
  trackEvent("click", link.dataset.trackName);
});

adminEntry.addEventListener("click", tryOpenAdmin);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setAssistantOpen(false);
  }
});

bootstrap().catch((error) => {
  catalogArea.innerHTML = `<div class="empty-state">资源数据加载失败：${escapeHtml(error.message)}</div>`;
});

const nativeUploadBtn = document.querySelector("#nativeUploadBtn");
const nativeInvoiceUpload = document.querySelector("#nativeInvoiceUpload");

if (nativeUploadBtn && nativeInvoiceUpload) {
  nativeUploadBtn.addEventListener("click", () => {
    nativeInvoiceUpload.click();
  });

  nativeInvoiceUpload.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    nativeInvoiceUpload.value = "";
    const originalText = nativeUploadBtn.innerHTML;
    nativeUploadBtn.innerHTML = `<i data-lucide="loader"></i> 识别中(${files.length}张)...`;
    nativeUploadBtn.style.pointerEvents = "none";
    if (window.lucide) window.lucide.createIcons();

    const showToast = (msg, isError) => {
      let toast = document.querySelector('.toast-notification');
      if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast-notification';
        document.body.appendChild(toast);
      }
      toast.innerHTML = `<i data-lucide="${isError ? 'x-circle' : 'check-circle-2'}" style="color: ${isError ? '#dc2626' : '#16a34a'}"></i> ${msg}`;
      toast.style.borderLeftColor = isError ? '#dc2626' : '#16a34a';
      if (window.lucide) window.lucide.createIcons();
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 4000);
    };

    try {
      const results = [];
      for (const file of files) {
        try {
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch("/invoice-proxy/api/invoices/chat-submit", {
            method: "POST",
            body: formData
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || data.detail || "识别失败");
          results.push({ file, success: true, invoice: data.invoice });
        } catch (err) {
          results.push({ file, success: false, error: err.message });
        }
      }

      const modal = document.getElementById('invoiceResultModal');
      const modalBody = document.getElementById('invoiceModalBody');
      const modalFooter = document.getElementById('invoiceModalFooter');

      modalBody.innerHTML = results.map(r => {
        if (!r.success) {
          return `
            <div style="margin-bottom: 16px; padding: 12px; border: 1px solid var(--border); border-radius: 8px;">
              <h4 style="margin: 0 0 8px 0; font-size: 14px; word-break: break-all;">${escapeHtml(r.file.name)}</h4>
              <div class="invoice-status-badge status-invalid">❌ 识别失败</div>
              <div style="color: #ef4444; margin-top: 8px; font-size: 13px;">${escapeHtml(r.error)}</div>
            </div>
          `;
        }
        
        const invoice = r.invoice;
        const amount = invoice?.amount || "未知";
        const no = invoice?.invoice_no || "未知";
        const isCompliant = invoice?.is_compliant;

        return `
          <div style="margin-bottom: 16px; padding: 12px; border: 1px solid var(--border); border-radius: 8px;">
            <h4 style="margin: 0 0 12px 0; font-size: 14px; border-bottom: 1px solid var(--border); padding-bottom: 8px; word-break: break-all;">
              ${escapeHtml(r.file.name)}
            </h4>
            <div class="invoice-detail-row">
              <div class="invoice-detail-label">发票号码</div>
              <div class="invoice-detail-value">${no}</div>
            </div>
            <div class="invoice-detail-row">
              <div class="invoice-detail-label">发票金额</div>
              <div class="invoice-detail-value">¥ ${amount}</div>
            </div>
            <div class="invoice-detail-row">
              <div class="invoice-detail-label">审核状态</div>
              <div class="invoice-detail-value">
                <span class="invoice-status-badge ${isCompliant ? 'status-compliant' : 'status-invalid'}">
                  ${isCompliant ? '✅ 合规可用' : '❌ 不合规'}
                </span>
              </div>
            </div>
            ${!isCompliant && (invoice?.non_compliance_reasons?.length > 0) ? `
              <div class="invoice-reasons" style="margin-top: 8px; padding: 8px; font-size: 13px;">
                <strong style="display: block; margin-bottom: 4px;">不合规原因：</strong>
                <ul style="margin: 0 0 0 16px;">
                  ${invoice.non_compliance_reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}
                </ul>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      const compliantInvoices = results.filter(r => r.success && r.invoice.is_compliant);
      
      if (compliantInvoices.length > 0) {
        modalFooter.innerHTML = `
          <button class="invoice-btn invoice-btn-cancel" id="invoiceBtnCancel">放弃</button>
          <button class="invoice-btn invoice-btn-confirm" id="invoiceBtnConfirm">确认提交报销 (${compliantInvoices.length}张)</button>
        `;
        
        document.getElementById('invoiceBtnCancel').onclick = () => {
          modal.setAttribute('aria-hidden', 'true');
        };
        
        document.getElementById('invoiceBtnConfirm').onclick = async () => {
          const btn = document.getElementById('invoiceBtnConfirm');
          btn.disabled = true;
          btn.innerHTML = `<i data-lucide="loader"></i> 提交中...`;
          if (window.lucide) window.lucide.createIcons();
          
          try {
            const confirmPromises = compliantInvoices.map(r => 
              fetch(`/invoice-proxy/api/invoices/${r.invoice.id}/confirm`, { method: 'POST' })
            );
            await Promise.all(confirmPromises);
            showToast(`✅ 已成功提交 ${compliantInvoices.length} 张发票进入报销池`);
            modal.setAttribute('aria-hidden', 'true');
          } catch(e) {
            showToast("❌ 网络异常，部分发票提交失败", true);
            btn.disabled = false;
            btn.innerHTML = `确认提交报销 (${compliantInvoices.length}张)`;
          }
        };
      } else {
        modalFooter.innerHTML = `
          <button class="invoice-btn invoice-btn-confirm" id="invoiceBtnOk">我知道了</button>
        `;
        document.getElementById('invoiceBtnOk').onclick = () => {
          modal.setAttribute('aria-hidden', 'true');
        };
      }

      document.getElementById('invoiceModalClose').onclick = () => {
        modal.setAttribute('aria-hidden', 'true');
      };

      modal.setAttribute('aria-hidden', 'false');

    } catch (err) {
      showToast(`❌ 内部错误：${err.message}`, true);
    } finally {
      nativeUploadBtn.innerHTML = originalText;
      nativeUploadBtn.style.pointerEvents = "auto";
      if (window.lucide) window.lucide.createIcons();
    }
  });
}
