# KaRaFoN - Telegram Mini App for Karaoke

Караоке-приложение для Telegram, которое позволяет петь под музыку вместе с друзьями!

## Возможности

- **Соло режим** - пой один под любую музыку
- **Комнаты** - создавай комнаты и приглашай друзей петь вместе
- **WebRTC** - голос передаётся в реальном времени через peer-to-peer соединение
- **Выбор устройств** - выбирай микрофон и динамик
- **Аудио эффекты** - реверберация, эхо, телефон, робот и другие
- **Визуализация** - красивая визуализация звука в реальном времени
- **Bluetooth** - работает с Bluetooth колонками

## Как это работает

1. Включи музыку в любом плеере на телефоне
2. Подключи телефон к Bluetooth колонке
3. Открой бота KaRaFoN в Telegram
4. Разреши доступ к микрофону
5. Пой! Твой голос будет звучать вместе с музыкой через колонку

## Деплой на Railway

### 1. Создай Telegram бота

1. Открой [@BotFather](https://t.me/BotFather) в Telegram
2. Отправь `/newbot` и следуй инструкциям
3. Сохрани токен бота (например: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Деплой на Railway

1. Зайди на [Railway](https://railway.app)
2. Нажми "New Project" → "Deploy from GitHub repo"
3. Выбери этот репозиторий
4. После деплоя перейди в Settings → Variables и добавь:
   - `BOT_TOKEN` = токен твоего бота
   - `WEBAPP_URL` = URL твоего приложения (например: `https://karafon-production.up.railway.app`)

### 3. Настрой Mini App

1. Вернись к @BotFather
2. Отправь `/mybots` → выбери своего бота → Bot Settings → Menu Button
3. Настрой Menu Button:
   - URL: твой `WEBAPP_URL`
   - Title: "Открыть KaRaFoN"

## Локальная разработка

```bash
# Клонируй репозиторий
git clone https://github.com/your-username/karafon.git
cd karafon

# Установи зависимости
npm install

# Создай .env файл
cp .env.example .env
# Отредактируй .env и добавь свой BOT_TOKEN

# Запусти сервер
npm run dev
```

Для тестирования Mini App локально тебе понадобится HTTPS. Используй [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

Затем используй HTTPS URL от ngrok как `WEBAPP_URL`.

## Структура проекта

```
karafon/
├── src/
│   └── server.js        # Express сервер + Telegram Bot + WebSocket
├── public/
│   ├── index.html       # Главная страница Mini App
│   ├── css/
│   │   └── style.css    # Стили
│   └── js/
│       ├── app.js       # Главный файл приложения
│       ├── audio.js     # Управление аудио и эффектами
│       └── webrtc.js    # WebRTC для групповых сессий
├── package.json
├── railway.json         # Конфигурация Railway
└── README.md
```

## Команды бота

- `/start` - Главное меню с кнопкой запуска Mini App
- `/create` - Создать комнату для пения с друзьями
- `/join <код>` - Присоединиться к существующей комнате
- `/help` - Справка по использованию

## Технологии

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: Vanilla JS, Web Audio API, WebRTC
- **Telegram**: Telegram Bot API, Telegram Mini Apps
- **Deploy**: Railway

## Требования

- Node.js 18+
- Современный браузер с поддержкой WebRTC
- HTTPS (обязательно для доступа к микрофону)

## Лицензия

MIT
