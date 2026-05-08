let catalog = { sections: [] };

// 页面加载逻辑
document.addEventListener("DOMContentLoaded", async () => {
  const authRes = await fetch("/api/check-auth");
  const { authenticated } = await authRes.json();
  
  if (authenticated) {
    showAdmin();
  } else {
    showLogin();
  }
});

function showLogin() {
  document.getElementById("loginView").classList.remove("hidden");
  document.getElementById("adminView").classList.add("hidden");
}

async function showAdmin() {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("adminView").classList.remove("hidden");
  await loadCatalog();
}

// 登录处理
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  
  const data = await res.json();
  if (data.success) {
    showAdmin();
  } else {
    alert(data.message);
  }
});

// 退出登录
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  showLogin();
});

// 加载数据
async function loadCatalog() {
  const res = await fetch("/api/catalog");
  catalog = await res.json();
  renderAdmin();
}

// 保存数据
async function saveCatalog() {
  const res = await fetch("/api/catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(catalog)
  });
  if (res.ok) {
    alert("保存成功");
    renderAdmin();
  } else {
    alert("保存失败");
  }
}

// 渲染管理界面
function renderAdmin() {
  const list = document.getElementById("sectionsList");
  list.innerHTML = catalog.sections.map((section, sIndex) => `
    <div class="section-editor">
      <div class="section-header">
        <div>
          <h2 style="margin:0">${section.title} <small style="color:#94a3b8; font-weight:normal; font-size:14px;">(${section.id})</small></h2>
          <p style="margin:4px 0 0; color:#64748b; font-size:13px;">${section.description || "无描述"}</p>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-ghost" onclick="editSection(${sIndex})">编辑分类</button>
          <button class="btn btn-danger" onclick="deleteSection(${sIndex})">删除分类</button>
          <button class="btn btn-primary" onclick="addItem('${section.id}')">+ 添加项目</button>
        </div>
      </div>
      <div class="items-list">
        <div class="item-row" style="font-weight:600; color:#94a3b8; font-size:12px; border-bottom:1px solid #e2e8f0; padding-bottom:8px;">
          <div>名称</div>
          <div>描述 / URL</div>
          <div>类型</div>
          <div>状态</div>
          <div>操作</div>
        </div>
        ${section.items.map((item, iIndex) => `
          <div class="item-row">
            <div style="font-weight:600">${item.name}</div>
            <div style="font-size:13px; color:#64748b;">
              <div>${item.description || "-"}</div>
              <div style="color:#94a3b8; font-family:monospace; font-size:11px;">${item.url}</div>
            </div>
            <div><span class="type-pill type-${item.type}" style="font-size:11px;">${item.type}</span></div>
            <div style="font-size:12px;">${item.status || "-"}</div>
            <div style="display:flex; gap:4px;">
              <button class="btn btn-ghost" style="padding:4px 8px;" onclick="editItem('${section.id}', ${iIndex})">编辑</button>
              <button class="btn btn-danger" style="padding:4px 8px;" onclick="deleteItem('${section.id}', ${iIndex})">删除</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");
}

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
  
  const item = {
    name: document.getElementById("itemName").value,
    description: document.getElementById("itemDesc").value,
    url: document.getElementById("itemUrl").value,
    type: document.getElementById("itemType").value,
    tags: document.getElementById("itemTags").value.split(",").map(t => t.trim()).filter(t => t),
    status: document.getElementById("itemStatus").value
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
