require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || `https://your-app.railway.app`;

// Хранилище комнат
const rooms = new Map();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Telegram Bot
let bot;
if (BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });

  // Команда /start
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name || 'Друг';

    bot.sendMessage(chatId,
      `🎤 Привет, ${userName}!\n\nДобро пожаловать в *KaRaFoN* — приложение для караоке с друзьями!\n\n` +
      `🎵 Включи музыку на телефоне\n` +
      `🔊 Подключись к Bluetooth колонке\n` +
      `🎙️ Открой приложение и пой!\n\n` +
      `Нажми кнопку ниже, чтобы начать:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🎤 Открыть KaRaFoN', web_app: { url: WEBAPP_URL } }
          ]]
        }
      }
    );
  });

  // Команда /create - создать комнату
  bot.onText(/\/create/, (msg) => {
    const chatId = msg.chat.id;
    const roomId = uuidv4().substring(0, 8);

    bot.sendMessage(chatId,
      `🎉 Комната создана!\n\n` +
      `📍 Код комнаты: \`${roomId}\`\n\n` +
      `Поделись этим кодом с друзьями, чтобы они могли присоединиться!`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🎤 Войти в комнату', web_app: { url: `${WEBAPP_URL}?room=${roomId}` } }
          ]]
        }
      }
    );
  });

  // Команда /join - присоединиться к комнате
  bot.onText(/\/join (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const roomId = match[1].trim();

    bot.sendMessage(chatId,
      `🎵 Присоединяйся к комнате \`${roomId}\`!`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🎤 Присоединиться', web_app: { url: `${WEBAPP_URL}?room=${roomId}` } }
          ]]
        }
      }
    );
  });

  // Команда /help
  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(chatId,
      `📖 *Как пользоваться KaRaFoN:*\n\n` +
      `1️⃣ Включи музыку в любом плеере\n` +
      `2️⃣ Подключи телефон к Bluetooth колонке\n` +
      `3️⃣ Открой KaRaFoN и разреши доступ к микрофону\n` +
      `4️⃣ Твой голос будет звучать вместе с музыкой!\n\n` +
      `*Команды:*\n` +
      `/start — Главное меню\n` +
      `/create — Создать комнату для пения с друзьями\n` +
      `/join <код> — Присоединиться к комнате\n` +
      `/help — Эта справка`,
      { parse_mode: 'Markdown' }
    );
  });

  console.log('🤖 Telegram Bot started');
} else {
  console.log('⚠️  BOT_TOKEN not set, bot disabled');
}

// API эндпоинты
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Получить информацию о комнате
app.get('/api/room/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);

  if (room) {
    res.json({
      id: roomId,
      participants: room.participants.size,
      created: room.created
    });
  } else {
    res.json({ id: roomId, participants: 0, exists: false });
  }
});

// WebSocket для real-time коммуникации
io.on('connection', (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);

  let currentRoom = null;
  let userName = 'Anonymous';

  // Присоединение к комнате
  socket.on('join-room', (data) => {
    const { roomId, name } = data;
    userName = name || 'Anonymous';
    currentRoom = roomId;

    // Создаём комнату если не существует
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        participants: new Map(),
        created: Date.now()
      });
    }

    const room = rooms.get(roomId);
    room.participants.set(socket.id, { name: userName, joinedAt: Date.now() });

    socket.join(roomId);

    // Уведомляем всех в комнате
    io.to(roomId).emit('user-joined', {
      id: socket.id,
      name: userName,
      participants: Array.from(room.participants.entries()).map(([id, info]) => ({
        id,
        name: info.name
      }))
    });

    console.log(`👤 ${userName} joined room ${roomId}`);
  });

  // WebRTC сигнализация - offer
  socket.on('offer', (data) => {
    const { to, offer } = data;
    socket.to(to).emit('offer', {
      from: socket.id,
      name: userName,
      offer
    });
  });

  // WebRTC сигнализация - answer
  socket.on('answer', (data) => {
    const { to, answer } = data;
    socket.to(to).emit('answer', {
      from: socket.id,
      answer
    });
  });

  // WebRTC сигнализация - ICE candidate
  socket.on('ice-candidate', (data) => {
    const { to, candidate } = data;
    socket.to(to).emit('ice-candidate', {
      from: socket.id,
      candidate
    });
  });

  // Микрофон включен/выключен
  socket.on('mic-status', (data) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('user-mic-status', {
        id: socket.id,
        name: userName,
        enabled: data.enabled
      });
    }
  });

  // Отключение
  socket.on('disconnect', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.participants.delete(socket.id);

      io.to(currentRoom).emit('user-left', {
        id: socket.id,
        name: userName,
        participants: Array.from(room.participants.entries()).map(([id, info]) => ({
          id,
          name: info.name
        }))
      });

      // Удаляем пустую комнату
      if (room.participants.size === 0) {
        rooms.delete(currentRoom);
        console.log(`🗑️  Room ${currentRoom} deleted (empty)`);
      }
    }

    console.log(`🔌 User disconnected: ${socket.id}`);
  });
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 KaRaFoN server running on port ${PORT}`);
  console.log(`🌐 WebApp URL: ${WEBAPP_URL}`);
});
