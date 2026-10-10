const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const UNITS = new Set([
  "cup", "cups", "tablespoon", "tablespoons", "tbsp", "tbs", "teaspoon", "teaspoons",
  "tsp", "gram", "grams", "g", "kg", "kilogram", "kilograms", "ounce", "ounces", "oz",
  "pound", "pounds", "lb", "lbs", "milliliter", "milliliters", "ml", "liter", "liters",
  "l", "pint", "pints", "quart", "quarts", "gallon", "gallons", "clove", "cloves",
  "can", "cans", "package", "packages", "pkg", "slice", "slices", "piece", "pieces",
  "pinch", "pinches", "dash", "dashes", "bunch", "bunches", "head", "heads", "stalk",
  "stalks", "sprig", "sprigs", "stick", "sticks", "jar", "jars", "bottle", "bottles",
  "box", "boxes", "bag", "bags", "container", "containers", "sheet", "sheets", "inch",
]);

const NOISE_WORDS = new Set([
  "of", "a", "an", "the", "about", "approximately", "plus", "more", "as", "needed",
  "to", "taste", "for", "serving", "garnish", "divided", "optional", "fresh", "freshly",
  "finely", "roughly", "thinly", "chopped", "diced", "minced", "sliced", "grated",
  "peeled", "halved", "quartered", "crushed", "drained", "rinsed", "softened", "melted",
  "beaten", "cubed", "shredded", "trimmed", "washed", "room", "temperature", "or",
  "and", "into", "cut", "your", "favorite", "large", "medium", "small", "whole", "each",
  "one", "two", "three", "four", "five", "six", "half", "quarter", "third",
]);

const MAX_TAGS = 40;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }), allowed, origin);
    }

    const { pathname } = new URL(request.url);

    try {
      let res;
      if (pathname === "/" || pathname === "/health") {
        res = json({ ok: true });
      } else if (pathname === "/login" && request.method === "POST") {
        res = await login(request, env);
      } else if (pathname === "/auth" && request.method === "GET") {
        res = (await requireAuth(request, env)) || json({ ok: true });
      } else if (pathname === "/recipes" && request.method === "GET") {
        res = await listRecipes(request, env);
      } else if (pathname === "/recipes" && request.method === "POST") {
        res = (await requireAuth(request, env)) || (await addRecipe(request, env));
      } else if (/^\/recipes\/\d+\/tags$/.test(pathname) && request.method === "POST") {
        res = (await requireAuth(request, env)) || (await addTag(request, env, recipeId(pathname)));
      } else if (/^\/recipes\/\d+\/tags$/.test(pathname) && request.method === "DELETE") {
        res = (await requireAuth(request, env)) || (await removeTag(request, env, recipeId(pathname)));
      } else if (pathname.startsWith("/recipes/") && request.method === "DELETE") {
        res = (await requireAuth(request, env)) || (await deleteRecipe(pathname, env));
      } else if (pathname === "/tags" && request.method === "GET") {
        res = await listTags(env);
      } else {
        res = json({ error: "Not found" }, 404);
      }
      return cors(res, allowed, origin);
    } catch (err) {
      return cors(json({ error: err.message || "Server error" }, 500), allowed, origin);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function cors(res, allowed, origin) {
  res.headers.set("Vary", "Origin");
  const list = String(allowed || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.includes("*")) {
    res.headers.set("Access-Control-Allow-Origin", "*");
  } else if (origin && list.includes(origin)) {
    res.headers.set("Access-Control-Allow-Origin", origin);
  }
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res;
}

// ---------------------------------------------------------------------------
// Auth (shared password -> signed, expiring token)
// ---------------------------------------------------------------------------

// Returns a 401 Response when the request is unauthorized, or null if allowed.
// If APP_PASSWORD is not configured the gate is disabled (useful for local dev).
async function requireAuth(request, env) {
  if (!env.APP_PASSWORD) return null;
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (await verifyToken(token, env)) return null;
  return json({ error: "Please unlock the recipe box first." }, 401);
}

async function login(request, env) {
  if (!env.APP_PASSWORD) return json({ token: null, gate: false });
  const body = await request.json().catch(() => null);
  const password = body && body.password ? String(body.password) : "";
  if (!(await timingEqual(password, env.APP_PASSWORD))) {
    return json({ error: "Incorrect password." }, 401);
  }
  return json({ token: await createToken(env) });
}

async function createToken(env) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 days
  const payload = String(exp);
  const sig = await hmac(payload, env.TOKEN_SECRET || env.APP_PASSWORD);
  return `${payload}.${sig}`;
}

async function verifyToken(token, env) {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  if (!/^\d+$/.test(payload) || Number(payload) < Date.now()) return false;
  const expected = await hmac(payload, env.TOKEN_SECRET || env.APP_PASSWORD);
  return timingEqual(sig, expected);
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret || ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return b64url(new Uint8Array(sig));
}

async function timingEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a || "")),
    crypto.subtle.digest("SHA-256", enc.encode(b || "")),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

function b64url(bytes) {
  let str = "";
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

async function addRecipe(request, env) {
  const body = await request.json().catch(() => null);
  const target = body && body.url ? String(body.url).trim() : "";
  if (!/^https?:\/\//i.test(target)) {
    return json({ error: "Please provide a valid http(s) recipe URL." }, 400);
  }

  const existing = await env.DB.prepare("SELECT id FROM recipes WHERE url = ?")
    .bind(target)
    .first();
  if (existing) return json(await getRecipe(env, existing.id));

  let parsed;
  try {
    parsed = await parseRecipe(target, env);
  } catch (err) {
    return json({ error: err.message }, 502);
  }
  if (!parsed || !parsed.ingredients.length) {
    return json(
      {
        error:
          "Couldn't find recipe ingredients at that URL. It may not be a recipe page, " +
          "or the site may be hiding the recipe behind a paywall/bot check.",
      },
      422
    );
  }

  const { last_row_id } = await env.DB.prepare(
    "INSERT INTO recipes (url, title, image, source) VALUES (?, ?, ?, ?)"
  )
    .bind(target, parsed.title || target, parsed.image || null, hostname(target))
    .run();

  const statements = [];
  for (const raw of parsed.ingredients) {
    const name = normalizeIngredient(raw);
    if (!name) continue;
    statements.push(
      env.DB.prepare("INSERT INTO ingredients (recipe_id, raw, name) VALUES (?, ?, ?)").bind(
        last_row_id,
        raw,
        name
      )
    );
  }
  for (const tag of parsed.tags) {
    statements.push(
      env.DB.prepare("INSERT INTO tags (recipe_id, tag) VALUES (?, ?)").bind(last_row_id, tag)
    );
  }
  if (statements.length) await env.DB.batch(statements);

  return json(await getRecipe(env, last_row_id), 201);
}

async function listRecipes(request, env) {
  const params = new URL(request.url).searchParams;
  const tag = (params.get("tag") || "").trim().toLowerCase();
  const q = (params.get("q") || "").trim();
  const limit = Math.min(Number(params.get("limit")) || 60, 200);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);

  const where = [];
  const binds = [];
  let join = "";
  if (tag) {
    join = "JOIN tags t ON t.recipe_id = r.id";
    where.push("t.tag = ?");
    binds.push(tag);
  }
  if (q) {
    where.push("r.title LIKE ?");
    binds.push(`%${q}%`);
  }
  const sql =
    `SELECT DISTINCT r.id, r.url, r.title, r.image, r.source, r.created_at FROM recipes r ` +
    `${join} ${where.length ? "WHERE " + where.join(" AND ") : ""} ` +
    `ORDER BY r.created_at DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ recipes: await attachDetails(results, env) });
}

async function listTags(env) {
  const { results } = await env.DB.prepare(
    "SELECT tag, COUNT(*) AS count FROM tags GROUP BY tag ORDER BY count DESC, tag ASC LIMIT 300"
  ).all();
  return json({ tags: results });
}

async function deleteRecipe(pathname, env) {
  const id = Number(pathname.split("/").pop());
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid id" }, 400);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tags WHERE recipe_id = ?").bind(id),
    env.DB.prepare("DELETE FROM ingredients WHERE recipe_id = ?").bind(id),
    env.DB.prepare("DELETE FROM recipes WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
}

function recipeId(pathname) {
  return Number(pathname.split("/")[2]);
}

function cleanTag(value) {
  if (value === null || value === undefined) return "";
  return String(value).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 40);
}

async function addTag(request, env, id) {
  const body = await request.json().catch(() => null);
  const tag = cleanTag(body && body.tag);
  if (!tag) return json({ error: "Tag is required." }, 400);
  const exists = await env.DB.prepare("SELECT 1 FROM tags WHERE recipe_id = ? AND tag = ?")
    .bind(id, tag)
    .first();
  if (!exists) {
    await env.DB.prepare("INSERT INTO tags (recipe_id, tag) VALUES (?, ?)").bind(id, tag).run();
  }
  return json(await getRecipe(env, id));
}

async function removeTag(request, env, id) {
  let tag = cleanTag(new URL(request.url).searchParams.get("tag"));
  if (!tag) {
    const body = await request.json().catch(() => null);
    tag = cleanTag(body && body.tag);
  }
  if (!tag) return json({ error: "Tag is required." }, 400);
  await env.DB.prepare("DELETE FROM tags WHERE recipe_id = ? AND tag = ?").bind(id, tag).run();
  return json(await getRecipe(env, id));
}

async function getRecipe(env, id) {
  const recipe = await env.DB.prepare(
    "SELECT id, url, title, image, source, created_at FROM recipes WHERE id = ?"
  )
    .bind(id)
    .first();
  if (!recipe) return json({ error: "Recipe not found" }, 404);
  const [full] = await attachDetails([recipe], env);
  return full;
}

async function attachDetails(recipes, env) {
  if (!recipes.length) return [];
  const ids = recipes.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const [tagRows, ingRows] = await Promise.all([
    env.DB.prepare(`SELECT recipe_id, tag FROM tags WHERE recipe_id IN (${placeholders})`)
      .bind(...ids)
      .all(),
    env.DB.prepare(
      `SELECT recipe_id, raw, name FROM ingredients WHERE recipe_id IN (${placeholders})`
    )
      .bind(...ids)
      .all(),
  ]);

  const tags = new Map();
  for (const row of tagRows.results) {
    if (!tags.has(row.recipe_id)) tags.set(row.recipe_id, []);
    tags.get(row.recipe_id).push(row.tag);
  }
  const ingredients = new Map();
  for (const row of ingRows.results) {
    if (!ingredients.has(row.recipe_id)) ingredients.set(row.recipe_id, []);
    ingredients.get(row.recipe_id).push({ raw: row.raw, name: row.name });
  }

  return recipes.map((r) => ({
    ...r,
    tags: tags.get(r.id) || [],
    ingredients: ingredients.get(r.id) || [],
  }));
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

async function parseRecipe(target, env) {
  let html;
  let res;
  try {
    res = await fetch(target, { headers: FETCH_HEADERS, redirect: "follow" });
  } catch (err) {
    throw new Error(`Couldn't reach that URL (${err.message}).`);
  }
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429
        ? " — the site is blocking automated access or requires a subscription."
        : ".";
    throw new Error(`That site returned HTTP ${res.status}${hint}`);
  }
  html = await res.text();

  let data = extractFromJsonLd(html);
  if (!data) data = await aiParse(html, env);
  if (!data || !data.ingredients || !data.ingredients.length) return null;

  const tags = buildTags(data);
  return {
    title: clean(data.title) || null,
    image: pickImage(data.image),
    ingredients: data.ingredients.map((i) => String(i).trim()).filter(Boolean),
    tags,
  };
}

function extractFromJsonLd(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const nodes = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = m[1].trim().replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
    try {
      collectRecipeNodes(JSON.parse(text), nodes);
    } catch {
      // some sites emit invalid JSON-LD; ignore and try the next block
    }
  }
  return nodes.find((n) => Array.isArray(n.recipeIngredient) && n.recipeIngredient.length) ||
    nodes.find((n) => Array.isArray(n.ingredients) && n.ingredients.length) ||
    nodes[0] ||
    null;
}

function collectRecipeNodes(value, out) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectRecipeNodes(item, out);
    return;
  }
  const type = value["@type"];
  const isRecipe =
    (typeof type === "string" && /recipe/i.test(type)) ||
    (Array.isArray(type) && type.some((t) => /recipe/i.test(String(t))));
  if (isRecipe) out.push(value);
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) {
    if (value[key]) collectRecipeNodes(value[key], out);
  }
}

async function aiParse(html, env) {
  if (!env.AI) return null;
  const text = htmlToText(html).slice(0, 8000);
  if (text.length < 40) return null;
  try {
    const out = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You extract recipes from web page text. Reply with ONLY minified JSON: " +
            '{"title":string,"ingredients":string[],"keywords":string[],"cuisine":string,"category":string}. ' +
            'If there is no recipe, reply {"title":"","ingredients":[]}.',
        },
        { role: "user", content: `Web page text:\n\n${text}` },
      ],
      max_tokens: 1024,
    });
    const parsed = parseLooseJson(out.response);
    if (!parsed || !Array.isArray(parsed.ingredients)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildTags(data) {
  const tags = new Set();
  for (const raw of data.ingredients || []) {
    const name = normalizeIngredient(raw);
    if (name && name.length > 1) tags.add(name);
  }
  const extra = []
    .concat(data.keywords || [])
    .concat(data.recipeCuisine || data.cuisine || [])
    .concat(data.recipeCategory || data.category || []);
  for (const item of extra) {
    for (const part of String(item).split(",")) {
      const t = clean(part);
      if (t && t.length > 1) tags.add(t.toLowerCase());
    }
  }
  return [...tags].slice(0, MAX_TAGS);
}

function normalizeIngredient(raw) {
  let s = ` ${String(raw).toLowerCase()} `;
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/\b\d+\s*\/\s*\d+\b/g, " ");
  s = s.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, " ");
  s = s.replace(/\b\d+([.,]\d+)?\b/g, " ");
  s = s.replace(/[^a-z\s'-]/g, " ");
  let words = s.split(/\s+/).filter(Boolean);
  words = words.filter((w) => !UNITS.has(w) && !NOISE_WORDS.has(w));
  return words.join(" ").replace(/'/g, "").trim();
}

function pickImage(image) {
  if (!image) return null;
  const first = Array.isArray(image) ? image[0] : image;
  if (typeof first === "string") return first;
  if (first && typeof first === "object") return first.url || null;
  return null;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLooseJson(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clean(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) value = value[0];
  return String(value).trim();
}

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
