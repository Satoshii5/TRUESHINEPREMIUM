const ALLOWED_ORIGINS = ["https://satoshii5.github.io", "https://trueshinee.github.io"];
const SYSTEM_PROMPT = [
  "Ты — вежливый русскоязычный AI-консультант клининговой компании TrueShine в Минске, Беларусь.",
  "Отвечай конкретно и дружелюбно, обычно 2–5 предложений. Не придумывай цены и обещания.",
  "Цены на сайте — только предварительные ориентиры: экспресс-уборка 2,75 BYN/м² (минимум 88 BYN); поддерживающая 3,75 BYN/м²; генеральная 5,25 BYN/м² (минимум 125 BYN); после ремонта 6,5 BYN/м² (минимум 250 BYN); после пожара 6,25 BYN/м² (минимум 375 BYN); генеральная уборка кухни от 200 BYN. Подписки: Базовый 224 BYN, Комфорт 388 BYN, Премиум 714 BYN в месяц. Всегда уточняй, что окончательная стоимость подтверждается после уточнения объекта.",
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
    "Content-Type": "application/json; charset=utf-8"
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
  const rows = await env.DB.prepare("SELECT o.id,o.service,o.amount_minor,o.currency,o.service_at,c.name,c.email,c.telegram_chat_id FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.status='pending' AND o.reminder_sent_at IS NULL AND o.service_at>? AND o.service_at<=? ORDER BY o.service_at LIMIT 100").bind(from, until).all();
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
    if (request.method !== "POST" && !crmRead) return json({ error: "Method not allowed" }, 405, origin);
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
        if (url.pathname === "/crm/customers/update" && request.method === "POST") {
          const id = safe(body.id), name = safe(body.name), phone = safe(body.phone), email = safe(body.email), telegramChatId = safe(body.telegramChatId), language = ["ru","en","de"].includes(body.language)?body.language:"ru", notes = safe(body.notes), clientStatus = safe(body.clientStatus || "Новый").slice(0,60), discountPercent = Number(body.discountPercent ?? 0);
          if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) return json({ error: "Discount must be an integer from 0 to 100" }, 400, origin);
          if (!id || !name || !phone || !/^\+[1-9]\d{6,14}$/.test(phone)) return json({ error: "Name, customer ID and phone in international format are required" }, 400, origin);
          const existing = await env.DB.prepare("SELECT id,sms_consent,sms_consent_at FROM customers WHERE id=?").bind(id).first();
          if (!existing) return json({ error: "Customer not found" }, 404, origin);
          const smsConsent = body.smsConsent === true ? 1 : 0;
          const now = new Date().toISOString();
          const consentAt = smsConsent ? (existing.sms_consent ? existing.sms_consent_at : now) : null;
          await env.DB.prepare("UPDATE customers SET name=?,phone=?,email=?,telegram_chat_id=?,language=?,notes=?,sms_consent=?,sms_consent_at=?,client_status=?,discount_percent=?,updated_at=? WHERE id=?")
            .bind(name,phone,email||null,telegramChatId||null,language,notes,smsConsent,consentAt,clientStatus,discountPercent,now,id).run();
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
          const customer = await env.DB.prepare("SELECT id,name,email,telegram_chat_id FROM customers WHERE id=?").bind(customerId).first();
          if (!customer) return json({ error: "Customer not found" }, 404, origin);
          const id = crypto.randomUUID(), now = new Date().toISOString(), serviceAt = serviceAtDate.toISOString(), amountMinor = Math.round(amount*100);
          await env.DB.prepare("INSERT INTO orders (id,customer_id,service,amount_minor,currency,status,created_at,paid_at,service_at,reminder_sent_at) VALUES (?,?,?,?,?,'pending',?,NULL,?,NULL)").bind(id,customerId,service,amountMinor,currency,now,serviceAt).run();
          const dateText = new Date(serviceAt).toLocaleString("ru-RU", { timeZone: "Europe/Minsk" });
          const amountText = (amountMinor/100).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2});
          const notice = await notifyCustomer(env, customer, "Заказ TrueShine подтверждён", "Здравствуйте, " + customer.name + "! Ваш заказ TrueShine создан. Услуга: " + service + ". Дата и время: " + dateText + " (время Минска). Сумма: " + amountText + " " + currency + ". Статус оплаты: ожидает оплаты.");
          return json({ ok: true, id, notifications: notice, message: "Order created" }, 201, origin);
        }
        if (url.pathname === "/crm/orders/paid" && request.method === "POST") {
          const orderId = safe(body.orderId);
          if (!orderId) return json({ error: "Order ID is required" }, 400, origin);
          const order = await env.DB.prepare("SELECT o.id,o.status,o.service,o.service_at,o.amount_minor,o.currency,c.id AS customer_id,c.name,c.email,c.telegram_chat_id FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?").bind(orderId).first();
          if (!order) return json({ error: "Order not found" }, 404, origin);
          if (order.status !== "paid") { const now = new Date().toISOString(); await env.DB.prepare("UPDATE orders SET status='paid',paid_at=? WHERE id=?").bind(now,orderId).run(); await env.DB.prepare("UPDATE customers SET paid_orders=paid_orders+1,updated_at=? WHERE id=?").bind(now,order.customer_id).run(); }
          const amountText = (Number(order.amount_minor||0)/100).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2});
          const dateText = order.service_at ? new Date(order.service_at).toLocaleString("ru-RU",{timeZone:"Europe/Minsk"}) : "не указаны";
          const notice = await notifyCustomer(env, order, "Оплата заказа TrueShine получена", "Здравствуйте, " + order.name + "! Оплата вашего заказа TrueShine получена. Услуга: " + order.service + ". Дата и время: " + dateText + " (время Минска). Сумма: " + amountText + " " + order.currency + ". Спасибо за выбор TrueShine!");
          return json({ ok: true, notifications: notice, message: "Payment marked as paid" }, 200, origin);
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
        if (String(error?.message || "").includes("UNIQUE constraint failed")) return json({error:"A customer with this phone number already exists"},409,origin);
        return json({error:"CRM database request failed"},500,origin);
      }
      return json({error:"Not found"},404,origin);
    }
    return json({ error: "Not found" }, 404, origin);
  }
};