// Phone Notes — text a Telegram bot, notes land on lists.
//   "#todo buy milk"   -> adds to the "todo" list (list is created if new)
//   "#todo"            -> shows the todo list
//   "#todo done 2"     -> checks off item 2
//   "#todo clear"      -> removes checked-off items
//   "/lists"           -> shows all lists
//   anything without a # goes to the "inbox" list
//
// Runs on Cloudflare Workers with a D1 database bound as DB.
// Secrets: TELEGRAM_TOKEN (from @BotFather), APP_SECRET (any long random string).

import { PAGE_HTML } from "./page.js";

const DEFAULT_LIST = "inbox";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      await ensureSchema(env.DB);

      if (url.pathname === "/telegram" && request.method === "POST") {
        return handleTelegram(request, env);
      }
      if (url.pathname === "/setup") {
        return handleSetup(url, env);
      }
      if (url.pathname.startsWith("/api/")) {
        if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
        return handleApi(request, url, env);
      }
      if (url.pathname === "/") {
        const key = url.searchParams.get("key");
        if (key) {
          if (!env.APP_SECRET || key !== env.APP_SECRET) return html(loginPage("That key didn't match."), 401);
          // Remember the key in a cookie, then drop it from the address bar.
          return new Response(null, {
            status: 302,
            headers: {
              Location: "/",
              "Set-Cookie": `k=${encodeURIComponent(key)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
            },
          });
        }
        if (!isAuthed(request, env)) return html(loginPage());
        return html(PAGE_HTML);
      }
      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error(err);
      return new Response("Something went wrong: " + err.message, { status: 500 });
    }
  },
};

// ---------- Database ----------

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      done_at TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS items_list ON items(list_id, done, id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`),
  ]);
  schemaReady = true;
}

async function getSetting(db, key) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return row ? row.value : null;
}
async function setSetting(db, key, value) {
  await db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value).run();
}

async function findList(db, name) {
  return db.prepare("SELECT id, name FROM lists WHERE name = ?").bind(name).first();
}

// Returns { list, created }
async function getOrCreateList(db, name) {
  const existing = await findList(db, name);
  if (existing) return { list: existing, created: false };
  await db.prepare("INSERT OR IGNORE INTO lists (name) VALUES (?)").bind(name).run();
  return { list: await findList(db, name), created: true };
}

async function openItems(db, listId) {
  const { results } = await db.prepare(
    "SELECT id, text FROM items WHERE list_id = ? AND done = 0 ORDER BY id"
  ).bind(listId).all();
  return results;
}

// ---------- Message parsing (shared by Telegram and the web page) ----------

// Normalize a tag: lowercase, letters/numbers/_/- only.
function normalizeTag(tag) {
  return tag.toLowerCase();
}

export function parseMessage(raw) {
  const text = (raw || "").trim();
  if (!text) return { type: "empty" };

  const cmd = text.toLowerCase();
  if (cmd === "/start" || cmd === "/help" || cmd === "help") return { type: "help" };
  if (cmd === "/lists" || cmd === "lists" || cmd === "#lists" || cmd === "#") return { type: "lists" };

  const m = text.match(/^#([\p{L}\p{N}_-]+)\s*([\s\S]*)$/u);
  if (!m) return { type: "add", list: DEFAULT_LIST, text };

  const list = normalizeTag(m[1]);
  const rest = m[2].trim();
  if (!rest) return { type: "show", list };

  const done = rest.match(/^(?:done|x|check)\s+([\d,\s]+)$/i);
  if (done) return { type: "done", list, numbers: parseNumbers(done[1]) };

  const del = rest.match(/^(?:delete|del|remove)\s+([\d,\s]+)$/i);
  if (del) return { type: "delete", list, numbers: parseNumbers(del[1]) };

  if (/^clear$/i.test(rest)) return { type: "clear", list };

  return { type: "add", list, text: rest };
}

function parseNumbers(s) {
  return [...new Set(s.split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => n > 0))];
}

// Run a parsed command and return a reply string.
async function runCommand(db, cmd) {
  switch (cmd.type) {
    case "empty":
      return "Send me a note like: #todo buy milk";

    case "help":
      return HELP_TEXT;

    case "lists": {
      const { results } = await db.prepare(
        `SELECT l.name, COUNT(i.id) AS open FROM lists l
         LEFT JOIN items i ON i.list_id = l.id AND i.done = 0
         GROUP BY l.id ORDER BY l.name`
      ).all();
      if (!results.length) return "No lists yet. Send something like: #todo buy milk";
      return "Your lists:\n" + results.map((r) => `#${r.name} (${r.open})`).join("\n");
    }

    case "add": {
      const { list, created } = await getOrCreateList(db, cmd.list);
      await db.prepare("INSERT INTO items (list_id, text) VALUES (?, ?)").bind(list.id, cmd.text).run();
      const count = (await openItems(db, list.id)).length;
      return created
        ? `🆕 Created new list #${list.name}\n✓ Added (1 item)`
        : `✓ Added to #${list.name} (${count} item${count === 1 ? "" : "s"})`;
    }

    case "show": {
      const list = await findList(db, cmd.list);
      if (!list) return `There's no #${cmd.list} list yet. Send "#${cmd.list} something" to start it.`;
      const items = await openItems(db, list.id);
      if (!items.length) return `#${list.name} is empty 🎉`;
      return `#${list.name}\n` + items.map((it, i) => `${i + 1}. ${it.text}`).join("\n");
    }

    case "done":
    case "delete": {
      const list = await findList(db, cmd.list);
      if (!list) return `There's no #${cmd.list} list.`;
      const items = await openItems(db, list.id);
      const picked = cmd.numbers.map((n) => items[n - 1]).filter(Boolean);
      if (!picked.length) return `#${list.name} doesn't have item ${cmd.numbers.join(", ")}. Send "#${list.name}" to see the numbers.`;
      const stmt = cmd.type === "done"
        ? db.prepare("UPDATE items SET done = 1, done_at = datetime('now') WHERE id = ?")
        : db.prepare("DELETE FROM items WHERE id = ?");
      await db.batch(picked.map((it) => stmt.bind(it.id)));
      const verb = cmd.type === "done" ? "✓ Checked off" : "🗑 Deleted";
      const left = items.length - picked.length;
      return `${verb}: ${picked.map((it) => it.text).join("; ")}\n#${list.name} has ${left} item${left === 1 ? "" : "s"} left.`;
    }

    case "clear": {
      const list = await findList(db, cmd.list);
      if (!list) return `There's no #${cmd.list} list.`;
      const res = await db.prepare("DELETE FROM items WHERE list_id = ? AND done = 1").bind(list.id).run();
      return `Cleared ${res.meta.changes} checked-off item(s) from #${list.name}.`;
    }
  }
  return "I didn't understand that. Send /help for examples.";
}

const HELP_TEXT = `📝 Phone Notes

#todo buy milk  → add to your todo list
#idea podcast about bees  → add to your idea list
#anything ...  → a new #tag makes a new list

#todo  → show the list
#todo done 2  → check off item 2
#todo delete 2  → delete item 2
#todo clear  → remove checked-off items
/lists  → show all lists

No # at the start? It goes to #inbox.`;

// ---------- Telegram ----------

async function handleTelegram(request, env) {
  // Telegram sends back the secret we gave it in /setup; reject anything else.
  if (!env.APP_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.APP_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await request.json();
  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat) return new Response("ok");

  const chatId = String(msg.chat.id);
  const db = env.DB;

  // The first person to message the bot becomes its owner. Everyone else is ignored.
  let owner = await getSetting(db, "owner_chat_id");
  let greeting = "";
  if (!owner) {
    await setSetting(db, "owner_chat_id", chatId);
    owner = chatId;
    greeting = "👋 This bot is now linked to you — only you can use it.\n\n";
  }
  if (chatId !== owner) return reply(chatId, "Sorry, this is a private notes bot.");

  if (typeof msg.text !== "string") {
    return reply(chatId, greeting + "I can only save text messages for now.");
  }
  if (update.edited_message) return new Response("ok"); // don't double-add edits

  const cmd = parseMessage(msg.text);
  const text = await runCommand(db, cmd);
  return reply(chatId, greeting + text);
}

// Replying inside the webhook response saves a separate API call.
function reply(chatId, text) {
  return json({ method: "sendMessage", chat_id: Number(chatId), text });
}

async function handleSetup(url, env) {
  if (!env.APP_SECRET || url.searchParams.get("key") !== env.APP_SECRET) {
    return html(setupPage("❌ Wrong or missing key. Open /setup?key=YOUR_APP_SECRET"), 401);
  }
  if (!env.TELEGRAM_TOKEN) {
    return html(setupPage("❌ TELEGRAM_TOKEN secret isn't set in Cloudflare yet."), 500);
  }
  const webhookUrl = `${url.origin}/telegram`;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: env.APP_SECRET,
      allowed_updates: ["message", "edited_message"],
      drop_pending_updates: true,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    return html(setupPage(`❌ Telegram said: ${escapeHtml(data.description || res.statusText)}. Double-check TELEGRAM_TOKEN.`), 500);
  }
  return html(setupPage(
    `✅ All set! Telegram will now send your messages to this app.<br><br>` +
    `Open your bot in Telegram and send <b>#todo test</b>.<br><br>` +
    `<a href="/?key=${encodeURIComponent(env.APP_SECRET)}">Open your lists page →</a>`
  ));
}

// ---------- Web page API ----------

function isAuthed(request, env) {
  if (!env.APP_SECRET) return false;
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)k=([^;]+)/);
  return !!m && decodeURIComponent(m[1]) === env.APP_SECRET;
}

async function handleApi(request, url, env) {
  const db = env.DB;
  const path = url.pathname;

  if (path === "/api/lists" && request.method === "GET") {
    const { results: lists } = await db.prepare("SELECT id, name, created_at FROM lists ORDER BY name").all();
    const { results: items } = await db.prepare(
      "SELECT id, list_id, text, done, created_at FROM items ORDER BY done, id"
    ).all();
    const byList = {};
    for (const it of items) (byList[it.list_id] ||= []).push(it);
    return json(lists.map((l) => ({ ...l, items: byList[l.id] || [] })));
  }

  if (path === "/api/command" && request.method === "POST") {
    const { text } = await request.json();
    return json({ reply: await runCommand(db, parseMessage(text)) });
  }

  const itemMatch = path.match(/^\/api\/items\/(\d+)$/);
  if (itemMatch) {
    const id = Number(itemMatch[1]);
    if (request.method === "PATCH") {
      const { done } = await request.json();
      await db.prepare("UPDATE items SET done = ?, done_at = CASE WHEN ? THEN datetime('now') ELSE NULL END WHERE id = ?")
        .bind(done ? 1 : 0, done ? 1 : 0, id).run();
      return json({ ok: true });
    }
    if (request.method === "DELETE") {
      await db.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  const listMatch = path.match(/^\/api\/lists\/(\d+)$/);
  if (listMatch && request.method === "DELETE") {
    const id = Number(listMatch[1]);
    await db.batch([
      db.prepare("DELETE FROM items WHERE list_id = ?").bind(id),
      db.prepare("DELETE FROM lists WHERE id = ?").bind(id),
    ]);
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}

// ---------- Helpers ----------

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
function html(body, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const SIMPLE_STYLE = `<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 16px;color:#1c1c1e;background:#f7f7f5}
@media(prefers-color-scheme:dark){body{background:#141414;color:#eee}}
input,button{font:inherit;padding:10px 12px;border-radius:10px;border:1px solid #8884;width:100%;box-sizing:border-box;margin-top:8px}
button{background:#2f6fde;color:#fff;border:0}</style>`;

function loginPage(error = "") {
  return `<!doctype html><title>Phone Notes</title>${SIMPLE_STYLE}
<h1>📝 Phone Notes</h1>${error ? `<p style="color:#c33">${escapeHtml(error)}</p>` : ""}
<form method="get" action="/"><input name="key" type="password" placeholder="Your APP_SECRET" autofocus><button>Open my lists</button></form>`;
}
function setupPage(msg) {
  return `<!doctype html><title>Phone Notes setup</title>${SIMPLE_STYLE}<h1>📝 Setup</h1><p>${msg}</p>`;
}
