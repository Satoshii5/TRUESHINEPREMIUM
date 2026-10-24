-- Run this once in Cloudflare D1 Console for the existing trueshine-crm database.
-- If a column already exists, remove its corresponding ALTER line before running.
ALTER TABLE customers ADD COLUMN telegram_chat_id TEXT;
ALTER TABLE orders ADD COLUMN service_at TEXT;
ALTER TABLE orders ADD COLUMN reminder_sent_at TEXT;
