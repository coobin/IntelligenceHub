const typeLabels = {
  h5: "H5",
  client: "客户端",
  tool: "工具",
  website: "网址"
};

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
}

function initPhotoViewer() {
  const photoDisplay = document.querySelector(".daily-photo-display img");
  const viewer = document.querySelector("#photoViewer");
  const viewerImg = document.querySelector("#photoViewerImg");
  const viewerClose = document.querySelector("#photoViewerClose");
  const viewerOverlay = document.querySelector("#photoViewerOverlay");

  if (!photoDisplay || !viewer || !viewerImg) return;

  const openViewer = () => {
    // 使用原图地址（假设去掉 /preview 或是 /image）
    // 这里我们尝试将 /preview 替换为 /image 获取原图
    const previewUrl = photoDisplay.src;
    const rawUrl = previewUrl.replace("/preview", "/image");
    
    viewerImg.src = rawUrl;
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
}


function renderCard(item) {
  const typeClass = `type-${item.type}`;
  const label = typeLabels[item.type] || item.type;
  const isExternal = ["h5", "website", "tool"].includes(item.type);
  const target = isExternal ? 'target="_blank" rel="noopener noreferrer"' : "";
  
  return `
    <a class="resource-card-link" href="${item.url}" ${target}>
      <article class="resource-card">
        <div class="card-top">
          <div>
            <h3>${item.name}</h3>
            ${item.description ? `<p>${item.description}</p>` : ""}
          </div>
          <span class="type-pill ${typeClass}">${label}</span>
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
