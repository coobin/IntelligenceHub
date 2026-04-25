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
  await loadLocalConfig();
  const response = await fetch("./data/catalog.json");
  const data = await response.json();
  state.catalog = data.sections;
  renderNavigation();
  renderCatalog();
  renderAssistant();
  registerServiceWorker();
}

function loadLocalConfig() {
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = `./config.local.js?t=${Date.now()}`;
    script.onload = resolve;
    script.onerror = resolve;
    document.head.append(script);
  });
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
    .map((section) => ({ ...section, items: filterItems(section.items) }))
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

function filterItems(items) {
  const query = state.query.trim().toLowerCase();
  if (!query) return items;

  return items.filter((item) => {
    const haystack = [item.name, item.description, item.type, item.status, ...item.tags].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function renderCard(item) {
  const typeClass = `type-${item.type}`;
  const label = typeLabels[item.type] || item.type;
  return `
    <a class="resource-card-link" href="${item.url}" rel="noreferrer">
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

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderCatalog();
});

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
