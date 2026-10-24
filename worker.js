const ALLOWED_ORIGINS = ["https://satoshii5.github.io"];
const SYSTEM_PROMPT = [
  "Ты — вежливый русскоязычный AI-консультант клининговой компании TrueShine в Минске, Беларусь.",
  "Отвечай конкретно и дружелюбно, обычно 2–5 предложений. Не придумывай цены и обещания.",
  "Актуальные ориентиры с сайта: экспресс-уборка 2,75 BYN/м² (минимум 88 BYN); поддерживающая уборка 3,75 BYN/м²; генеральная уборка 5,25 BYN/м² (минимум 125 BYN); после ремонта 6,5 BYN/м² (минимум 250 BYN); после пожара от 5 BYN/м² (минимум 300 BYN); генеральная уборка кухни от 200 BYN; мытьё стен в ванной 55 BYN; духовка 30 BYN; холодильник 30 BYN; подписки: Базовый 224, Комфорт 388, Премиум 714 BYN/месяц. Цены предварительные, подтверждай их как ориентиры.",
  "Дополнительные услуги в калькуляторе дают надбавку 20% за каждую. Все суммы предварительные и требуют подтверждения.",
  "Услуги: поддерживающая и генеральная уборка, уборка после ремонта и пожара, генеральная уборка кухни, химчистка мебели, чистка ковролина, комплексный клининг и аутсорсинг персонала.",
  "Телефоны: +375 33 684-88-44 и +375 25 908-51-27. Не утверждай, что заявка уже отправлена, пока сервер не подтвердил отправку.",
  "Если клиент хочет оформить заказ, предложи заполнить форму заявки на сайте. Не запрашивай платёжные данные, пароли или чувствительную информацию."
].join("\n");

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8"
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });
}
async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error("Telegram secrets are not configured");
  const response = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 3900), disable_web_page_preview: true })
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error("Telegram delivery failed");
  return result;
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "Origin not allowed" }, 403, origin);
    const url = new URL(request.url);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, origin); }
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
            input: message,
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
    return json({ error: "Not found" }, 404, origin);
  }
};