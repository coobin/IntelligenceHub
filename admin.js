let catalog = { sections: [] };

// 页面加载逻辑
document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("cih_token");
  const authRes = await fetch("/api/check-auth", {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const { authenticated } = await authRes.json();
  
  if (authenticated) {
    showAdmin();
    loadCatalog();
    loadStats();
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
  await loadStats();
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
    localStorage.setItem("cih_token", data.token);
    showAdmin();
  } else {
    alert(data.message);
  }
});

// 退出登录
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  localStorage.removeItem("cih_token");
  showLogin();
});

// Tab 切换逻辑
document.getElementById("tabDashboard").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("dashboardView").classList.remove("hidden");
  document.getElementById("editorView").classList.add("hidden");
  document.getElementById("tabDashboard").classList.add("active");
  document.getElementById("tabEditor").classList.remove("active");
  loadStats();
});

document.getElementById("tabEditor").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("dashboardView").classList.add("hidden");
  document.getElementById("editorView").classList.remove("hidden");
  document.getElementById("tabDashboard").classList.remove("active");
  document.getElementById("tabEditor").classList.add("active");
  renderAdmin(); // 确保渲染
});

// 加载数据
async function loadCatalog() {
  const token = localStorage.getItem("cih_token");
  const res = await fetch("/api/catalog", {
    headers: { "Authorization": `Bearer ${token}` }
  });
  catalog = await res.json();
  renderAdmin();
}

// 保存数据
async function saveCatalog() {
  const token = localStorage.getItem("cih_token");
  const res = await fetch("/api/catalog", {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
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
  const token = localStorage.getItem("cih_token");
  const res = await fetch("/api/stats", {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const stats = await res.json();
  renderStats(stats);
}

function renderStats(stats) {
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("totalPV").innerText = stats.pageViews || 0;
  document.getElementById("todayPV").innerText = stats.daily[today] || 0;
  
  const totalItems = catalog.sections.reduce((sum, s) => sum + s.items.length, 0);
  document.getElementById("activeEntries").innerText = totalItems;

  // 渲染排名
  const rankList = document.getElementById("rankList");
  const sortedClicks = Object.entries(stats.clicks || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  const maxClicks = sortedClicks[0]?.[1] || 1;
  
  rankList.innerHTML = sortedClicks.map(([name, count]) => `
    <div class="rank-item">
      <span style="width: 100px; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}</span>
      <div class="bar-outer">
        <div class="bar-inner" style="width: ${(count / maxClicks) * 100}%"></div>
      </div>
      <span style="font-weight: 600; color: #1e293b;">${count}</span>
    </div>
  `).join("") || '<p style="color:#94a3b8; text-align:center; padding:20px;">暂无点击数据</p>';

  // 渲染趋势 (最近 7 天)
  const trendList = document.getElementById("trendList");
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split("T")[0]);
  }

  const maxDaily = Math.max(...days.map(d => stats.daily[d] || 0), 1);

  trendList.innerHTML = days.map(d => {
    const val = stats.daily[d] || 0;
    const height = (val / maxDaily) * 100;
    const label = d.split("-").slice(1).join("/");
    return `
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%;">
        <div style="flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center;">
          <div style="width: 100%; max-width: 30px; height: ${height}%; background: var(--admin-accent); border-radius: 4px; position: relative;" title="${d}: ${val}">
            ${val > 0 ? `<span style="position: absolute; top: -20px; left: 50%; transform: translateX(-50%); font-size: 10px; color: #64748b;">${val}</span>` : ""}
          </div>
        </div>
        <span style="font-size: 10px; color: #94a3b8; margin-top: 8px;">${label}</span>
      </div>
    `;
  }).join("");

  // 渲染最近访客
  const recentList = document.getElementById("recentList");
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
        ${(stats.recent || []).map(r => `
          <tr style="border-bottom: 1px solid #f8fafc;">
            <td style="padding: 12px 8px; color: #1e293b;">${r.time}</td>
            <td style="padding: 12px 8px;"><span style="font-weight: 600; color: var(--admin-accent);">${r.user || "未知"}</span></td>
            <td style="padding: 12px 8px;"><code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${r.ip}</code></td>
            <td style="padding: 12px 8px; color: #64748b; font-size: 12px;">${parseUA(r.ua)}</td>
          </tr>
        `).join("") || '<tr><td colspan="4" style="text-align:center; padding:20px; color:#94a3b8;">暂无记录</td></tr>'}
      </tbody>
    </table>
  `;
}

function parseUA(ua) {
  if (!ua) return "未知";
  if (ua.includes("MicroMessenger")) return "微信内置浏览器";
  if (ua.includes("Mobile")) return "移动设备";
  if (ua.includes("Windows")) return "Windows PC";
  if (ua.includes("Macintosh")) return "Mac PC";
  return "其他设备";
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
  
  const item = {
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
  
  const token = localStorage.getItem("cih_token");
  const formData = new FormData();
  formData.append("icon", input.files[0]);
  
  const btn = input.previousElementSibling;
  const originalText = btn.innerText;
  btn.innerText = "上传中...";
  btn.disabled = true;

  try {
    const res = await fetch("/api/upload-icon", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
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
