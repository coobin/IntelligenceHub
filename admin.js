let catalog = { sections: [] };
let allEntryClicksExpanded = false;
let topVisitorsExpanded = false;
let recentVisitorsExpanded = false;
let cachedTopVisitors = [];
let cachedRecentVisitors = [];
let cachedDailyVisits = {};
let trendPeriod = "day";

const TREND_PERIODS = {
  day: { count: 7, rangeLabel: "近 7 日" },
  week: { count: 8, rangeLabel: "近 8 周" },
  month: { count: 6, rangeLabel: "近 6 个月" }
};

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

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// 页面加载逻辑
document.addEventListener("DOMContentLoaded", async () => {
  const authRes = await fetch("/api/check-auth");
  const { authenticated } = await authRes.json();
  
  if (authenticated) {
    showAdmin();
  } else {
    showAccessDenied();
  }
});

function showAccessDenied() {
  document.getElementById("accessDeniedView").classList.remove("hidden");
  document.getElementById("adminView").classList.add("hidden");
}

async function showAdmin() {
  document.getElementById("accessDeniedView").classList.add("hidden");
  document.getElementById("adminView").classList.remove("hidden");
  await loadCatalog();
  await loadStats();
}

// Tab 切换逻辑
function switchAdminTab(tabName) {
  const tabs = [
    ["dashboard", "tabDashboard", "dashboardView"],
    ["chatLogs", "tabChatLogs", "chatLogsView"],
    ["editor", "tabEditor", "editorView"],
  ];
  for (const [name, tabId, viewId] of tabs) {
    const active = name === tabName;
    document.getElementById(tabId)?.classList.toggle("active", active);
    document.getElementById(viewId)?.classList.toggle("hidden", !active);
  }
}

document.getElementById("tabDashboard").addEventListener("click", (event) => {
  event.preventDefault();
  switchAdminTab("dashboard");
  loadStats();
});

document.getElementById("tabChatLogs").addEventListener("click", (event) => {
  event.preventDefault();
  switchAdminTab("chatLogs");
  chatLogOffset = 0;
  loadChatLogs();
});

document.getElementById("tabEditor").addEventListener("click", (event) => {
  event.preventDefault();
  switchAdminTab("editor");
  renderAdmin();
});

document.getElementById("allEntryClicksToggle").addEventListener("click", () => {
  allEntryClicksExpanded = !allEntryClicksExpanded;
  const panel = document.getElementById("allEntryClicks");
  const toggle = document.getElementById("allEntryClicksToggle");
  panel.classList.toggle("hidden", !allEntryClicksExpanded);
  toggle.setAttribute("aria-expanded", String(allEntryClicksExpanded));
  toggle.innerText = allEntryClicksExpanded ? "收起" : "全部入口";
});

document.getElementById("topVisitorsToggle").addEventListener("click", () => {
  topVisitorsExpanded = !topVisitorsExpanded;
  drawTopVisitors();
});

document.getElementById("recentVisitorsToggle").addEventListener("click", () => {
  recentVisitorsExpanded = !recentVisitorsExpanded;
  drawRecentVisitors();
});

document.querySelectorAll("[data-trend-period]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextPeriod = button.dataset.trendPeriod;
    if (!TREND_PERIODS[nextPeriod] || nextPeriod === trendPeriod) return;
    trendPeriod = nextPeriod;
    drawTrend();
  });
});

// 加载数据
async function loadCatalog() {
  const res = await fetch("/api/catalog", { cache: "no-store" });
  catalog = await res.json();
  renderAdmin();
}

// 保存数据
async function saveCatalog() {
  const res = await fetch("/api/catalog", {
    method: "POST",
    headers: { 
      "Content-Type": "application/json"
    },
    body: JSON.stringify(catalog)
  });
  if (res.ok) {
    alert("保存成功");
    renderAdmin();
  } else {
    alert("保存失败");
  }
}

// 加载统计数据
async function loadStats() {
  const res = await fetch("/api/stats", { cache: "no-store" });
  const stats = await res.json();
  renderStats(stats);
}

function renderStats(stats) {
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("totalPV").innerText = toNumber(stats.pageViews);
  document.getElementById("todayPV").innerText = toNumber(stats.daily?.[today]);
  
  const todayUVList = stats.dailyUV?.[today] || [];
  document.getElementById("todayUV").innerText = toNumber(todayUVList.length);
  
  const totalItems = catalog.sections.reduce((sum, s) => sum + s.items.length, 0);
  document.getElementById("activeEntries").innerText = totalItems;

  // 渲染排名
  const rankList = document.getElementById("rankList");
  const sortedClicks = Object.entries(stats.clicks || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  const maxClicks = toNumber(sortedClicks[0]?.[1]) || 1;
  
  rankList.innerHTML = sortedClicks.map(([name, count]) => `
    <div class="rank-item">
      <span style="width: 100px; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(name)}</span>
      <div class="bar-outer">
        <div class="bar-inner" style="width: ${(toNumber(count) / maxClicks) * 100}%"></div>
      </div>
      <span style="font-weight: 600; color: #1e293b;">${toNumber(count)}</span>
    </div>
  `).join("") || '<p style="color:#94a3b8; text-align:center; padding:20px;">暂无点击数据</p>';

  renderAllEntryClicks(stats.clicks || {});
  renderTopVisitors(stats.dailyUV, stats.dailyUVNames);
  cachedDailyVisits = stats.daily || {};
  drawTrend();

  cachedRecentVisitors = (stats.recent || []).slice(0, 20);
  drawRecentVisitors();
}

function toDateKey(date) {
  return date.toISOString().split("T")[0];
}

function addUtcDays(date, amount) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

function sumVisits(start, end) {
  let total = 0;
  for (let cursor = new Date(start); cursor <= end; cursor = addUtcDays(cursor, 1)) {
    total += toNumber(cachedDailyVisits[toDateKey(cursor)]);
  }
  return total;
}

function getTrendBuckets(period) {
  const config = TREND_PERIODS[period];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const buckets = [];

  if (period === "day") {
    for (let offset = config.count - 1; offset >= 0; offset--) {
      const date = addUtcDays(today, -offset);
      const key = toDateKey(date);
      buckets.push({
        label: key.slice(5).replace("-", "/"),
        title: key,
        value: toNumber(cachedDailyVisits[key])
      });
    }
    return buckets;
  }

  if (period === "week") {
    const currentWeekStart = addUtcDays(today, -((today.getUTCDay() + 6) % 7));
    for (let offset = config.count - 1; offset >= 0; offset--) {
      const start = addUtcDays(currentWeekStart, -offset * 7);
      const end = addUtcDays(start, 6);
      buckets.push({
        label: `${start.getUTCMonth() + 1}/${start.getUTCDate()}`,
        title: `${toDateKey(start)} 至 ${toDateKey(end)}`,
        value: sumVisits(start, end)
      });
    }
    return buckets;
  }

  const currentMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  for (let offset = config.count - 1; offset >= 0; offset--) {
    const start = new Date(Date.UTC(
      currentMonthStart.getUTCFullYear(),
      currentMonthStart.getUTCMonth() - offset,
      1
    ));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    buckets.push({
      label: `${start.getUTCFullYear()}/${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
      title: `${toDateKey(start)} 至 ${toDateKey(end)}`,
      value: sumVisits(start, end)
    });
  }
  return buckets;
}

function drawTrend() {
  const trendList = document.getElementById("trendList");
  const rangeLabel = document.getElementById("trendRangeLabel");
  if (!trendList || !rangeLabel) return;

  const buckets = getTrendBuckets(trendPeriod);
  const maxValue = Math.max(...buckets.map((bucket) => bucket.value), 1);
  rangeLabel.textContent = TREND_PERIODS[trendPeriod].rangeLabel;

  document.querySelectorAll("[data-trend-period]").forEach((button) => {
    const active = button.dataset.trendPeriod === trendPeriod;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  trendList.innerHTML = buckets.map((bucket) => {
    const height = (bucket.value / maxValue) * 100;
    return `
      <div class="trend-column">
        <div class="trend-bar-area">
          <div class="trend-bar${bucket.value > 0 ? " has-value" : ""}" style="height:${height}%;" title="${escapeAttribute(`${bucket.title}：${bucket.value} 次访问`)}">
            ${bucket.value > 0 ? `<span class="trend-value">${bucket.value}</span>` : ""}
          </div>
        </div>
        <span class="trend-label">${escapeHtml(bucket.label)}</span>
      </div>
    `;
  }).join("");
}

function drawRecentVisitors() {
  const recentList = document.getElementById("recentList");
  if (!recentList) return;

  const visible = recentVisitorsExpanded ? cachedRecentVisitors : cachedRecentVisitors.slice(0, 5);
  const toggle = document.getElementById("recentVisitorsToggle");
  if (toggle) {
    toggle.textContent = recentVisitorsExpanded ? "收起" : "展开更多";
    toggle.setAttribute("aria-expanded", String(recentVisitorsExpanded));
    toggle.style.display = cachedRecentVisitors.length <= 5 ? "none" : "";
  }

  recentList.innerHTML = `
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <thead>
        <tr style="text-align: left; color: #64748b; border-bottom: 1px solid #f1f5f9;">
          <th style="padding: 12px 8px;">时间</th>
          <th style="padding: 12px 8px;">用户名</th>
          <th style="padding: 12px 8px;">IP 地址</th>
          <th style="padding: 12px 8px;">设备信息</th>
        </tr>
      </thead>
      <tbody>
        ${visible.map(r => `
          <tr style="border-bottom: 1px solid #f8fafc;">
            <td style="padding: 12px 8px; color: #1e293b;">${escapeHtml(r.time)}</td>
            <td style="padding: 12px 8px;"><span style="font-weight: 600; color: var(--admin-accent);">${escapeHtml(r.displayName || r.user || "未知")}</span></td>
            <td style="padding: 12px 8px;"><code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${escapeHtml(r.ip)}</code></td>
            <td style="padding: 12px 8px; color: #64748b; font-size: 12px;">${parseUA(r.ua)}</td>
          </tr>
        `).join("") || '<tr><td colspan="4" style="text-align:center; padding:20px; color:#94a3b8;">暂无记录</td></tr>'}
      </tbody>
    </table>
  `;
}

function getCatalogEntries() {
  return catalog.sections.flatMap((section) => (
    (section.items || []).map((item) => ({
      name: item.name || "未命名入口",
      section: section.title || section.id || "未分类",
      type: item.type || "-",
      clicks: 0
    }))
  ));
}

function renderAllEntryClicks(clicks) {
  const allEntryClicks = document.getElementById("allEntryClicks");
  if (!allEntryClicks) return;
  allEntryClicks.classList.toggle("hidden", !allEntryClicksExpanded);

  const entryMap = new Map();
  getCatalogEntries().forEach((entry) => {
    const existing = entryMap.get(entry.name);
    if (existing) {
      existing.section = `${existing.section} / ${entry.section}`;
      return;
    }
    entryMap.set(entry.name, entry);
  });

  Object.entries(clicks || {}).forEach(([name, count]) => {
    const current = entryMap.get(name);
    if (current) {
      current.clicks = toNumber(count);
      return;
    }
    entryMap.set(name, {
      name,
      section: "未在当前目录中",
      type: "-",
      clicks: toNumber(count)
    });
  });

  const rows = Array.from(entryMap.values())
    .sort((a, b) => b.clicks - a.clicks || a.name.localeCompare(b.name, "zh-Hans-CN"));
  const zeroCount = rows.filter((entry) => entry.clicks === 0).length;

  allEntryClicks.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:10px; color:#64748b; font-size:12px;">
      <span>共 ${rows.length} 个入口</span>
      <span>${zeroCount} 个暂无点击</span>
    </div>
    <table class="entry-click-table">
      <thead>
        <tr>
          <th>入口名称</th>
          <th>所属分类</th>
          <th style="text-align:right;">点击次数</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((entry) => `
          <tr>
            <td class="entry-click-name">${escapeHtml(entry.name)}</td>
            <td>${escapeHtml(entry.section)}</td>
            <td class="entry-click-count">${toNumber(entry.clicks)}</td>
          </tr>
        `).join("") || '<tr><td colspan="3" style="text-align:center; padding:20px; color:#94a3b8;">暂无入口数据</td></tr>'}
      </tbody>
    </table>
  `;
}

function renderTopVisitors(dailyUV, dailyUVNames) {
  const userDays = {};
  const userNames = {};
  for (const day of Object.keys(dailyUV || {})) {
    for (const user of dailyUV[day] || []) {
      userDays[user] = (userDays[user] || 0) + 1;
      const displayName = dailyUVNames?.[day]?.[user];
      if (displayName) userNames[user] = displayName;
    }
  }

  cachedTopVisitors = Object.entries(userDays)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  cachedTopVisitors = cachedTopVisitors.map(([user, days]) => [userNames[user] || user, days]);

  drawTopVisitors();
}

function drawTopVisitors() {
  const container = document.getElementById("topVisitorsList");
  if (!container) return;

  const visible = topVisitorsExpanded ? cachedTopVisitors : cachedTopVisitors.slice(0, 6);
  const toggle = document.getElementById("topVisitorsToggle");
  if (toggle) {
    toggle.textContent = topVisitorsExpanded ? "收起" : "展开更多";
    toggle.setAttribute("aria-expanded", String(topVisitorsExpanded));
    toggle.style.display = cachedTopVisitors.length <= 6 ? "none" : "";
  }

  if (visible.length === 0) {
    container.innerHTML = '<p style="color:#94a3b8; text-align:center; padding:20px;">暂无访客数据</p>';
    return;
  }

  const maxDays = cachedTopVisitors[0][1];
  container.innerHTML = visible.map(([user, days], i) => {
    const rank = i + 1;
    const medal = rank <= 3 ? ["\u{1F947}", "\u{1F948}", "\u{1F949}"][rank - 1] : `<span style="display:inline-block;width:20px;text-align:center;color:#94a3b8;font-size:13px;">${rank}</span>`;
    return `
      <div class="rank-item">
        <span style="display:flex;align-items:center;gap:8px;min-width:120px;">
          <span style="font-size:16px;">${medal}</span>
          <span style="font-size:14px;font-weight:${rank <= 3 ? 600 : 400};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(user)}</span>
        </span>
        <div class="bar-outer">
          <div class="bar-inner" style="width:${(toNumber(days) / maxDays) * 100}%"></div>
        </div>
        <span style="font-weight:600;color:#1e293b;white-space:nowrap;">${toNumber(days)} 天</span>
      </div>
    `;
  }).join("");
}

function parseUA(ua) {
  if (!ua) return "未知";
  if (ua.includes("MicroMessenger")) return "微信内置浏览器";
  if (ua.includes("Mobile")) return "移动设备";
  if (ua.includes("Windows")) return "Windows PC";
  if (ua.includes("Macintosh")) return "Mac PC";
  return "其他设备";
}

function renderItemIcon(item) {
  const icon = String(item.icon || "").trim();
  if (/[/.]/.test(icon)) {
    try {
      const url = new URL(icon, document.baseURI);
      if (["http:", "https:"].includes(url.protocol)) {
        return `<img src="${escapeAttribute(url.href)}" alt="">`;
      }
    } catch {}
  }
  const name = /^[a-z0-9-]+$/.test(icon) ? icon : "layout-grid";
  return `<i data-lucide="${escapeAttribute(name)}"></i>`;
}

// 渲染管理界面
function renderAdmin() {
  document.getElementById("openModuleSort").disabled = catalog.sections.length < 2;
  const list = document.getElementById("sectionsList");
  list.innerHTML = catalog.sections.map((section, sIndex) => `
    <div class="section-editor">
      <div class="section-header">
        <div>
          <h2 style="margin:0">${escapeHtml(section.title)} <small style="color:#94a3b8; font-weight:normal; font-size:14px;">(${escapeHtml(section.id)})</small></h2>
          <p style="margin:4px 0 0; color:#64748b; font-size:13px;">${escapeHtml(section.description || "无描述")}</p>
        </div>
        <div class="editor-actions">
          <button class="btn btn-ghost" type="button" data-action="sort-items" data-section-index="${sIndex}" ${section.items.length < 2 ? "disabled" : ""}>项目排序</button>
          <button class="btn btn-ghost" data-action="edit-section" data-section-index="${sIndex}">编辑分类</button>
          <button class="btn btn-danger" data-action="delete-section" data-section-index="${sIndex}">删除分类</button>
          <button class="btn btn-primary" data-action="add-item" data-section-id="${escapeAttribute(section.id)}">+ 添加项目</button>
        </div>
      </div>
      <p class="catalog-sort-notice" id="itemSortNotice-${sIndex}" role="status"></p>
      <div class="items-list">
        <div class="item-row" style="font-weight:600; color:#94a3b8; font-size:12px; border-bottom:1px solid #e2e8f0; padding-bottom:8px;">
          <div>名称</div>
          <div>描述 / URL</div>
          <div>状态</div>
          <div>操作</div>
        </div>
        ${section.items.map((item, iIndex) => `
          <div class="item-row">
            <div class="item-name"><span class="item-icon" aria-hidden="true">${renderItemIcon(item)}</span><span>${escapeHtml(item.name)}</span></div>
            <div style="font-size:13px; color:#64748b;">
              <div>${escapeHtml(item.description || "-")}</div>
              <div style="color:#94a3b8; font-family:monospace; font-size:11px;">${escapeHtml(item.url)}</div>
            </div>
            <div style="font-size:12px;">${escapeHtml(item.status || "-")}</div>
            <div style="display:flex; gap:4px;">
              <button class="btn btn-ghost" style="padding:4px 8px;" data-action="edit-item" data-section-id="${escapeAttribute(section.id)}" data-item-index="${iIndex}">编辑</button>
              <button class="btn btn-danger" style="padding:4px 8px;" data-action="delete-item" data-section-id="${escapeAttribute(section.id)}" data-item-index="${iIndex}">删除</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");
  window.lucide?.createIcons({ root: list });
}

const moduleSortButton = document.getElementById("openModuleSort");
const catalogSortDialog = document.getElementById("catalogSortDialog");
const catalogSortList = document.getElementById("catalogSortList");
const catalogSortStatus = document.getElementById("catalogSortStatus");
const catalogSortNotice = document.getElementById("catalogSortNotice");
const catalogSortSave = document.getElementById("saveCatalogSort");
const catalogSortCancel = document.getElementById("cancelCatalogSort");
let sortDraft;
let sortSaving = false;

function renderCatalogSort() {
  const { section, entries, order } = sortDraft;
  catalogSortList.innerHTML = order.map((originalIndex, index) => {
    const entry = entries[originalIndex];
    const title = section ? entry.name : entry.title || entry.id;
    return `
      <li>
        <div class="catalog-sort-row">
          <span>${escapeHtml(title)}</span>
          <div class="catalog-sort-moves">
            <button type="button" class="btn btn-ghost" data-index="${index}" data-step="-1"
              aria-label="上移 ${escapeAttribute(title)}" ${sortSaving || index === 0 ? "disabled" : ""}>上移</button>
            <button type="button" class="btn btn-ghost" data-index="${index}" data-step="1"
              aria-label="下移 ${escapeAttribute(title)}" ${sortSaving || index === order.length - 1 ? "disabled" : ""}>下移</button>
          </div>
        </div>
      </li>`;
  }).join("");
  catalogSortSave.disabled = sortSaving || !order.some((originalIndex, index) => originalIndex !== index);
  catalogSortCancel.disabled = sortSaving;
}

function openCatalogSort(sectionIndex) {
  const section = sectionIndex === undefined ? null : catalog.sections[sectionIndex];
  if (sectionIndex !== undefined && !section) return;
  const entries = [...(section ? section.items : catalog.sections)];
  if (entries.length < 2) return;
  sortDraft = { section, entries, order: entries.map((_, index) => index) };
  document.getElementById("catalogSortTitle").textContent = section ? `项目排序：${section.title || section.id}` : "模块排序";
  document.getElementById("catalogSortHint").textContent = section
    ? "保存后，首页这个模块里的卡片会按此顺序展示。"
    : "保存后，首页左侧导航和模块列表会按此顺序展示。";
  catalogSortStatus.textContent = "";
  catalogSortNotice.textContent = "";
  if (section) document.getElementById(`itemSortNotice-${sectionIndex}`).textContent = "";
  renderCatalogSort();
  catalogSortDialog.showModal();
  catalogSortList.scrollTop = 0;
}

moduleSortButton.addEventListener("click", () => openCatalogSort());

catalogSortList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-step]");
  if (!button || button.disabled || sortSaving) return;
  const index = Number(button.dataset.index);
  const step = Number(button.dataset.step);
  const next = index + step;
  const { order } = sortDraft;
  if (next < 0 || next >= order.length) return;

  [order[index], order[next]] = [order[next], order[index]];
  renderCatalogSort();
  const nextButton = catalogSortList.querySelector(`[data-index="${next}"][data-step="${step}"]:not(:disabled)`);
  const otherButton = catalogSortList.querySelector(`[data-index="${next}"]:not(:disabled)`);
  (nextButton || otherButton)?.focus();
});

catalogSortCancel.addEventListener("click", () => catalogSortDialog.close());
catalogSortDialog.addEventListener("cancel", (event) => {
  if (sortSaving) event.preventDefault();
});

catalogSortSave.addEventListener("click", async () => {
  if (catalogSortSave.disabled) return;
  sortSaving = true;
  catalogSortStatus.textContent = "正在保存顺序…";
  renderCatalogSort();

  try {
    const { section, entries, order } = sortDraft;
    const body = section
      ? { sectionId: section.id, expectedItems: entries, order }
      : { sectionIds: order.map((index) => entries[index].id) };
    const response = await fetch(section ? "/api/catalog/item-order" : "/api/catalog/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (response.status === 409) {
      catalogSortStatus.textContent = section
        ? "模块内容已更新。请刷新后台后重新排序。"
        : "导航目录已更新。请刷新后台后重新排序。";
      return;
    }
    if (!response.ok) throw new Error("Save failed");
    catalog = await response.json();
    renderAdmin();
    catalogSortDialog.close();
    if (section) {
      const index = catalog.sections.findIndex((entry) => entry.id === section.id);
      document.getElementById(`itemSortNotice-${index}`).textContent = "项目顺序已保存，刷新首页即可查看。";
      document.querySelector(`[data-action="sort-items"][data-section-index="${index}"]`).focus({ preventScroll: true });
    } else {
      catalogSortNotice.textContent = "模块顺序已保存，刷新首页即可查看。";
    }
  } catch {
    catalogSortStatus.textContent = "保存顺序失败，请重试。";
  } finally {
    sortSaving = false;
    if (catalogSortDialog.open) {
      renderCatalogSort();
      catalogSortSave.focus();
    }
  }
});

document.getElementById("sectionsList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const sectionIndex = Number(button.dataset.sectionIndex);
  const itemIndex = Number(button.dataset.itemIndex);

  switch (button.dataset.action) {
    case "sort-items":
      openCatalogSort(sectionIndex);
      break;
    case "edit-section":
      editSection(sectionIndex);
      break;
    case "delete-section":
      deleteSection(sectionIndex);
      break;
    case "add-item":
      addItem(button.dataset.sectionId);
      break;
    case "edit-item":
      editItem(button.dataset.sectionId, itemIndex);
      break;
    case "delete-item":
      deleteItem(button.dataset.sectionId, itemIndex);
      break;
  }
});

// --- Item 操作 ---
function addItem(sectionId) {
  document.getElementById("modalTitle").innerText = "添加项目";
  document.getElementById("itemForm").reset();
  document.getElementById("editSectionId").value = sectionId;
  document.getElementById("editItemIndex").value = "";
  document.getElementById("itemModal").style.display = "grid";
}

function editItem(sectionId, index) {
  const section = catalog.sections.find(s => s.id === sectionId);
  const item = section.items[index];
  
  document.getElementById("modalTitle").innerText = "编辑项目";
  document.getElementById("editSectionId").value = sectionId;
  document.getElementById("editItemIndex").value = index;
  document.getElementById("itemName").value = item.name;
  document.getElementById("itemDesc").value = item.description || "";
  document.getElementById("itemUrl").value = item.url;
  document.getElementById("itemType").value = item.type;
  document.getElementById("itemTags").value = (item.tags || []).join(", ");
  document.getElementById("itemStatus").value = item.status || "";
  document.getElementById("itemIcon").value = item.icon || "";
  
  document.getElementById("itemModal").style.display = "grid";
}

function deleteItem(sectionId, index) {
  if (!confirm("确定要删除此项目吗？")) return;
  const section = catalog.sections.find(s => s.id === sectionId);
  section.items.splice(index, 1);
  saveCatalog();
}

document.getElementById("itemForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const sectionId = document.getElementById("editSectionId").value;
  const index = document.getElementById("editItemIndex").value;
  const section = catalog.sections.find(s => s.id === sectionId);
  const existingItem = index === "" ? {} : (section.items[index] || {});
  
  const item = {
    ...existingItem,
    name: document.getElementById("itemName").value,
    description: document.getElementById("itemDesc").value,
    url: document.getElementById("itemUrl").value,
    type: document.getElementById("itemType").value,
    tags: document.getElementById("itemTags").value.split(",").map(t => t.trim()).filter(t => t),
    status: document.getElementById("itemStatus").value,
    icon: document.getElementById("itemIcon").value
  };
  
  if (index === "") {
    section.items.push(item);
  } else {
    section.items[index] = item;
  }
  
  saveCatalog();
  closeModal();
});

function closeModal() {
  document.getElementById("itemModal").style.display = "none";
}

async function uploadIcon(input) {
  if (!input.files || !input.files[0]) return;
  
  const formData = new FormData();
  formData.append("icon", input.files[0]);
  
  const btn = input.previousElementSibling;
  const originalText = btn.innerText;
  btn.innerText = "上传中...";
  btn.disabled = true;

  try {
    const res = await fetch("/api/upload-icon", {
      method: "POST",
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById("itemIcon").value = data.filepath;
      btn.innerText = "上传成功";
      setTimeout(() => btn.innerText = "更换图片", 2000);
    } else {
      alert("上传失败: " + (data.message || "未知错误"));
      btn.innerText = "上传失败";
    }
  } catch (err) {
    alert("上传错误");
    btn.innerText = "上传错误";
  } finally {
    btn.disabled = false;
  }
}

// --- Section 操作 ---
function addSection() {
  document.getElementById("sectionModalTitle").innerText = "添加分类";
  document.getElementById("sectionForm").reset();
  document.getElementById("editSectionIdReal").value = "";
  document.getElementById("sectionModal").style.display = "grid";
}

function editSection(index) {
  const section = catalog.sections[index];
  document.getElementById("sectionModalTitle").innerText = "编辑分类";
  document.getElementById("editSectionIdReal").value = index;
  document.getElementById("sectionId").value = section.id;
  document.getElementById("sectionTitle").value = section.title;
  document.getElementById("sectionDesc").value = section.description || "";
  document.getElementById("sectionModal").style.display = "grid";
}

function deleteSection(index) {
  if (!confirm("确定要删除此分类及其下的所有项目吗？")) return;
  catalog.sections.splice(index, 1);
  saveCatalog();
}

document.getElementById("sectionForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const index = document.getElementById("editSectionIdReal").value;
  
  const section = {
    id: document.getElementById("sectionId").value,
    title: document.getElementById("sectionTitle").value,
    description: document.getElementById("sectionDesc").value,
    items: index === "" ? [] : catalog.sections[index].items
  };
  
  if (index === "") {
    catalog.sections.push(section);
  } else {
    catalog.sections[index] = section;
  }
  
  saveCatalog();
  closeSectionModal();
});

function closeSectionModal() {
  document.getElementById("sectionModal").style.display = "none";
}

let chatLogOffset = 0;
const CHAT_LOG_PAGE_SIZE = 40;
const ROUTE_LABELS = {
  model: "模型问答",
  shortcut: "快捷查询",
  policy_direct: "制度直检",
  confirm: "写操作确认",
  invoice_upload: "发票上传",
  invoice_confirm: "发票确认",
};

function formatChatTime(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDuration(ms) {
  const num = toNumber(ms);
  if (num < 1000) return `${num}ms`;
  return `${(num / 1000).toFixed(1)}s`;
}

function chatStatusBadge(item) {
  if (item.status === "error" || (item.httpStatus && item.httpStatus >= 400)) {
    return `<span class="chat-badge err">异常 ${escapeHtml(item.httpStatus || "")}</span>`;
  }
  if (item.status === "pending_confirmation") {
    return `<span class="chat-badge warn">待确认</span>`;
  }
  return `<span class="chat-badge ok">正常</span>`;
}

function renderChatTags(item) {
  const parts = [];
  for (const tool of Array.isArray(item.tools) ? item.tools : []) {
    const tip = tool.traceId ? `trace_id: ${tool.traceId}` : `耗时 ${formatDuration(tool.durationMs)}`;
    const mark = tool.status === "succeeded" ? "✓" : tool.status === "pending_confirmation" ? "…" : "!";
    parts.push(`<span class="chat-tag" title="${escapeAttribute(tip)}">${escapeHtml(mark)} ${escapeHtml(tool.name)}</span>`);
  }
  for (const citation of Array.isArray(item.citations) ? item.citations : []) {
    if (citation?.documentName) {
      parts.push(`<span class="chat-tag doc">制度：${escapeHtml(citation.documentName)}</span>`);
    }
  }
  return parts.length ? `<div class="chat-tags">${parts.join("")}</div>` : "";
}

async function loadChatLogs() {
  const listEl = document.getElementById("chatLogsList");
  const days = document.getElementById("chatFilterDays").value || "7";
  const user = document.getElementById("chatFilterUser").value || "";
  const status = document.getElementById("chatFilterStatus").value || "";
  const route = document.getElementById("chatFilterRoute").value || "";
  const keyword = document.getElementById("chatFilterKeyword").value.trim();

  const params = new URLSearchParams({
    days,
    limit: String(CHAT_LOG_PAGE_SIZE),
    offset: String(chatLogOffset),
  });
  if (user) params.set("user", user);
  if (status) params.set("status", status);
  if (route) params.set("route", route);
  if (keyword) params.set("q", keyword);

  listEl.innerHTML = `<div class="chat-empty-state">正在加载对话记录…</div>`;
  try {
    const res = await fetch(`/api/admin/chat-logs?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const summary = data.summary || {};

    document.getElementById("chatStatTurns").innerText = toNumber(summary.totalTurns).toLocaleString();
    document.getElementById("chatStatErrors").innerText = `异常 ${toNumber(summary.errorCount).toLocaleString()} 次`;
    document.getElementById("chatStatUsers").innerText = toNumber(summary.uniqueUsers).toLocaleString();
    document.getElementById("chatStatSessions").innerText = `${toNumber(summary.uniqueSessions).toLocaleString()} 个会话`;
    document.getElementById("chatStatTokens").innerText = toNumber(summary.totalTokens).toLocaleString();
    document.getElementById("chatStatTokenSplit").innerText = `输入 ${toNumber(summary.promptTokens).toLocaleString()} / 输出 ${toNumber(summary.completionTokens).toLocaleString()}`;
    document.getElementById("chatStatLatency").innerText = formatDuration(summary.avgDurationMs);
    document.getElementById("chatStatRetention").innerText = `自动保留近 ${toNumber(data.retentionDays) || 90} 天`;

    const userSelect = document.getElementById("chatFilterUser");
    const currentUser = userSelect.value;
    userSelect.innerHTML = `<option value="">全部员工</option>` + (Array.isArray(data.users) ? data.users : []).map((entry) =>
      `<option value="${escapeAttribute(entry.user)}">${escapeHtml(entry.userName || entry.user)} (${escapeHtml(entry.user)}) · ${toNumber(entry.count)}</option>`
    ).join("");
    userSelect.value = currentUser;

    const items = Array.isArray(data.items) ? data.items : [];
    const total = toNumber(data.total);
    document.getElementById("chatLogsCount").innerText = total
      ? `显示第 ${chatLogOffset + 1}–${Math.min(chatLogOffset + items.length, total)} 条，共 ${total} 条`
      : "共 0 条";
    document.getElementById("chatLogsPrev").disabled = chatLogOffset <= 0;
    document.getElementById("chatLogsNext").disabled = chatLogOffset + items.length >= total;

    if (!items.length) {
      listEl.innerHTML = `<div class="chat-empty-state">当前筛选条件下暂无对话记录。</div>`;
      return;
    }

    listEl.innerHTML = items.map((item) => {
      const isError = item.status === "error" || (item.httpStatus && item.httpStatus >= 400);
      const routeLabel = ROUTE_LABELS[item.route] || item.route || "对话";
      const tokens = toNumber(item.usage?.totalTokens);
      const answerRow = isError
        ? `<div class="chat-qa-row"><span class="chat-qa-label e">错</span><p class="chat-qa-text error">${escapeHtml(item.error || "请求异常")}</p></div>`
        : `<div class="chat-qa-row"><span class="chat-qa-label a">答</span><p class="chat-qa-text muted">${escapeHtml(item.answer || "（无文本回复）")}</p></div>`;
      return `
        <article class="chat-log-card ${isError ? "is-error" : ""}">
          <div class="chat-log-top">
            <div class="chat-log-meta">
              <span class="chat-log-user">${escapeHtml(item.userName || item.user || "未知员工")}</span>
              <span class="chat-log-uid">${escapeHtml(item.user || "")}</span>
              <span>${escapeHtml(formatChatTime(item.ts))}</span>
              <span class="chat-badge route">${escapeHtml(routeLabel)}</span>
              ${chatStatusBadge(item)}
              <span>耗时 ${escapeHtml(formatDuration(item.durationMs))}</span>
              ${tokens ? `<span>${tokens.toLocaleString()} tok</span>` : ""}
            </div>
            <button class="btn btn-ghost" type="button" data-open-session="1" data-user="${escapeAttribute(item.user || "")}" data-session="${escapeAttribute(item.session || "")}">查看完整会话</button>
          </div>
          <div class="chat-qa">
            <div class="chat-qa-row"><span class="chat-qa-label q">问</span><p class="chat-qa-text">${escapeHtml(item.query || "")}</p></div>
            ${answerRow}
          </div>
          ${renderChatTags(item)}
        </article>
      `;
    }).join("");
  } catch (err) {
    listEl.innerHTML = `<div class="chat-empty-state">加载对话记录失败：${escapeHtml(err.message)}</div>`;
  }
}

async function openChatSession(user, session) {
  const dialog = document.getElementById("chatSessionDialog");
  const titleEl = document.getElementById("chatSessionTitle");
  const subEl = document.getElementById("chatSessionSub");
  const bodyEl = document.getElementById("chatSessionBody");
  titleEl.innerText = "完整会话记录";
  subEl.innerText = `${user} · ${session}`;
  bodyEl.innerHTML = `<div class="chat-empty-state">正在加载会话详情…</div>`;
  if (typeof dialog.showModal === "function") dialog.showModal();

  try {
    const params = new URLSearchParams({ user, session });
    const res = await fetch(`/api/admin/chat-logs/session?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    titleEl.innerText = `${data.userName || data.user} 的完整会话`;
    subEl.innerText = `账号 ${data.user} · 会话 ${data.session} · 共 ${toNumber(data.totalTurns)} 轮 · 合计 ${toNumber(data.totalTokens).toLocaleString()} tokens`;
    const turns = Array.isArray(data.items) ? data.items : [];
    if (!turns.length) {
      bodyEl.innerHTML = `<div class="chat-empty-state">未找到该会话的记录。</div>`;
      return;
    }
    bodyEl.innerHTML = turns.map((item, turnIndex) => {
      const isError = item.status === "error" || (item.httpStatus && item.httpStatus >= 400);
      const routeLabel = ROUTE_LABELS[item.route] || item.route || "对话";
      const usage = item.usage || {};
      const tokenMeta = toNumber(usage.totalTokens)
        ? ` · Token ${toNumber(usage.totalTokens).toLocaleString()}（入 ${toNumber(usage.promptTokens)} / 出 ${toNumber(usage.completionTokens)}）`
        : "";
      const toolDetails = (Array.isArray(item.tools) ? item.tools : []).map((tool) =>
        `<span class="chat-tag">${escapeHtml(tool.name)} (${escapeHtml(tool.status)}, ${escapeHtml(formatDuration(tool.durationMs))}${tool.traceId ? `, trace: ${escapeHtml(tool.traceId)}` : ""})</span>`
      ).join("");
      const docDetails = (Array.isArray(item.citations) ? item.citations : []).map((citation) =>
        citation?.documentName ? `<span class="chat-tag doc">制度：${escapeHtml(citation.documentName)}</span>` : ""
      ).join("");
      return `
        <div class="chat-turn-detail">
          <div class="chat-log-meta">
            <strong>第 ${turnIndex + 1} 轮</strong>
            <span>${escapeHtml(formatChatTime(item.ts))}</span>
            <span class="chat-badge route">${escapeHtml(routeLabel)}</span>
            ${chatStatusBadge(item)}
            <span>耗时 ${escapeHtml(formatDuration(item.durationMs))}${escapeHtml(tokenMeta)}</span>
            ${item.model ? `<span class="chat-log-uid">${escapeHtml(item.model)}</span>` : ""}
          </div>
          <div class="chat-qa-row"><span class="chat-qa-label q">问</span><pre>${escapeHtml(item.query || "")}</pre></div>
          ${isError
            ? `<div class="chat-qa-row"><span class="chat-qa-label e">错</span><pre style="color:#b91c1c;">${escapeHtml(item.error || "请求异常")}</pre></div>`
            : `<div class="chat-qa-row"><span class="chat-qa-label a">答</span><pre>${escapeHtml(item.answer || "（无文本回复）")}</pre></div>`}
          ${(toolDetails || docDetails) ? `<div class="chat-tags">${toolDetails}${docDetails}</div>` : ""}
        </div>
      `;
    }).join("");
  } catch (err) {
    bodyEl.innerHTML = `<div class="chat-empty-state">加载会话详情失败：${escapeHtml(err.message)}</div>`;
  }
}

document.getElementById("chatLogsRefresh")?.addEventListener("click", () => loadChatLogs());
document.getElementById("chatFilterApply")?.addEventListener("click", () => {
  chatLogOffset = 0;
  loadChatLogs();
});
document.getElementById("chatFilterReset")?.addEventListener("click", () => {
  document.getElementById("chatFilterDays").value = "7";
  document.getElementById("chatFilterUser").value = "";
  document.getElementById("chatFilterStatus").value = "";
  document.getElementById("chatFilterRoute").value = "";
  document.getElementById("chatFilterKeyword").value = "";
  chatLogOffset = 0;
  loadChatLogs();
});
for (const selectId of ["chatFilterDays", "chatFilterUser", "chatFilterStatus", "chatFilterRoute"]) {
  document.getElementById(selectId)?.addEventListener("change", () => {
    chatLogOffset = 0;
    loadChatLogs();
  });
}
document.getElementById("chatFilterKeyword")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    chatLogOffset = 0;
    loadChatLogs();
  }
});
document.getElementById("chatLogsPrev")?.addEventListener("click", () => {
  chatLogOffset = Math.max(0, chatLogOffset - CHAT_LOG_PAGE_SIZE);
  loadChatLogs();
});
document.getElementById("chatLogsNext")?.addEventListener("click", () => {
  chatLogOffset += CHAT_LOG_PAGE_SIZE;
  loadChatLogs();
});
document.getElementById("chatLogsList")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-open-session]");
  if (!button) return;
  openChatSession(button.dataset.user || "", button.dataset.session || "");
});
document.getElementById("closeChatSession")?.addEventListener("click", () => {
  document.getElementById("chatSessionDialog")?.close();
});
