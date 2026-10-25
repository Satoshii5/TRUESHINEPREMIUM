import { readFileSync } from "node:fs";

const fail = [];
const html = readFileSync("index.html", "utf8");
const worker = readFileSync("worker.js", "utf8");
const crm = readFileSync("crm.html", "utf8");

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]);
const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
if (duplicates.length) fail.push("Duplicate HTML IDs: " + [...new Set(duplicates)].join(", "));

const anchors = [...html.matchAll(/href=["']#([^"']+)["']/g)].map((m) => m[1]).filter(Boolean);
const missingAnchors = [...new Set(anchors.filter((id) => !ids.includes(id)))];
if (missingAnchors.length) fail.push("Broken in-page links: " + missingAnchors.join(", "));

for (const id of ["services", "included", "calculator", "subscriptions", "team", "contact", "leadForm", "teamForm"]) {
  if (!ids.includes(id)) fail.push("Required site element is missing: #" + id);
}

for (const price of ["291,20", "504,40", "928,20"]) {
  if (!html.includes(price)) fail.push("Subscription price missing from website: " + price);
}
for (const price of ["+55 BYN", "+30 BYN", "80 BYN", "150 BYN", "130 BYN", "160 BYN", "200 BYN"]) {
  if (!html.includes(price)) fail.push("Add-on service price missing from website checklist: " + price);
}
for (const price of ["291.2", "504.4", "928.2"]) {
  if (!worker.includes(price)) fail.push("Subscription price missing from Worker pricing rules: " + price);
}
if (/Базовый 224 BYN|Комфорт 388 BYN|Премиум 714 BYN/.test(worker)) {
  fail.push("Worker AI prompt still contains old subscription prices");
}
if (!worker.includes('request.headers.get("Authorization") !== "Bearer " + env.CRM_ADMIN_TOKEN')) {
  fail.push("CRM admin token guard was not found");
}
if (!worker.includes("s.expires_at>?")) fail.push("Session expiry check was not found");
if (!worker.includes("самостоятельная привязка существующей карточки отключена")) {
  fail.push("Existing customer record-linking protection was not found");
}
if (!worker.includes("async function checkRateLimit")) fail.push("API rate limiting helper was not found");
if (!worker.includes('"chat", 30, 10 * 60 * 1000')) fail.push("AI chat rate limit was not found");
if (!worker.includes('"lead", 8, 10 * 60 * 1000')) fail.push("Lead form rate limit was not found");
if (!worker.includes('"register" : "login", url.pathname === "/account/register" ? 5 : 10, 15 * 60 * 1000')) fail.push("Registration/login brute-force throttling was not found");
if (!worker.includes("iterations: 150000, hash: \"SHA-256\"")) fail.push("PBKDF2 password hashing strength check was not found");
if (!worker.includes("crypto.getRandomValues(new Uint8Array(32))")) fail.push("High-entropy session token generation was not found");
if (!worker.includes("await hashText(raw), expires")) fail.push("Session token hashing before storage was not found");
if (!worker.includes("password.length < 10 || password.length > 128")) fail.push("Registration password length validation was not found");
if (!worker.includes("Самостоятельная привязка существующей карточки отключена") && !worker.includes("самостоятельная привязка существующей карточки отключена")) fail.push("Existing customer account takeover protection was not found");
if (!worker.includes("const orderBatch = await env.DB.batch")) fail.push("Atomic order and loyalty redemption batch was not found");
if (!worker.includes("UPDATE customer_accounts SET email=CASE WHEN ?<>'' THEN ? ELSE email END,phone_norm=? WHERE customer_id=?")) fail.push("CRM-to-account contact synchronization was not found");
if (!worker.includes('"X-Content-Type-Options": "nosniff"')) fail.push("Security response headers were not found");
if (!crm.includes("TrueShine CRM")) fail.push("CRM HTML title is missing");

for (const [sourceName, source] of [["index.html", html], ["crm.html", crm]]) {
  const inlineScripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/\bsrc=["']/.test(m[0]) && !m[0].toLowerCase().includes('type="application/ld+json') && !m[0].toLowerCase().includes("type='application/ld+json"));
  for (let i = 0; i < inlineScripts.length; i++) {
    try { new Function(inlineScripts[i][1]); }
    catch (error) { fail.push(sourceName + " inline JavaScript syntax error in block " + (i + 1) + ": " + error.message); }
  }
}

const jsonLd = html.match(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/i);
if (!jsonLd) fail.push("CleaningService structured data is missing");
else {
  try { JSON.parse(jsonLd[1]); }
  catch (error) { fail.push("CleaningService structured data is invalid JSON: " + error.message); }
}
const robots = readFileSync("robots.txt", "utf8");
const sitemap = readFileSync("sitemap.xml", "utf8");
if (!robots.includes("Sitemap: https://satoshii5.github.io/TRUESHINEPREMIUM/sitemap.xml")) fail.push("robots.txt sitemap declaration is missing");
if (!sitemap.includes("https://satoshii5.github.io/TRUESHINEPREMIUM/")) fail.push("sitemap.xml canonical URL is missing");

if (fail.length) {
  console.error("TrueShine site checks FAILED:");
  for (const item of fail) console.error(" - " + item);
  process.exit(1);
}
console.log("TrueShine checks passed: website/CRM JavaScript syntax, HTML anchors/IDs, structured data, sitemap, pricing sync, API and registration rate limits, password hashing, session token protection, CRM access guard, account-linking protection, session expiry and transactional loyalty redemption.");
