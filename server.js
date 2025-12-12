const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const schedule = require('node-schedule');

// ==================== КОНФИГУРАЦИЯ ====================
const PORT = process.env.PORT || 3000;
const TG_TOKEN = process.env.TG_TOKEN || '8312141276:AAFLtadgdX4b7v9c8WJohXC-8PUBMUSUNpw';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '1627227943';
const APP_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();
const bot = new TelegramBot(TG_TOKEN, { polling: false });

// Статистика для мониторинга
let stats = {
    startTime: new Date(),
    totalRequests: 0,
    successfulRequests: 0,
    lastPing: null,
    activeUsers: new Set()
};

// ==================== МИДЛВЭРЫ ====================
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// ==================== АВТОПИНГ СИСТЕМА ====================
class AutoPinger {
    constructor() {
        this.methods = [
            this.pingMethod1.bind(this),
            this.pingMethod2.bind(this),
            this.pingMethod3.bind(this)
        ];
        this.isRunning = false;
    }

    // Метод 1: Прямой HTTP запрос
    async pingMethod1() {
        try {
            const response = await axios.get(`${APP_URL}/health`, { timeout: 10000 });
            console.log(`[Method 1] ${new Date().toLocaleTimeString()} - ${response.status}`);
            stats.successfulRequests++;
            return true;
        } catch (error) {
            console.log(`[Method 1] Error: ${error.message}`);
            return false;
        }
    }

    // Метод 2: WebSocket эмуляция
    async pingMethod2() {
        try {
            const response = await axios.head(`${APP_URL}`, { timeout: 8000 });
            console.log(`[Method 2] ${new Date().toLocaleTimeString()} - ${response.status}`);
            stats.successfulRequests++;
            return true;
        } catch (error) {
            console.log(`[Method 2] Error: ${error.message}`);
            return false;
        }
    }

    // Метод 3: Комплексный запрос с данными
    async pingMethod3() {
        try {
            const response = await axios.post(`${APP_URL}/api/ping`, {
                timestamp: Date.now(),
                source: 'auto-pinger',
                method: 'complex'
            }, { timeout: 12000 });
            console.log(`[Method 3] ${new Date().toLocaleTimeString()} - ${response.status}`);
            stats.successfulRequests++;
            return true;
        } catch (error) {
            console.log(`[Method 3] Error: ${error.message}`);
            return false;
        }
    }

    // Запуск всех методов
    async pingAll() {
        console.log(`\n[${new Date().toLocaleTimeString()}] Starting auto-ping...`);
        stats.lastPing = new Date();
        
        const results = await Promise.allSettled(
            this.methods.map(method => method())
        );
        
        const successful = results.filter(r => r.status === 'fulfilled' && r.value).length;
        console.log(`Result: ${successful}/${this.methods.length} methods successful`);
        
        return successful > 0;
    }

    // Запуск периодического пинга
    start(intervalMinutes = 3) {
        if (this.isRunning) return;
        
        this.isRunning = true;
        
        // Пинг каждые N минут
        schedule.scheduleJob(`*/${intervalMinutes} * * * *`, async () => {
            await this.pingAll();
        });
        
        // Пинг сразу при старте
        setTimeout(() => this.pingAll(), 5000);
        
        console.log(`Auto-ping started (interval: ${intervalMinutes} minutes)`);
    }
}

// Инициализация пингера
const pinger = new AutoPinger();

// ==================== TELEGRAM БОТ ====================
async function sendToTelegram(username, ip) {
    try {
        const message = `📩 *Новая заявка!*\n\n👤 *Username:* @${username}\n🕐 *Время:* ${new Date().toLocaleString('ru-RU')}\n🌐 *IP:* ${ip}\n🔗 *Ссылка:* https://t.me/${username.replace('@', '')}`;
        
        await bot.sendMessage(ADMIN_CHAT_ID, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '📨 Написать', url: `https://t.me/${username.replace('@', '')}` },
                    { text: '📊 Статистика', callback_data: 'stats' }
                ]]
            }
        });
        
        return true;
    } catch (error) {
        console.error('Telegram send error:', error.message);
        return false;
    }
}

// ==================== РОУТЫ ====================

// Главная страница
app.get('/', (req, res) => {
    stats.totalRequests++;
    
    res.render('index', {
        title: 'Alpha Access',
        year: new Date().getFullYear(),
        totalUsers: stats.activeUsers.size,
        uptime: Math.floor((new Date() - stats.startTime) / 1000 / 60)
    });
});

// API для отправки заявки
app.post('/api/submit', async (req, res) => {
    try {
        const { username } = req.body;
        const ip = req.ip || req.connection.remoteAddress;
        
        if (!username || username.trim() === '') {
            return res.status(400).json({ 
                success: false, 
                message: 'Введите username' 
            });
        }
        
        // Очистка username
        const cleanUsername = username.replace('@', '').trim();
        
        // Добавляем пользователя в статистику
        stats.activeUsers.add(cleanUsername);
        
        // Отправляем в Telegram
        const telegramSent = await sendToTelegram(cleanUsername, ip);
        
        if (telegramSent) {
            res.json({ 
                success: true, 
                message: `✅ Заявка @${cleanUsername} отправлена!`,
                data: {
                    username: cleanUsername,
                    timestamp: new Date().toISOString(),
                    id: Date.now()
                }
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'Ошибка отправки' 
            });
        }
        
    } catch (error) {
        console.error('Ошибка обработки заявки:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Внутренняя ошибка сервера' 
        });
    }
});

// Health check для автопинга
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        stats: {
            totalRequests: stats.totalRequests,
            activeUsers: stats.activeUsers.size,
            lastPing: stats.lastPing
        }
    });
});

// API для ручного пинга
app.post('/api/ping', (req, res) => {
    stats.totalRequests++;
    res.json({ 
        status: 'pong', 
        timestamp: Date.now(),
        received: req.body 
    });
});

// Статистика
app.get('/api/stats', (req, res) => {
    res.json({
        success: true,
        data: {
            ...stats,
            startTime: stats.startTime.toISOString(),
            lastPing: stats.lastPing ? stats.lastPing.toISOString() : null,
            activeUsers: Array.from(stats.activeUsers),
            uptimeMinutes: Math.floor((new Date() - stats.startTime) / 1000 / 60)
        }
    });
});

// Команды для управления
app.get('/api/commands', (req, res) => {
    const commands = {
        start: `node ${__filename}`,
        install: 'npm install express body-parser axios node-telegram-bot-api node-schedule ejs',
        deploy: `git push origin main && echo "Deployed to Render"`,
        monitor: `curl ${APP_URL}/health`,
        stats: `curl ${APP_URL}/api/stats`,
        ping: `curl -X POST ${APP_URL}/api/ping -H "Content-Type: application/json" -d '{"test":"ping"}'`
    };
    
    res.json(commands);
});

// Скачивание проекта
app.get('/download', (req, res) => {
    const packageJson = {
        name: "telegram-bot-site",
        version: "1.0.0",
        scripts: {
            "start": "node server.js",
            "dev": "nodemon server.js"
        },
        dependencies: {
            "express": "^4.18.2",
            "body-parser": "^1.20.2",
            "axios": "^1.6.2",
            "node-telegram-bot-api": "^0.63.0",
            "node-schedule": "^2.1.1",
            "ejs": "^3.1.9"
        }
    };
    
    const readme = `# Telegram Bot Site

## Установка
\`\`\`bash
npm install
\`\`\`

## Запуск
\`\`\`bash
# Разработка
npm run dev

# Продакшен
npm start
\`\`\`

## Переменные окружения
\`\`\`bash
PORT=3000
TG_TOKEN=ваш_токен_бота
ADMIN_CHAT_ID=ваш_chat_id
RENDER_EXTERNAL_URL=https://ваш-сайт.onrender.com
\`\`\`

## Deploy на Render
1. Создайте новый Web Service
2. Подключите GitHub репозиторий
3. Установите переменные окружения
4. Deploy!

## Автопинг
Сервис автоматически пингует себя каждые 3 минуты
`;
    
    res.json({
        files: {
            'server.js': 'Основной файл сервера',
            'package.json': JSON.stringify(packageJson, null, 2),
            'README.md': readme,
            'public/': 'Статические файлы',
            'views/': 'EJS шаблоны'
        }
    });
});

// 404
app.use((req, res) => {
    res.status(404).render('404', {
        title: '404 - Не найдено',
        year: new Date().getFullYear()
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
app.listen(PORT, () => {
    console.log(`
    ============================================
    SERVER STARTED!
    Local: http://localhost:${PORT}
    External URL: ${APP_URL}
    Health check: ${APP_URL}/health
    Stats: ${APP_URL}/api/stats
    ============================================
    `);
    
    // Запускаем автопинг
    pinger.start(3);
    
    // Отправляем уведомление в Telegram о старте
    setTimeout(async () => {
        try {
            await bot.sendMessage(ADMIN_CHAT_ID, 
                `✅ Сервер запущен!\n🌐 ${APP_URL}\n🕐 ${new Date().toLocaleString('ru-RU')}`
            );
        } catch (error) {
            console.log('Не удалось отправить уведомление в Telegram');
        }
    }, 10000);
});
