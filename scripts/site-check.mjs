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
if (!crm.includes("TrueShine CRM")) fail.push("CRM HTML title is missing");

const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .filter((m) => !/\bsrc=["']/.test(m[0]) && !m[0].toLowerCase().includes('type="application/ld+json') && !m[0].toLowerCase().includes("type='application/ld+json"));
for (let i = 0; i < inlineScripts.length; i++) {
  try { new Function(inlineScripts[i][1]); }
  catch (error) { fail.push("Inline JavaScript syntax error in block " + (i + 1) + ": " + error.message); }
}

if (fail.length) {
  console.error("TrueShine site checks FAILED:");
  for (const item of fail) console.error(" - " + item);
  process.exit(1);
}
console.log("TrueShine checks passed: HTML anchors/IDs, key sections, inline JS syntax, subscription price sync, CRM access guard and session expiry.");
