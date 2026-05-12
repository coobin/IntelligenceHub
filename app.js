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

async function bootstrap() {
  await loadConfigs();
  const response = await fetch("./data/catalog.json");
  const data = await response.json();
  state.catalog = data.sections;
  renderNavigation();
  renderCatalog();
  renderAssistant();
  initPhotoViewer();
  registerServiceWorker();
  trackEvent("pageview");
}

async function trackEvent(type, target) {
  try {
    // 使用 keepalive: true 确保页面跳转时请求不会被取消
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, target }),
      keepalive: true
    });
  } catch (err) {}
}
window.trackEvent = trackEvent; // 显式暴露给全局

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
    <button class="nav-button ${item.id === state.activeSection ? "active" : ""}" data-section="${item.id}">
      <span>${item.title}</span>
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
    <section class="catalog-section" id="section-${section.id}">
      <div class="section-heading">
        <div>
          <h2>${section.title}</h2>
          ${section.description ? `<p>${section.description}</p>` : ""}
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
    ? `<img src="${iconName}" alt="" style="width: 24px; height: 24px; object-fit: contain;">`
    : `<i data-lucide="${iconName}"></i>`;

  return `
    <a class="resource-card-link" href="${item.url}" ${target} onclick="trackEvent('click', '${item.name}')">
      <article class="hub-resource-card">
        <div class="card-icon">
          ${iconHtml}
        </div>
        <div class="card-content">
          <div class="card-top">
            <h3>${item.name}</h3>
            <span class="type-pill ${typeClass}">${label}</span>
          </div>
          ${item.description ? `<p>${item.description}</p>` : ""}
        </div>
      </article>
    </a>
  `;
}

function renderAssistant() {
  const config = window.IntelligenceHubConfig || {};
  const title = config.assistantTitle || "承希智汇问答";
  const subtitle = config.assistantSubtitle || "承希制度解读助手";
  document.querySelector("#assistantTitle").textContent = title;
  document.querySelector("#assistantSubtitle").textContent = subtitle;
  assistantToggle.setAttribute("aria-label", `打开${title}`);

  if (config.fastgptChatUrl) {
    document.querySelector("#assistantFrame").innerHTML = `
      <iframe title="${title}" src="${config.fastgptChatUrl}" allow="clipboard-read; clipboard-write"></iframe>
    `;
  }
}

function setAssistantOpen(isOpen) {
  assistantPanel.classList.toggle("open", isOpen);
  assistantPanel.setAttribute("aria-hidden", String(!isOpen));
  assistantToggle.setAttribute("aria-expanded", String(isOpen));
  assistantToggle.setAttribute("aria-label", isOpen ? "关闭承希智汇问答" : "打开承希智汇问答");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.warn("Service worker registration failed:", error);
  });
}


assistantToggle.addEventListener("click", () => {
  setAssistantOpen(!assistantPanel.classList.contains("open"));
});

assistantClose.addEventListener("click", () => {
  setAssistantOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setAssistantOpen(false);
  }
});

bootstrap().catch((error) => {
  catalogArea.innerHTML = `<div class="empty-state">资源数据加载失败：${error.message}</div>`;
});
