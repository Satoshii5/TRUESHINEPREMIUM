const ALLOWED_ORIGINS = ["https://satoshii5.github.io", "https://trueshinee.github.io"];
// Security controls: strict origin allowlist, hashed-IP API rate limits, expiring sessions, token-gated CRM routes, and transactional loyalty redemption.
const SYSTEM_PROMPT = [
  "Ты — вежливый русскоязычный AI-консультант клининговой компании TrueShine в Минске, Беларусь.",
  "Отвечай конкретно и дружелюбно, обычно 2–5 предложений. Не придумывай цены и обещания.",
  "Цены на сайте — только предварительные ориентиры: экспресс-уборка 2,75 BYN/м² (минимум 88 BYN); поддерживающая 3,75 BYN/м²; генеральная 5,25 BYN/м² (минимум 125 BYN); после ремонта 6,5 BYN/м² (минимум 250 BYN); после пожара 6,25 BYN/м² (минимум 375 BYN); генеральная уборка кухни от 200 BYN. Подписки: Базовый 291,20 BYN, Комфорт 504,40 BYN, Премиум 928,20 BYN в месяц. Всегда уточняй, что окончательная стоимость подтверждается после уточнения объекта.",
  "В калькуляторе отдельные процентные дополнительные услуги могут увеличивать расчёт на 20% каждая; фиксированные дополнения рассчитываются отдельно. Не обещай точную смету без данных об объекте и составе работ.",
  "Услуги: поддерживающая и генеральная уборка, уборка после ремонта и пожара, генеральная уборка кухни, химчистка мебели, чистка ковролина, комплексный клининг и аутсорсинг персонала.",
  "Телефоны: +375 33 684-88-44 и +375 25 908-51-27. Не утверждай, что заявка уже отправлена, пока сервер не подтвердил отправку.",
  "Ты — полноценный диалоговый помощник в стиле ChatGPT: учитывай контекст текущего диалога, задавай один уточняющий вопрос, если это необходимо, помогай подобрать услугу и объясняй различия простым языком. Не выдумывай характеристики, наличие свободных бригад, скидки или цены. Если клиент хочет оформить заказ, предложи форму заявки на сайте. Не запрашивай платёжные данные, пароли или чувствительную информацию."
].join("\n");

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });
}
async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error("Telegram secrets are not configured");
  const destinations = [...new Set([env.TELEGRAM_CHAT_ID, "-1003450248195"])];
  for (const chatId of destinations) {
    const response = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900), disable_web_page_preview: true })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error("Telegram delivery failed for destination " + chatId);
  }
}
async function sendTelegramChat(env, chatId, text, replyMarkup) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram bot is not configured");
  const payload = { chat_id: String(chatId), text: String(text).slice(0, 3900), disable_web_page_preview: true };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  const response = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error("Telegram sendMessage failed");
  return result;
}
function normalizePhone(value) {
  return String(value || "").replace(/[^0-9]/g, "").replace(/^00/, "");
}
async function checkRateLimit(env, request, bucket, limit, windowMs) {
  if (!env.DB) throw new Error("Rate-limit storage is unavailable");
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS api_rate_limits (rate_key TEXT PRIMARY KEY, window_started_at INTEGER NOT NULL, hits INTEGER NOT NULL, updated_at INTEGER NOT NULL)").run();
  const forwarded = request.headers.get("CF-Connecting-IP") || (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim();
  const ip = forwarded || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bucket + ":" + ip));
  const key = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  const now = Date.now(), cutoff = now - windowMs;
  await env.DB.prepare("INSERT INTO api_rate_limits (rate_key,window_started_at,hits,updated_at) VALUES (?,?,1,?) ON CONFLICT(rate_key) DO UPDATE SET hits=CASE WHEN api_rate_limits.window_started_at<=? THEN 1 ELSE api_rate_limits.hits+1 END, window_started_at=CASE WHEN api_rate_limits.window_started_at<=? THEN excluded.window_started_at ELSE api_rate_limits.window_started_at END, updated_at=excluded.updated_at")
    .bind(key, now, now, cutoff, cutoff).run();
  const row = await env.DB.prepare("SELECT hits,window_started_at FROM api_rate_limits WHERE rate_key=?").bind(key).first();
  const retryAfter = Math.max(1, Math.ceil((Number(row?.window_started_at || now) + windowMs - now) / 1000));
  return { allowed: Number(row?.hits || 0) <= limit, retryAfter };
}
async function handleTelegramWebhook(request, env, update) {
  if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!env.DB) return new Response("Database unavailable", { status: 503 });
  const message = update && update.message;
  if (!message || !message.chat || message.chat.type !== "private" || !message.from) return new Response("ok", { status: 200 });
  const chatId = String(message.chat.id);
  const text = String(message.text || "").trim();
  const start = /^\/start(?:@\w+)?(?:\s|$)/i.test(text);
  if (start) {
    await sendTelegramChat(env, chatId,
      "Здравствуйте! Чтобы связать Telegram с вашим аккаунтом TrueShine, нажмите кнопку «Поделиться номером». Номер должен совпадать с указанным при оформлении заказа.",
      { keyboard: [[{ text: "Поделиться моим номером", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
    );
    return new Response("ok", { status: 200 });
  }
  if (message.contact) {
    const contact = message.contact;
    if (!contact.user_id || Number(contact.user_id) !== Number(message.from.id)) {
      await sendTelegramChat(env, chatId, "Пожалуйста, поделитесь именно своим номером через кнопку внизу экрана.");
      return new Response("ok", { status: 200 });
    }
    const submittedPhone = normalizePhone(contact.phone_number);
    const result = await env.DB.prepare("SELECT id,phone FROM customers WHERE phone IS NOT NULL LIMIT 5000").all();
    const customer = (result.results || []).find(c => normalizePhone(c.phone) === submittedPhone);
    if (!customer) {
      await sendTelegramChat(env, chatId, "Не нашёл клиента с таким номером в базе TrueShine. Проверьте, что вы отправили тот же номер, который указывали при обращении, или свяжитесь с нами для помощи.");
      return new Response("ok", { status: 200 });
    }
    await env.DB.prepare("UPDATE customers SET telegram_chat_id=?,updated_at=? WHERE id=?")
      .bind(chatId, new Date().toISOString(), customer.id).run();
    await sendTelegramChat(env, chatId, "Готово! Telegram привязан к вашему профилю TrueShine. Теперь сюда могут приходить подтверждения заказов, напоминания и уведомления об оплате.", { remove_keyboard: true });
    return new Response("ok", { status: 200 });
  }
  await sendTelegramChat(env, chatId, "Чтобы привязать аккаунт TrueShine, отправьте /start и нажмите «Поделиться моим номером».");
  return new Response("ok", { status: 200 });
}
async function notifyCustomer(env, customer, subject, message) {
  const result = { email: "skipped", telegram: "skipped" };
  if (customer.email && env.RESEND_API_KEY && env.RESEND_FROM_EMAIL) {
    try { const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [customer.email], subject, text: message }) }); result.email = r.ok ? "sent" : "failed"; } catch { result.email = "failed"; }
  }
  if (customer.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
    try { const r = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: customer.telegram_chat_id, text: message.slice(0, 3900), disable_web_page_preview: true }) }); const data = await r.json(); result.telegram = r.ok && data.ok ? "sent" : "failed"; } catch { result.telegram = "failed"; }
  }
  return result;
}
async function sendDueReminders(env) {
  if (!env.DB) return;
  const now = Date.now(), from = new Date(now).toISOString(), until = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const rows = await env.DB.prepare("SELECT o.id,o.service,o.amount_minor,o.currency,o.service_at,c.name,c.email,c.telegram_chat_id FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.status IN ('pending','confirmed','in_progress') AND o.reminder_sent_at IS NULL AND o.service_at>? AND o.service_at<=? ORDER BY o.service_at LIMIT 100").bind(from, until).all();
  for (const o of rows.results || []) {
    const date = new Date(o.service_at).toLocaleString("ru-RU", { timeZone: "Europe/Minsk" });
    const amount = (Number(o.amount_minor || 0) / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const msg = "Напоминание TrueShine: завтра запланирована услуга «" + o.service + "» на " + date + " (время Минска). Сумма: " + amount + " " + o.currency + ". Если планы изменились, свяжитесь с нами.";
    const sent = await notifyCustomer(env, o, "Напоминание о заказе TrueShine", msg);
    const configured = [o.email && env.RESEND_API_KEY && env.RESEND_FROM_EMAIL, o.telegram_chat_id && env.TELEGRAM_BOT_TOKEN].filter(Boolean).length;
    const delivered = [sent.email === "sent", sent.telegram === "sent"].filter(Boolean).length;
    if (configured > 0 && configured === delivered) await env.DB.prepare("UPDATE orders SET reminder_sent_at=? WHERE id=? AND reminder_sent_at IS NULL").bind(new Date().toISOString(), o.id).run();
  }
}
export default {
  async scheduled(controller, env, ctx) { ctx.waitUntil(sendDueReminders(env)); },
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const url = new URL(request.url);
    const crmRead = request.method === "GET" && url.pathname.startsWith("/crm/");
    const accountRead = request.method === "GET" && url.pathname === "/account/me";
    if (request.method !== "POST" && !crmRead && !accountRead) return json({ error: "Method not allowed" }, 405, origin);
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "Origin not allowed" }, 403, origin);
    let body = {};
    if (request.method === "POST") { try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, origin); } }
    if (url.pathname === "/telegram/webhook" && request.method === "POST") {
      try { return await handleTelegramWebhook(request, env, body); }
      catch { return new Response("Temporary error", { status: 500 }); }
    }
    if (url.pathname.endsWith("/chat")) {
      const message = String(body.message || "").trim().slice(0, 2000);
      if (!message) return json({ error: "Message is required" }, 400, origin);
      try {
        const rate = await checkRateLimit(env, request, "chat", 30, 10 * 60 * 1000);
        if (!rate.allowed) return json({ error: "Слишком много сообщений. Повторите через " + rate.retryAfter + " сек." }, 429, origin);
      } catch (error) {
        console.error("[TrueShine] Chat rate-limit check failed", { message: String(error?.message || "unknown").slice(0, 200) });
        return json({ error: "Чат временно недоступен. Попробуйте позже." }, 503, origin);
      }
      if (!env.OPENAI_API_KEY) return json({ error: "AI is not configured" }, 503, origin);
      try {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { "Authorization": "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: env.OPENAI_MODEL || "gpt-4.1-mini",
            instructions: SYSTEM_PROMPT,
            input: Array.isArray(body.history) ? body.history.slice(-10).map(item => ({ role: item.role === "assistant" ? "assistant" : "user", content: String(item.content || "").slice(0, 2000) })).concat([{ role: "user", content: message }]) : message,
            max_output_tokens: 450
          })
        });
        const data = await response.json();
        if (!response.ok) return json({ error: "AI provider request failed" }, 502, origin);
        let answer = "";
        if (data.output_text) answer = data.output_text;
        if (!answer && Array.isArray(data.output)) {
          for (const item of data.output) for (const part of (item.content || [])) if (part.type === "output_text") answer += part.text || "";
        }
        return json({ answer: answer || "Не удалось подготовить ответ. Оставьте заявку, и команда TrueShine уточнит детали." }, 200, origin);
      } catch {
        return json({ error: "AI temporarily unavailable" }, 502, origin);
      }
    }
    if (url.pathname.endsWith("/lead")) {
      try {
        const rate = await checkRateLimit(env, request, "lead", 8, 10 * 60 * 1000);
        if (!rate.allowed) return json({ error: "Слишком много заявок с этого подключения. Повторите через " + rate.retryAfter + " сек." }, 429, origin);
      } catch (error) {
        console.error("[TrueShine] Lead rate-limit check failed", { message: String(error?.message || "unknown").slice(0, 200) });
        return json({ error: "Форма временно недоступна. Попробуйте позже или позвоните нам." }, 503, origin);
      }
      const safe = v => String(v || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 900);
      const name = safe(body.name), phone = safe(body.phone), service = safe(body.service), details = safe(body.details);
      const kind = safe(body.kind) || "Заявка";
      if (!name || !phone) return json({ error: "Name and phone are required" }, 400, origin);
      const lines = [
        "✨ НОВАЯ ЗАЯВКА TRUE SHINE",
        "Тип: " + kind,
        "Имя: " + name,
        "Телефон: " + phone,
        "Клиент: " + safe(body.audience),
        "Услуга: " + service,
        "Комментарий: " + details,
        "Страница: " + safe(body.page),
        "Время: " + new Date().toISOString()
      ];
      try {
        await sendTelegram(env, lines.join("\n"));
        return json({ ok: true, message: "Lead sent" }, 200, origin);
      } catch (error) {
        return json({ error: "Telegram delivery is not configured or failed" }, 503, origin);
      }
    }
    if (url.pathname.startsWith("/account/")) {
      if (!env.DB) return json({ error: "Сервис аккаунтов временно недоступен" }, 503, origin);
      const clean = v => String(v || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200);
      const ensureTables = async () => {
        // Older CRM installations may predate some customer-profile columns.
        // Migrate additively: preserve existing clients, orders and identifiers.
        const customerTable = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customers'").first();
        if (!customerTable) {
          await env.DB.prepare("CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, email TEXT, telegram_chat_id TEXT, language TEXT NOT NULL DEFAULT 'ru', notes TEXT NOT NULL DEFAULT '', sms_consent INTEGER NOT NULL DEFAULT 0, sms_consent_at TEXT, points INTEGER NOT NULL DEFAULT 0, paid_orders INTEGER NOT NULL DEFAULT 0, client_status TEXT NOT NULL DEFAULT 'Новый', discount_percent INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
        } else {
          const info = await env.DB.prepare("PRAGMA table_info(customers)").all();
          const columns = new Set((info.results || []).map(column => column.name));
          const migrations = [
            ["email", "TEXT"],
            ["telegram_chat_id", "TEXT"],
            ["language", "TEXT NOT NULL DEFAULT 'ru'"],
            ["notes", "TEXT NOT NULL DEFAULT ''"],
            ["sms_consent", "INTEGER NOT NULL DEFAULT 0"],
            ["sms_consent_at", "TEXT"],
            ["client_status", "TEXT NOT NULL DEFAULT 'Новый'"],
            ["discount_percent", "INTEGER NOT NULL DEFAULT 0"],
            ["created_at", "TEXT NOT NULL DEFAULT ''"],
            ["updated_at", "TEXT NOT NULL DEFAULT ''"]
          ];
          for (const [column, definition] of migrations) {
            if (!columns.has(column)) await env.DB.prepare("ALTER TABLE customers ADD COLUMN " + column + " " + definition).run();
          }
        }
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS customer_accounts (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE COLLATE NOCASE, phone_norm TEXT NOT NULL UNIQUE, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(customer_id) REFERENCES customers(id))").run();
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS customer_sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(account_id) REFERENCES customer_accounts(id))").run();
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS customer_loyalty (customer_id TEXT PRIMARY KEY, card_number TEXT NOT NULL UNIQUE, points INTEGER NOT NULL DEFAULT 0, lifetime_points INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, FOREIGN KEY(customer_id) REFERENCES customers(id))").run();
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS customer_order_loyalty (order_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, points_used INTEGER NOT NULL DEFAULT 0, refunded_at TEXT, created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(customer_id) REFERENCES customers(id))").run();
      };
      const hashText = async value => {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
        return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
      };
      const passwordHash = async (password, salt) => {
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
        const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 150000, hash: "SHA-256" }, key, 256);
        return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
      };
      const issueSession = async accountId => {
        const raw = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");
        const now = new Date(), expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare("INSERT INTO customer_sessions (token_hash,account_id,expires_at,created_at) VALUES (?,?,?,?)").bind(await hashText(raw), accountId, expires, now.toISOString()).run();
        return raw;
      };
      try {
        await ensureTables();
        if (url.pathname === "/account/register" || url.pathname === "/account/login") {
          const rate = await checkRateLimit(env, request, url.pathname === "/account/register" ? "register" : "login", url.pathname === "/account/register" ? 5 : 10, 15 * 60 * 1000);
          if (!rate.allowed) return json({ error: "Слишком много попыток. Повторите через " + rate.retryAfter + " сек." }, 429, origin);
        }
        if (url.pathname === "/account/register" && request.method === "POST") {
          const name = clean(body.name), email = clean(body.email).toLowerCase(), phone = clean(body.phone), password = String(body.password || "");
          const phoneNorm = normalizePhone(phone);
          if (name.length < 2 || !/^\+[1-9]\d{6,14}$/.test(phone) || password.length < 10 || password.length > 128 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return json({ error: "Укажите имя, телефон в международном формате и пароль от 10 символов. Email необязателен." }, 400, origin);
          const accountEmail = email || ("phone-" + phoneNorm.replace(/\D/g, "") + "@noemail.trueshine.invalid");
          const existingAccount = await env.DB.prepare("SELECT id FROM customer_accounts WHERE phone_norm=? OR (?<>'' AND email=? COLLATE NOCASE)").bind(phoneNorm, email, email).first();
          if (existingAccount) return json({ error: "Аккаунт с таким телефоном уже существует. Перейдите во вкладку «Вход» и войдите по номеру телефона." }, 409, origin);

          // Phone is the primary customer identity. Reuse an existing CRM row to preserve order history.
          const all = await env.DB.prepare("SELECT id,name,phone,email,telegram_chat_id,language,notes,client_status,discount_percent FROM customers WHERE phone IS NOT NULL LIMIT 5000").all();
          const rows = all.results || [];
          const matchingCustomer = rows.find(c => phoneNorm && normalizePhone(c.phone) === phoneNorm);
          if (email) {
            const emailAccount = await env.DB.prepare("SELECT id FROM customer_accounts WHERE email=? COLLATE NOCASE").bind(email).first();
            if (emailAccount) return json({ error: "Этот email уже связан с другим аккаунтом. Уберите email или обратитесь в поддержку." }, 409, origin);
          }
          if (matchingCustomer) {
            const linked = await env.DB.prepare("SELECT id FROM customer_accounts WHERE customer_id=?").bind(matchingCustomer.id).first();
            if (linked) return json({ error: "Для этого телефона уже есть личный кабинет. Войдите по номеру телефона; данные и история заказов сохранены." }, 409, origin);
          }
          const now = new Date().toISOString();
          const customerId = matchingCustomer ? matchingCustomer.id : crypto.randomUUID();
          const accountId = crypto.randomUUID();
          const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, "0")).join("");
          const passwordDigest = await passwordHash(password, salt);
          const cardNumber = "TS-" + Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();
          const statements = [];
          if (matchingCustomer) {
            statements.push(env.DB.prepare("UPDATE customers SET name=?,email=CASE WHEN ?<>'' THEN ? ELSE email END,phone=?,updated_at=? WHERE id=?").bind(name, email, email, phone, now, customerId));
          } else {
            statements.push(env.DB.prepare("INSERT INTO customers (id,name,phone,email,telegram_chat_id,language,notes,sms_consent,sms_consent_at,client_status,discount_percent,created_at,updated_at) VALUES (?,?,?,?,NULL,'ru','Регистрация на сайте',0,NULL,'Новый',0,?,?)").bind(customerId, name, phone, email || null, now, now));
          }
          statements.push(env.DB.prepare("INSERT INTO customer_accounts (id,customer_id,email,phone_norm,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?)").bind(accountId, customerId, accountEmail, phoneNorm, salt, passwordDigest, now));
          statements.push(env.DB.prepare("INSERT OR IGNORE INTO customer_loyalty (customer_id,card_number,points,lifetime_points,created_at) VALUES (?,?,0,0,?)").bind(customerId, cardNumber, now));
          await env.DB.batch(statements);
          const session = await issueSession(accountId);
          return json({ ok: true, token: session, message: "Аккаунт создан", customer: { name, email: email || null, phone } }, 201, origin);
        }
        if (url.pathname === "/account/login" && request.method === "POST") {
          const login = clean(body.phone || body.email).toLowerCase(), password = String(body.password || "");
          const loginPhone = normalizePhone(login);
          const account = await env.DB.prepare("SELECT a.id,a.customer_id,a.email,a.password_salt,a.password_hash,c.name,c.phone FROM customer_accounts a JOIN customers c ON c.id=a.customer_id WHERE a.phone_norm=? OR a.email=? COLLATE NOCASE").bind(loginPhone, login).first();
          if (!account || !password || await passwordHash(password, account.password_salt) !== account.password_hash) return json({ error: "Неверный телефон или пароль." }, 401, origin);
          const session = await issueSession(account.id);
          return json({ ok: true, token: session, customer: { name: account.name, email: account.email, phone: account.phone } }, 200, origin);
        }
        if (url.pathname === "/account/me" && request.method === "GET") {
          const raw = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
          if (!raw) return json({ error: "Войдите в аккаунт." }, 401, origin);
          const account = await env.DB.prepare("SELECT a.id,a.email,c.id AS customer_id,c.name,c.phone,c.discount_percent FROM customer_sessions s JOIN customer_accounts a ON a.id=s.account_id JOIN customers c ON c.id=a.customer_id WHERE s.token_hash=? AND s.expires_at>?").bind(await hashText(raw), new Date().toISOString()).first();
          if (!account) return json({ error: "Сессия истекла. Войдите снова." }, 401, origin);
          let loyalty = await env.DB.prepare("SELECT card_number,points,lifetime_points FROM customer_loyalty WHERE customer_id=?").bind(account.customer_id).first();
          if (!loyalty) { const cardNumber = "TS-" + Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b=>b.toString(16).padStart(2,"0")).join("").toUpperCase(); await env.DB.prepare("INSERT OR IGNORE INTO customer_loyalty (customer_id,card_number,points,lifetime_points,created_at) VALUES (?,?,0,0,?)").bind(account.customer_id,cardNumber,new Date().toISOString()).run(); loyalty = await env.DB.prepare("SELECT card_number,points,lifetime_points FROM customer_loyalty WHERE customer_id=?").bind(account.customer_id).first(); }
          const orders = await env.DB.prepare("SELECT id,service,amount_minor,currency,status,created_at,service_at,paid_at FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 100").bind(account.customer_id).all();
          return json({ ok: true, customer: { name: account.name, email: account.email, phone: account.phone }, loyalty: { card_number: loyalty.card_number, points: loyalty.points, lifetime_points: loyalty.lifetime_points, discount_percent: Number(account.discount_percent||0), point_value_byn: 1, max_redemption_percent: 20, earn_rule: "1 балл за каждые 20 BYN оплаченного заказа" }, orders: orders.results || [] }, 200, origin);
        }
        if (url.pathname === "/account/orders" && request.method === "POST") {
          const raw=(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
          if(!raw) return json({error:"Войдите в личный кабинет."},401,origin);
          const account=await env.DB.prepare("SELECT c.id AS customer_id,c.name,c.phone,c.email,c.telegram_chat_id,c.discount_percent FROM customer_sessions s JOIN customer_accounts a ON a.id=s.account_id JOIN customers c ON c.id=a.customer_id WHERE s.token_hash=? AND s.expires_at>?").bind(await hashText(raw),new Date().toISOString()).first();
          if(!account) return json({error:"Сессия истекла. Войдите снова."},401,origin);
          const key=String(body.service||""),area=Number(body.area||0),address=clean(body.address),comment=clean(body.comment),rawDate=String(body.serviceAt||"");
          const date=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rawDate)?new Date(rawDate+":00+03:00"):new Date(NaN);
          if(address.length<5||!Number.isFinite(date.getTime())||date.getTime()<=Date.now()) return json({error:"Укажите адрес и будущие дату и время (время Минска)."},400,origin);
          const rules={express:["Экспресс-уборка",2.75,88],maintenance:["Поддерживающая уборка",3.75,0],general:["Генеральная уборка",5.25,125],renovation:["Уборка после ремонта",6.5,250],fire:["Уборка после пожара",6.25,375],kitchen:["Генеральная уборка кухни",0,200],subscription_basic:["Подписка «Базовый»",0,291.2],subscription_comfort:["Подписка «Комфорт»",0,504.4],subscription_premium:["Подписка «Премиум»",0,928.2]};
          const rule=rules[key]; if(!rule&&!["upholstery","carpet","business","other"].includes(key)) return json({error:"Выберите услугу из списка."},400,origin);
          if(rule&&rule[1]>0&&(!Number.isFinite(area)||area<1||area>10000)) return json({error:"Укажите площадь от 1 до 10000 м²."},400,origin);
          const base=rule?(rule[1]>0?Math.max(rule[2],rule[1]*area):rule[2]):0;
          const pct=Math.max(0,Math.min(100,Number(account.discount_percent||0))),afterDiscount=Math.round(base*(100-pct))/100;
          let loyalty=await env.DB.prepare("SELECT points FROM customer_loyalty WHERE customer_id=?").bind(account.customer_id).first();
          if(!loyalty){const card="TS-"+Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();await env.DB.prepare("INSERT OR IGNORE INTO customer_loyalty (customer_id,card_number,points,lifetime_points,created_at) VALUES (?,?,0,0,?)").bind(account.customer_id,card,new Date().toISOString()).run();loyalty=await env.DB.prepare("SELECT points FROM customer_loyalty WHERE customer_id=?").bind(account.customer_id).first();}
          const used=body.usePoints===true?Math.min(Number(loyalty.points||0),Math.floor(afterDiscount*.2)):0,final=Math.max(0,Math.round((afterDiscount-used)*100)/100);
          const title=rule?rule[0]:({upholstery:"Химчистка мебели",carpet:"Чистка ковролина",business:"Комплексный клининг / обслуживание бизнеса",other:"Другая услуга"}[key]);
          const service=title+(rule&&rule[1]>0?" — "+area+" м²":"")+"\nАдрес: "+address+(comment?"\nКомментарий: "+comment:"")+(base?"\nПредварительная цена: "+base.toFixed(2)+" BYN; персональная скидка "+pct+"%; списано баллов "+used+". Цена уточняется менеджером.":"\nСтоимость уточнит менеджер.");
          const id=crypto.randomUUID(),now=new Date().toISOString(),serviceAt=date.toISOString();
          const orderBatch = await env.DB.batch([
            env.DB.prepare("INSERT INTO orders (id,customer_id,service,amount_minor,currency,status,created_at,paid_at,service_at,reminder_sent_at) SELECT ?,?,?,?,?, 'pending',?,NULL,?,NULL WHERE ?=0 OR EXISTS (SELECT 1 FROM customer_loyalty WHERE customer_id=? AND points>=?)")
              .bind(id,account.customer_id,service,Math.round(final*100),"BYN",now,serviceAt,used,account.customer_id,used),
            env.DB.prepare("INSERT INTO customer_order_loyalty (order_id,customer_id,points_used,refunded_at,created_at) SELECT ?,?,?,NULL,? WHERE EXISTS (SELECT 1 FROM orders WHERE id=?)")
              .bind(id,account.customer_id,used,now,id),
            env.DB.prepare("UPDATE customer_loyalty SET points=points-? WHERE customer_id=? AND points>=? AND ?>0 AND EXISTS (SELECT 1 FROM orders WHERE id=?)")
              .bind(used,account.customer_id,used,used,id)
          ]);
          if (!orderBatch[0]?.meta?.changes) {
            return json({error:"Баланс бонусов изменился. Обновите страницу и повторите оформление заказа."},409,origin);
          }
          const dateText=date.toLocaleString("ru-RU",{timeZone:"Europe/Minsk"}),price=base?final.toLocaleString("ru-RU",{minimumFractionDigits:2})+" BYN (предварительно)":"уточняется";
          const msg="Получена ваша заявка TrueShine. Услуга: "+title+". Дата: "+dateText+" (Минск). Стоимость: "+price+". Статус: новая, ожидает подтверждения.";
          const notice=await notifyCustomer(env,account,"Заявка TrueShine получена",msg);let group="failed";
          try{await sendTelegram(env,"🆕 ЗАКАЗ ИЗ ЛИЧНОГО КАБИНЕТА TRUE SHINE\nНомер: "+id+"\nКлиент: "+account.name+"\nТелефон: "+account.phone+"\nУслуга: "+title+"\nАдрес: "+address+"\nДата: "+dateText+" (Минск)\nСтоимость: "+price+"\nСкидка: "+pct+"%\nСписано баллов: "+used+"\nКомментарий: "+(comment||"—"));group="sent";}catch{}
          return json({ok:true,id,notifications:{...notice,group},pricing:{base,discountPercent:pct,pointsUsed:used,finalAmount:final,quoteRequired:!base}},201,origin);
        }
        if (url.pathname === "/account/logout" && request.method === "POST") {
          const raw = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
          if (raw) await env.DB.prepare("DELETE FROM customer_sessions WHERE token_hash=?").bind(await hashText(raw)).run();
          return json({ ok: true }, 200, origin);
        }
      } catch (error) {
        console.error("[TrueShine] Account handler failed", { path: url.pathname, message: String(error?.message || "unknown").slice(0, 300) });
        if (String(error?.message || "").includes("UNIQUE constraint failed")) return json({ error: "Аккаунт с таким телефоном уже зарегистрирован. Войдите по номеру телефона." }, 409, origin);
        return json({ error: "Не удалось обработать аккаунт. Попробуйте позже." }, 500, origin);
      }
      return json({ error: "Not found" }, 404, origin);
    }
    if (url.pathname.startsWith("/crm/")) {
      if (!env.CRM_ADMIN_TOKEN || request.headers.get("Authorization") !== "Bearer " + env.CRM_ADMIN_TOKEN) {
        return json({ error: "Unauthorized: CRM token required" }, 401, origin);
      }
      if (!env.DB) return json({ error: "CRM database is not configured. Add D1 binding named DB." }, 503, origin);
      const safe = v => String(v || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 1000);
      try {
        if (url.pathname === "/crm/telegram/setup-webhook" && request.method === "POST") {
          if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return json({ error: "Add TELEGRAM_WEBHOOK_SECRET in Worker secrets before connecting the bot." }, 400, origin);
          const webhookUrl = url.origin + "/telegram/webhook";
          const response = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/setWebhook", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: webhookUrl, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message"] })
          });
          const result = await response.json();
          if (!response.ok || !result.ok) return json({ error: "Telegram rejected the webhook configuration. Check bot token and secret format." }, 502, origin);
          return json({ ok: true, message: "Telegram webhook connected." }, 200, origin);
        }
        if (url.pathname === "/crm/customers" && request.method === "GET") {
          const result = await env.DB.prepare("SELECT id,name,phone,email,telegram_chat_id,language,notes,sms_consent,points,paid_orders,client_status,discount_percent,created_at,updated_at FROM customers ORDER BY created_at DESC LIMIT 1000").all();
          const customers = (result.results || []).map(c => ({...c, sms_consent: !!c.sms_consent, tier: Number(c.paid_orders)>=10?"VIP":Number(c.paid_orders)>=3?"Silver":"Start"}));
          const counts = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM orders) AS ordersCount, (SELECT COUNT(*) FROM sms_outbox WHERE status='queued') AS smsQueued").first();
          return json({ customers, ordersCount: counts?.ordersCount || 0, smsQueued: counts?.smsQueued || 0 }, 200, origin);
        }
        if (url.pathname === "/crm/customers" && request.method === "POST") {
          const name = safe(body.name), phone = safe(body.phone), email = safe(body.email), telegramChatId = safe(body.telegramChatId), language = ["ru","en","de"].includes(body.language)?body.language:"ru", notes = safe(body.notes), clientStatus = safe(body.clientStatus || "Новый").slice(0,60), discountPercent = Number(body.discountPercent ?? 0);
          if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) return json({ error: "Discount must be an integer from 0 to 100" }, 400, origin);
          if (!name || !phone || !/^\+[1-9]\d{6,14}$/.test(phone)) return json({ error: "Name and phone in international format (+countrycode...) are required" }, 400, origin);
          const smsConsent = body.smsConsent === true ? 1 : 0;
          const now = new Date().toISOString(), id = crypto.randomUUID();
          await env.DB.prepare("INSERT INTO customers (id,name,phone,email,telegram_chat_id,language,notes,sms_consent,sms_consent_at,client_status,discount_percent,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
            .bind(id,name,phone,email||null,telegramChatId||null,language,notes,smsConsent,smsConsent?now:null,clientStatus,discountPercent,now,now).run();
          return json({ ok: true, id }, 201, origin);
        }
        if (url.pathname === "/crm/customers/archive" && request.method === "POST") {
          const id = safe(body.id);
          if (!id) return json({ error: "Customer ID is required" }, 400, origin);
          const existing = await env.DB.prepare("SELECT id FROM customers WHERE id=?").bind(id).first();
          if (!existing) return json({ error: "Customer not found" }, 404, origin);
          const result = await env.DB.prepare("UPDATE customers SET client_status='Удалён',sms_consent=0,sms_consent_at=NULL,updated_at=? WHERE id=?")
            .bind(new Date().toISOString(), id).run();
          if (!result.success || result.meta?.changes === 0) return json({ error: "Customer could not be archived" }, 500, origin);
          return json({ ok: true, id, archived: true }, 200, origin);
        }
        if (url.pathname === "/crm/customers/update" && request.method === "POST") {
          const id = safe(body.id), name = safe(body.name), phone = safe(body.phone), email = safe(body.email), telegramChatId = safe(body.telegramChatId), language = ["ru","en","de"].includes(body.language)?body.language:"ru", notes = safe(body.notes), clientStatus = safe(body.clientStatus || "Новый").slice(0,60), discountPercent = Number(body.discountPercent ?? 0);
          if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) return json({ error: "Discount must be an integer from 0 to 100" }, 400, origin);
          if (!id || !name || !phone || !/^\+[1-9]\d{6,14}$/.test(phone)) return json({ error: "Name, customer ID and phone in international format are required" }, 400, origin);
          const existing = await env.DB.prepare("SELECT id,sms_consent,sms_consent_at FROM customers WHERE id=?").bind(id).first();
          if (!existing) return json({ error: "Customer not found" }, 404, origin);
          const smsConsent = body.smsConsent === true ? 1 : 0;
          const now = new Date().toISOString();
          const consentAt = smsConsent ? (existing.sms_consent ? existing.sms_consent_at : now) : null;
          await env.DB.prepare("CREATE TABLE IF NOT EXISTS customer_accounts (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE COLLATE NOCASE, phone_norm TEXT NOT NULL UNIQUE, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(customer_id) REFERENCES customers(id))").run();
          await env.DB.batch([
            env.DB.prepare("UPDATE customers SET name=?,phone=?,email=?,telegram_chat_id=?,language=?,notes=?,sms_consent=?,sms_consent_at=?,client_status=?,discount_percent=?,updated_at=? WHERE id=?")
              .bind(name,phone,email||null,telegramChatId||null,language,notes,smsConsent,consentAt,clientStatus,discountPercent,now,id),
            env.DB.prepare("UPDATE customer_accounts SET email=CASE WHEN ?<>'' THEN ? ELSE email END,phone_norm=? WHERE customer_id=?")
              .bind(email,email,normalizePhone(phone),id)
          ]);
          return json({ ok: true, id }, 200, origin);
        }
        if (url.pathname === "/crm/orders" && request.method === "GET") {
          const result = await env.DB.prepare("SELECT o.id,o.customer_id,o.service,o.amount_minor,o.currency,o.status,o.created_at,o.paid_at,o.service_at,o.reminder_sent_at,c.name,c.phone,c.email FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.created_at DESC LIMIT 1000").all();
          return json({ orders: result.results || [] }, 200, origin);
        }
        if (url.pathname === "/crm/orders" && request.method === "POST") {
          const customerId = safe(body.customerId), service = safe(body.service), currency = ["BYN","EUR"].includes(body.currency) ? body.currency : "BYN";
          const amount = Number(body.amount), rawServiceAt = String(body.serviceAt || "");
          const serviceAtDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rawServiceAt) ? new Date(rawServiceAt + ":00+03:00") : new Date(NaN);
          if (!customerId || !service || service.length > 200 || !Number.isFinite(amount) || amount < 0 || amount > 100000000 || !Number.isFinite(serviceAtDate.getTime()) || serviceAtDate.getTime() <= Date.now()) return json({ error: "Укажите клиента, услугу, корректную сумму и будущие дату/время начала (время Минска)" }, 400, origin);
          const customer = await env.DB.prepare("SELECT id,name,phone,email,telegram_chat_id FROM customers WHERE id=?").bind(customerId).first();
          if (!customer) return json({ error: "Customer not found" }, 404, origin);
          const id = crypto.randomUUID(), now = new Date().toISOString(), serviceAt = serviceAtDate.toISOString(), amountMinor = Math.round(amount*100);
          await env.DB.prepare("INSERT INTO orders (id,customer_id,service,amount_minor,currency,status,created_at,paid_at,service_at,reminder_sent_at) VALUES (?,?,?,?,?,'pending',?,NULL,?,NULL)").bind(id,customerId,service,amountMinor,currency,now,serviceAt).run();
          const dateText = new Date(serviceAt).toLocaleString("ru-RU", { timeZone: "Europe/Minsk" });
          const amountText = (amountMinor/100).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2});
          const customerMessage = "Здравствуйте, " + customer.name + "! Ваш заказ TrueShine создан. Услуга: " + service + ". Дата и время: " + dateText + " (время Минска). Сумма: " + amountText + " " + currency + ". Статус: Новый, ожидает подтверждения и оплаты.";
          const notice = await notifyCustomer(env, customer, "Новый заказ TrueShine", customerMessage);
          let group = "failed";
          try {
            await sendTelegram(env, "🆕 НОВЫЙ ЗАКАЗ TRUE SHINE\nЗаказ: " + id + "\nКлиент: " + customer.name + "\nТелефон: " + (customer.phone || "не указан") + "\nУслуга: " + service + "\nДата: " + dateText + " (Минск)\nСумма: " + amountText + " " + currency + "\nСтатус: Новый");
            group = "sent";
          } catch {}
          return json({ ok: true, id, notifications: { ...notice, group }, message: "Order created" }, 201, origin);
        }
        if (url.pathname === "/crm/orders/status" && request.method === "POST") {
          const orderId = safe(body.orderId), status = String(body.status || "");
          const allowedStatuses = ["pending","confirmed","in_progress","completed","cancelled"];
          if (!orderId || !allowedStatuses.includes(status)) return json({ error: "Укажите заказ и допустимый статус" }, 400, origin);
          const order = await env.DB.prepare("SELECT o.id,o.status,o.service,o.service_at,o.amount_minor,o.currency,c.id AS customer_id,c.name,c.phone,c.email,c.telegram_chat_id FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?").bind(orderId).first();
          if (!order) return json({ error: "Заказ не найден" }, 404, origin);
          if (order.status === "paid") return json({ error: "Оплаченный заказ нельзя изменить. Для исправления обратитесь к администратору." }, 409, origin);
          if (order.status === "cancelled" && status !== "cancelled") return json({ error: "Отменённый заказ нельзя возобновить через эту кнопку." }, 409, origin);
          if (order.status === status) return json({ ok: true, id: orderId, status, notifications: { email: "skipped", telegram: "skipped", group: "skipped" } }, 200, origin);
          await env.DB.prepare("UPDATE orders SET status=? WHERE id=?").bind(status, orderId).run();
          await env.DB.prepare("CREATE TABLE IF NOT EXISTS customer_order_loyalty (order_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, points_used INTEGER NOT NULL DEFAULT 0, refunded_at TEXT, created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(customer_id) REFERENCES customers(id))").run();
          if(status==="cancelled" && order.status!=="cancelled") {
            const reservation=await env.DB.prepare("SELECT customer_id,points_used,refunded_at FROM customer_order_loyalty WHERE order_id=?").bind(orderId).first();
            if(reservation && Number(reservation.points_used)>0 && !reservation.refunded_at) {
              await env.DB.prepare("UPDATE customer_loyalty SET points=points+? WHERE customer_id=?").bind(reservation.points_used,reservation.customer_id).run();
              await env.DB.prepare("UPDATE customer_order_loyalty SET refunded_at=? WHERE order_id=? AND refunded_at IS NULL").bind(new Date().toISOString(),orderId).run();
            }
          }
          const names = { pending: "Новый", confirmed: "Подтверждён", in_progress: "В работе", completed: "Выполнен", cancelled: "Отменён", paid: "Оплачен" };
          const dateText = order.service_at ? new Date(order.service_at).toLocaleString("ru-RU", { timeZone: "Europe/Minsk" }) : "не указаны";
          const amountText = (Number(order.amount_minor || 0) / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const message = "Здравствуйте, " + order.name + "! Статус вашего заказа TrueShine изменён: «" + (names[order.status] || order.status) + "» → «" + names[status] + "». Услуга: " + order.service + ". Дата и время: " + dateText + " (время Минска). Сумма: " + amountText + " " + order.currency + ".";
          const notifications = await notifyCustomer(env, order, "Изменение статуса заказа TrueShine: " + names[status], message);
          let group = "failed";
          try {
            await sendTelegram(env, "🔔 ИЗМЕНЕНИЕ СТАТУСА ЗАКАЗА TRUE SHINE\nЗаказ: " + order.id + "\nКлиент: " + order.name + "\nТелефон: " + order.phone + "\nУслуга: " + order.service + "\nДата: " + dateText + " (Минск)\nСумма: " + amountText + " " + order.currency + "\nСтатус: " + (names[order.status] || order.status) + " → " + names[status]);
            group = "sent";
          } catch {}
          return json({ ok: true, id: orderId, status, notifications: { ...notifications, group } }, 200, origin);
        }
        if (url.pathname === "/crm/orders/price" && request.method === "POST") {
          const orderId=safe(body.orderId), baseAmount=Number(body.amount);
          if(!orderId||!Number.isFinite(baseAmount)||baseAmount<=0||baseAmount>100000000) return json({error:"Укажите заказ и подтверждённую цену больше нуля."},400,origin);
          const order=await env.DB.prepare("SELECT o.id,o.status,o.amount_minor,o.currency,o.service,o.service_at,c.id AS customer_id,c.name,c.phone,c.email,c.telegram_chat_id,c.discount_percent FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?").bind(orderId).first();
          if(!order) return json({error:"Заказ не найден."},404,origin);
          if(Number(order.amount_minor||0)!==0) return json({error:"Цена уже установлена. Для изменения обратитесь к администратору."},409,origin);
          if(["paid","cancelled"].includes(order.status)) return json({error:"Нельзя менять цену оплаченного или отменённого заказа."},409,origin);
          const pct=Math.max(0,Math.min(100,Number(order.discount_percent||0))),finalAmount=Math.round(baseAmount*(100-pct))/100,minor=Math.round(finalAmount*100);
          await env.DB.prepare("UPDATE orders SET amount_minor=?,service=replace(service,char(10)||'Стоимость уточнит менеджер.',char(10)||'Стоимость подтверждена менеджером.') WHERE id=?").bind(minor,orderId).run();
          const amountText=(minor/100).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2}),dateText=order.service_at?new Date(order.service_at).toLocaleString("ru-RU",{timeZone:"Europe/Minsk"}):"не указана";
          const msg="Менеджер TrueShine подтвердил стоимость вашей заявки. Заказ: "+order.id+". Итоговая стоимость с учётом персональной скидки "+pct+"%: "+amountText+" "+order.currency+". Дата: "+dateText+" (Минск).";
          const notice=await notifyCustomer(env,order,"Подтверждена стоимость заказа TrueShine",msg);let group="failed";
          try{await sendTelegram(env,"💰 ЦЕНА ЗАКАЗА ПОДТВЕРЖДЕНА\nЗаказ: "+order.id+"\nКлиент: "+order.name+"\nУслуга: "+order.service+"\nБазовая цена: "+baseAmount.toFixed(2)+" "+order.currency+"\nСкидка: "+pct+"%\nИтого: "+amountText+" "+order.currency+"\nДата: "+dateText+" (Минск)");group="sent";}catch{}
          return json({ok:true,amount:finalAmount,discountPercent:pct,notifications:{...notice,group}},200,origin);
        }
        if (url.pathname === "/crm/orders/paid" && request.method === "POST") {
          const orderId = safe(body.orderId);
          if (!orderId) return json({ error: "Order ID is required" }, 400, origin);
          const order = await env.DB.prepare("SELECT o.id,o.status,o.service,o.service_at,o.amount_minor,o.currency,c.id AS customer_id,c.name,c.email,c.telegram_chat_id FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?").bind(orderId).first();
          if (!order) return json({ error: "Order not found" }, 404, origin);
          if (order.status !== "paid") { const now = new Date().toISOString(); await env.DB.prepare("UPDATE orders SET status='paid',paid_at=? WHERE id=?").bind(now,orderId).run(); await env.DB.prepare("UPDATE customers SET paid_orders=paid_orders+1,updated_at=? WHERE id=?").bind(now,order.customer_id).run(); await env.DB.prepare("CREATE TABLE IF NOT EXISTS customer_loyalty (customer_id TEXT PRIMARY KEY, card_number TEXT NOT NULL UNIQUE, points INTEGER NOT NULL DEFAULT 0, lifetime_points INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, FOREIGN KEY(customer_id) REFERENCES customers(id))").run(); let loyalty=await env.DB.prepare("SELECT card_number,points FROM customer_loyalty WHERE customer_id=?").bind(order.customer_id).first(); if(!loyalty){const card="TS-"+Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();await env.DB.prepare("INSERT OR IGNORE INTO customer_loyalty (customer_id,card_number,points,lifetime_points,created_at) VALUES (?,?,0,0,?)").bind(order.customer_id,card,now).run();} const earned=Math.floor((Number(order.amount_minor||0)/100)/20); if(earned>0) await env.DB.prepare("UPDATE customer_loyalty SET points=points+?,lifetime_points=lifetime_points+? WHERE customer_id=?").bind(earned,earned,order.customer_id).run(); }
          const amountText = (Number(order.amount_minor||0)/100).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2});
          const dateText = order.service_at ? new Date(order.service_at).toLocaleString("ru-RU",{timeZone:"Europe/Minsk"}) : "не указаны";
          const notice = await notifyCustomer(env, order, "Заказ TrueShine оплачен", "Здравствуйте, " + order.name + "! Оплата вашего заказа TrueShine получена. Статус: Оплачен. Услуга: " + order.service + ". Дата и время: " + dateText + " (время Минска). Сумма: " + amountText + " " + order.currency + ". Спасибо за выбор TrueShine!");
          let group = "failed";
          try { await sendTelegram(env, "💳 ЗАКАЗ ОПЛАЧЕН — TRUE SHINE\nЗаказ: " + order.id + "\nКлиент: " + order.name + "\nУслуга: " + order.service + "\nДата: " + dateText + " (Минск)\nСумма: " + amountText + " " + order.currency + "\nСтатус: Оплачен"); group = "sent"; } catch {}
          return json({ ok: true, notifications: { ...notice, group }, message: "Payment marked as paid" }, 200, origin);
        }
        if (url.pathname === "/crm/sms" && request.method === "POST") {
          const customerId=safe(body.customerId), message=safe(body.message), category=body.category==="marketing"?"marketing":"service";
          if(!customerId||!message) return json({error:"Customer and message are required"},400,origin);
          const customer=await env.DB.prepare("SELECT id,phone,sms_consent FROM customers WHERE id=?").bind(customerId).first();
          if(!customer) return json({error:"Customer not found"},404,origin);
          if(category==="marketing"&&!customer.sms_consent) return json({error:"Marketing SMS requires recorded customer consent"},403,origin);
          const id=crypto.randomUUID(),now=new Date().toISOString();
          await env.DB.prepare("INSERT INTO sms_outbox (id,customer_id,phone,message,category,status,created_at) VALUES (?,?,?,?,?,'queued',?)").bind(id,customerId,customer.phone,message,category,now).run();
          return json({ok:true,queued:true,id,message:"Queued only; no SMS provider is configured."},202,origin);
        }
      } catch (error) {
        console.error("[TrueShine] CRM request failed", { path: url.pathname, message: String(error?.message || "unknown").slice(0, 300) });
        if (String(error?.message || "").includes("UNIQUE constraint failed")) return json({error:"This phone number or linked account email is already assigned to another record."},409,origin);
        return json({error:"CRM database request failed"},500,origin);
      }
      return json({error:"Not found"},404,origin);
    }
    return json({ error: "Not found" }, 404, origin);
  }
};