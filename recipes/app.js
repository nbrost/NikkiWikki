// Point this at your deployed Cloudflare Worker, e.g.
//   const API_BASE = "https://nikkiwikki-recipes.your-subdomain.workers.dev";
const API_BASE = "https://nikkiwikki-recipes.nbrost.workers.dev";

const TOKEN_KEY = "recipeBoxToken";

const statusEl = document.getElementById("status");
const listEl = document.getElementById("recipe-list");
const tagListEl = document.getElementById("tag-list");
const addForm = document.getElementById("add-form");
const addBtn = document.getElementById("add-btn");
const urlInput = document.getElementById("recipe-url");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const loginForm = document.getElementById("login-form");
const loginBtn = document.getElementById("login-btn");
const passwordInput = document.getElementById("password-input");
const lockBtn = document.getElementById("lock-btn");
const unlockedArea = document.getElementById("unlocked-area");
const manualForm = document.getElementById("manual-form");
const manualDetails = document.getElementById("manual-details");
const manualUrl = document.getElementById("manual-url");
const manualTitle = document.getElementById("manual-title");
const manualIngredients = document.getElementById("manual-ingredients");
const manualTags = document.getElementById("manual-tags");
const manualBtn = document.getElementById("manual-btn");
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modal-title");
const modalIngredients = document.getElementById("modal-ingredients");
const modalLink = document.getElementById("modal-link");

let activeTag = "";
let searchQuery = "";
let token = localStorage.getItem(TOKEN_KEY) || "";
let unlocked = false;
let lastRecipes = [];

function setStatus(message, kind) {
  statusEl.textContent = message || "";
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function normalizeUrl(value) {
  let v = String(value || "").trim();
  if (v && !/^https?:\/\//i.test(v)) v = "https://" + v;
  return v;
}

async function api(path, options = {}) {
  const headers = Object.assign({}, options.headers);
  if (token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login") setLocked();
  if (!res.ok) {
    const parts = [];
    parts.push(data.error || `Request failed (${res.status})`);
    if (data.where) parts.push("at " + data.where);
    if (data.cause) parts.push("(" + data.cause + ")");
    const error = new Error(parts.join(" "));
    error.manual = !!data.manual;
    throw error;
  }
  return data;
}

function setUnlocked() {
  unlocked = true;
  loginForm.hidden = true;
  unlockedArea.hidden = false;
  renderRecipes(lastRecipes);
}

function setLocked() {
  unlocked = false;
  token = "";
  localStorage.removeItem(TOKEN_KEY);
  loginForm.hidden = false;
  unlockedArea.hidden = true;
  renderRecipes(lastRecipes);
}

async function checkAuth() {
  try {
    await api("/auth");
    setUnlocked();
  } catch {
    setLocked();
  }
}

async function loadTags() {
  try {
    const { tags } = await api("/tags");
    tagListEl.innerHTML = "";
    const all = document.createElement("span");
    all.className = "tag-chip" + (activeTag ? "" : " active");
    all.textContent = "all";
    all.addEventListener("click", () => selectTag(""));
    tagListEl.appendChild(all);
    for (const { tag, count } of tags) {
      const chip = document.createElement("span");
      chip.className = "tag-chip" + (tag === activeTag ? " active" : "");
      chip.textContent = `${tag} (${count})`;
      chip.addEventListener("click", () => selectTag(tag));
      tagListEl.appendChild(chip);
    }
  } catch (err) {
    setStatus(err.message, "error");
  }
}

function selectTag(tag) {
  activeTag = activeTag === tag ? "" : tag;
  loadTags();
  loadRecipes();
}

async function loadRecipes() {
  const params = new URLSearchParams();
  if (activeTag) params.set("tag", activeTag);
  if (searchQuery) params.set("q", searchQuery);
  const qs = params.toString();
  try {
    const { recipes } = await api("/recipes" + (qs ? "?" + qs : ""));
    lastRecipes = recipes;
    renderRecipes(recipes);
  } catch (err) {
    setStatus(err.message, "error");
  }
}

function renderRecipes(recipes) {
  listEl.innerHTML = "";
  if (!recipes.length) {
    listEl.innerHTML = "<p>No recipes saved yet. Add one above!</p>";
    return;
  }
  for (const recipe of recipes) {
    const card = document.createElement("div");
    card.className = "card";

    if (recipe.image) {
      const img = document.createElement("img");
      img.src = recipe.image;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", () => img.remove());
      card.appendChild(img);
    }

    const body = document.createElement("div");
    body.className = "body";

    const title = document.createElement("a");
    title.className = "title";
    title.href = recipe.url;
    title.target = "_blank";
    title.rel = "noopener";
    title.textContent = recipe.title || recipe.url;
    body.appendChild(title);

    const source = document.createElement("span");
    source.className = "source";
    source.textContent = recipe.source || "";
    body.appendChild(source);

    const tags = document.createElement("div");
    tags.className = "card-tags";
    for (const tag of recipe.tags) {
      const t = document.createElement("span");
      t.textContent = tag;
      if (unlocked) {
        const x = document.createElement("button");
        x.type = "button";
        x.className = "tag-remove";
        x.textContent = "\u00d7";
        x.title = "Remove tag";
        x.addEventListener("click", () => removeTag(recipe.id, tag));
        t.appendChild(x);
      }
      tags.appendChild(t);
    }
    body.appendChild(tags);

    if (unlocked) {
      const tagForm = document.createElement("form");
      tagForm.className = "add-tag";
      const tagInput = document.createElement("input");
      tagInput.type = "text";
      tagInput.placeholder = "add a tag";
      tagInput.maxLength = 40;
      const tagBtn = document.createElement("button");
      tagBtn.type = "submit";
      tagBtn.textContent = "+";
      tagForm.appendChild(tagInput);
      tagForm.appendChild(tagBtn);
      tagForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = tagInput.value.trim();
        if (value) addTag(recipe.id, value);
      });
      body.appendChild(tagForm);
    }

    if (recipe.ingredients.length) {
      const ingRow = document.createElement("div");
      ingRow.className = "ing-row";
      ingRow.title = "Click to view all ingredients";
      for (const name of recipe.ingredients.map((i) => i.name).filter(Boolean).slice(0, 5)) {
        const chip = document.createElement("span");
        chip.className = "ing-chip";
        chip.textContent = name;
        ingRow.appendChild(chip);
      }
      if (recipe.ingredients.length > 5) {
        const more = document.createElement("span");
        more.className = "ing-more";
        more.textContent = `+${recipe.ingredients.length - 5} more`;
        ingRow.appendChild(more);
      }
      ingRow.addEventListener("click", () => openModal(recipe));
      body.appendChild(ingRow);
    }

    if (unlocked) {
      const del = document.createElement("button");
      del.className = "delete";
      del.textContent = "Delete";
      del.addEventListener("click", () => removeRecipe(recipe.id));
      body.appendChild(del);
    }

    card.appendChild(body);
    listEl.appendChild(card);
  }
}

async function removeRecipe(id) {
  if (!confirm("Remove this recipe?")) return;
  try {
    await api("/recipes/" + id, { method: "DELETE" });
    await loadTags();
    await loadRecipes();
  } catch (err) {
    setStatus(err.message, "error");
  }
}

async function addTag(id, tag) {
  try {
    await api(`/recipes/${id}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag }),
    });
    await loadTags();
    await loadRecipes();
  } catch (err) {
    setStatus(err.message, "error");
  }
}

async function removeTag(id, tag) {
  try {
    await api(`/recipes/${id}/tags?tag=${encodeURIComponent(tag)}`, { method: "DELETE" });
    await loadTags();
    await loadRecipes();
  } catch (err) {
    setStatus(err.message, "error");
  }
}

function openModal(recipe) {
  modalTitle.textContent = recipe.title || recipe.url;
  modalIngredients.innerHTML = "";
  for (const ing of recipe.ingredients) {
    const li = document.createElement("li");
    li.textContent = ing.raw;
    modalIngredients.appendChild(li);
  }
  modalLink.href = recipe.url;
  modal.hidden = false;
}

function closeModal() {
  modal.hidden = true;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = passwordInput.value;
  if (!password) return;
  loginBtn.disabled = true;
  setStatus("");
  try {
    const data = await api("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    token = data.token || "";
    if (token) localStorage.setItem(TOKEN_KEY, token);
    passwordInput.value = "";
    setStatus("Unlocked.", "ok");
    setUnlocked();
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    loginBtn.disabled = false;
  }
});

lockBtn.addEventListener("click", () => {
  setLocked();
  setStatus("Locked.");
});

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = normalizeUrl(urlInput.value);
  if (!url) return;
  addBtn.disabled = true;
  setStatus("Fetching and tagging recipe... this can take a few seconds.");
  try {
    const recipe = await api("/recipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    setStatus(`Saved "${recipe.title}".`, "ok");
    urlInput.value = "";
    await loadTags();
    await loadRecipes();
  } catch (err) {
    setStatus(err.message, "error");
    if (err.manual) {
      manualDetails.open = true;
      if (!manualUrl.value) manualUrl.value = url;
      manualTitle.focus();
    }
  } finally {
    addBtn.disabled = false;
  }
});

manualForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    url: normalizeUrl(manualUrl.value),
    title: manualTitle.value.trim(),
    ingredients: manualIngredients.value,
    tags: manualTags.value.trim(),
  };
  if (!payload.url || !payload.ingredients.trim()) {
    setStatus("Please enter a link and at least one ingredient.", "error");
    return;
  }
  manualBtn.disabled = true;
  setStatus("Saving recipe...");
  try {
    const recipe = await api("/recipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setStatus(`Saved "${recipe.title}".`, "ok");
    manualForm.reset();
    manualDetails.open = false;
    await loadTags();
    await loadRecipes();
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    manualBtn.disabled = false;
  }
});

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchQuery = searchInput.value.trim();
  loadRecipes();
});

document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-backdrop").addEventListener("click", closeModal);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

loadTags();
loadRecipes();
checkAuth();
