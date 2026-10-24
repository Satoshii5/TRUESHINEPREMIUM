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
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const url = new URL(request.url);
    const crmRead = request.method === "GET" && url.pathname.startsWith("/crm/");
    if (request.method !== "POST" && !crmRead) return json({ error: "Method not allowed" }, 405, origin);
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "Origin not allowed" }, 403, origin);
    let body = {};
    if (request.method === "POST") { try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, origin); } }
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
        if (url.pathname === "/crm/customers" && request.method === "GET") {
          const result = await env.DB.prepare("SELECT id,name,phone,email,language,notes,sms_consent,points,paid_orders,client_status,discount_percent,created_at,updated_at FROM customers ORDER BY created_at DESC LIMIT 1000").all();
          const customers = (result.results || []).map(c => ({...c, sms_consent: !!c.sms_consent, tier: Number(c.paid_orders)>=10?"VIP":Number(c.paid_orders)>=3?"Silver":"Start"}));
          const counts = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM orders) AS ordersCount, (SELECT COUNT(*) FROM sms_outbox WHERE status='queued') AS smsQueued").first();
          return json({ customers, ordersCount: counts?.ordersCount || 0, smsQueued: counts?.smsQueued || 0 }, 200, origin);
        }
        if (url.pathname === "/crm/customers" && request.method === "POST") {
          const name = safe(body.name), phone = safe(body.phone), email = safe(body.email), language = ["ru","en","de"].includes(body.language)?body.language:"ru", notes = safe(body.notes), clientStatus = safe(body.clientStatus || "Новый").slice(0,60), discountPercent = Number(body.discountPercent ?? 0);
          if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) return json({ error: "Discount must be an integer from 0 to 100" }, 400, origin);
          if (!name || !phone || !/^\+[1-9]\d{6,14}$/.test(phone)) return json({ error: "Name and phone in international format (+countrycode...) are required" }, 400, origin);
          const smsConsent = body.smsConsent === true ? 1 : 0;
          const now = new Date().toISOString(), id = crypto.randomUUID();
          await env.DB.prepare("INSERT INTO customers (id,name,phone,email,language,notes,sms_consent,sms_consent_at,client_status,discount_percent,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
            .bind(id,name,phone,email||null,language,notes,smsConsent,smsConsent?now:null,clientStatus,discountPercent,now,now).run();
          return json({ ok: true, id }, 201, origin);
        }
        if (url.pathname === "/crm/customers/update" && request.method === "POST") {
          const id = safe(body.id), name = safe(body.name), phone = safe(body.phone), email = safe(body.email), language = ["ru","en","de"].includes(body.language)?body.language:"ru", notes = safe(body.notes), clientStatus = safe(body.clientStatus || "Новый").slice(0,60), discountPercent = Number(body.discountPercent ?? 0);
          if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) return json({ error: "Discount must be an integer from 0 to 100" }, 400, origin);
          if (!id || !name || !phone || !/^\+[1-9]\d{6,14}$/.test(phone)) return json({ error: "Name, customer ID and phone in international format are required" }, 400, origin);
          const existing = await env.DB.prepare("SELECT id,sms_consent,sms_consent_at FROM customers WHERE id=?").bind(id).first();
          if (!existing) return json({ error: "Customer not found" }, 404, origin);
          const smsConsent = body.smsConsent === true ? 1 : 0;
          const now = new Date().toISOString();
          const consentAt = smsConsent ? (existing.sms_consent ? existing.sms_consent_at : now) : null;
          await env.DB.prepare("UPDATE customers SET name=?,phone=?,email=?,language=?,notes=?,sms_consent=?,sms_consent_at=?,client_status=?,discount_percent=?,updated_at=? WHERE id=?")
            .bind(name,phone,email||null,language,notes,smsConsent,consentAt,clientStatus,discountPercent,now,id).run();
          return json({ ok: true, id }, 200, origin);
        }
        if (url.pathname === "/crm/orders" && request.method === "GET") {
          const result = await env.DB.prepare("SELECT o.id,o.customer_id,o.service,o.amount_minor,o.currency,o.status,o.created_at,o.paid_at,c.name,c.phone FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.created_at DESC LIMIT 1000").all();
          return json({ orders: result.results || [] }, 200, origin);
        }
        if (url.pathname === "/crm/orders" && request.method === "POST") {
          const customerId = safe(body.customerId), service = safe(body.service), currency = ["BYN","EUR"].includes(body.currency) ? body.currency : "BYN";
          const amount = Number(body.amount);
          if (!customerId || !service || service.length > 200 || !Number.isFinite(amount) || amount < 0 || amount > 100000000) return json({ error: "Customer, service and a valid non-negative amount are required" }, 400, origin);
          const customer = await env.DB.prepare("SELECT id FROM customers WHERE id=?").bind(customerId).first();
          if (!customer) return json({ error: "Customer not found" }, 404, origin);
          const id = crypto.randomUUID(), now = new Date().toISOString();
          await env.DB.prepare("INSERT INTO orders (id,customer_id,service,amount_minor,currency,status,created_at,paid_at) VALUES (?,?,?,?,?,'pending',?,NULL)")
            .bind(id,customerId,service,Math.round(amount*100),currency,now).run();
          return json({ ok: true, id, message: "Order created" }, 201, origin);
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