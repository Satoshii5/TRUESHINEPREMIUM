# TrueShine AI + Telegram Worker

Этот Worker нужен для настоящих ответов ИИ и автоматической доставки заявок в Telegram. GitHub Pages обслуживает только статические файлы, поэтому токены нельзя помещать в index.html.

## 1. Развернуть Worker
1. Создайте бесплатный аккаунт Cloudflare и откройте Workers & Pages.
2. Создайте Worker с именем, например, trueshine-assistant.
3. Вставьте содержимое файла worker.js в редактор Worker и разверните его.
4. В Settings → Variables and Secrets добавьте secrets:
   - OPENAI_API_KEY — API-ключ OpenAI (платное API; подписка ChatGPT его не включает).
   - TELEGRAM_BOT_TOKEN — токен, полученный от официального @BotFather.
   - TELEGRAM_CHAT_ID — ID личного чата или группы, куда должны приходить заявки.
   - OPENAI_MODEL — необязательная обычная переменная, по умолчанию gpt-4.1-mini.
5. Создайте бота через @BotFather, добавьте его в целевой чат и отправьте ему /start (или добавьте в группу и напишите сообщение), чтобы Telegram разрешил доставку.
6. Скопируйте URL Worker вида https://trueshine-assistant.<ваш-аккаунт>.workers.dev.

## 2. Подключить API к сайту
В index.html найдите в начале скрипта:
`const API_ENDPOINT = "";`
и замените пустую строку на URL вашего Worker, например:
`const API_ENDPOINT = "https://trueshine-assistant.example.workers.dev";`
После этого сохраните index.html в GitHub. Не вставляйте секретные токены в сайт или публичный репозиторий.

## API endpoints
- POST /chat — отвечает на вопрос с помощью OpenAI API.
- POST /lead — отправляет структурированную заявку в Telegram.

## Важно
До добавления секретов и указания URL Worker сайт работает в справочном режиме, а форма открывает Telegram Share с подготовленным текстом. После настройки Worker заявки отправляются ботом в чат автоматически. Проверяйте доставку тестовой заявкой.
