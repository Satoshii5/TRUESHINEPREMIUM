# TrueShine CRM, loyalty and SMS — setup
## Included
- `crm.html`: private-facing CRM interface at `/crm.html`.
- `crm-schema.sql`: D1 schema for customers, orders, points and SMS outbox.
- `worker.js`: retains existing lead and AI endpoints and adds protected CRM API routes.

## Cloudflare setup required before CRM data works
1. In Cloudflare Dashboard → Workers & Pages → D1 SQL Database, create a database named `trueshine-crm`.
2. Open its Console and run all SQL from `crm-schema.sql`.
3. In the Worker `trueshine-telegram-leads`, Settings → Bindings, add a D1 database binding named **DB** pointing to `trueshine-crm`.
4. Add a Worker secret named **CRM_ADMIN_TOKEN** with a long random value (at least 32 random characters). Do not put it in GitHub, HTML, or chat.
5. Deploy the updated `worker.js` to the existing Worker. Keep existing `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `OPENAI_API_KEY` secrets.
6. Open `https://trueshinee.github.io/TRUESHINEPREMIUM/crm.html` (or the actual published site path) and sign in with the CRM token.

## SMS
SMS sending is **not enabled by this commit**. International SMS requires an SMS provider account, destination-country permissions, a configured sender, and secrets stored only in Cloudflare. A provider's free trial may restrict recipients and message templates. Add the provider only after confirming the countries and sender requirements. The UI must not be treated as evidence that a message was sent.
## Loyalty
Draft tiers: Start 3%, Silver 5% after 3 paid orders, VIP 7% after 10 paid orders. Before live redemption, publish clear terms for eligible services, when points are credited, their value, expiry, exclusions, refunds and how to opt out. Do not credit points before payment is confirmed.
## Privacy and security
- CRM endpoints require the bearer token in `CRM_ADMIN_TOKEN`.
- The token is sent only to the Worker and stored in sessionStorage for the current browser tab/session.
- Restrict access to trusted staff. Do not collect unnecessary personal data.
- Record SMS consent only when freely given; do not send marketing messages without applicable consent.
- Check applicable privacy and electronic-marketing law for each customer location before production use.
