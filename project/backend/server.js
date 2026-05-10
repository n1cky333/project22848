/**
 * server.js — La Maison Restaurant API
 * Бэкенд для Railway. Фронтенд живёт на Vercel (другой домен).
 * Поэтому: CORS с credentials + sameSite:'none' + secure:true в проде.
 */

require('dotenv').config();
const express = require('express');
const mysql   = require('mysql2/promise');
const bcrypt  = require('bcryptjs');
const session = require('express-session');
const cors    = require('cors');

const app    = express();
const PORT   = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ─────────────────────────────────────────────
// Конфигурация БД (Railway автоматически
// предоставляет MYSQL_* переменные)
// ─────────────────────────────────────────────
const dbConfig = {
  host    : process.env.MYSQLHOST     || process.env.DB_HOST     || 'localhost',
  user    : process.env.MYSQLUSER     || process.env.DB_USER     || 'root',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.MYSQLDATABASE || process.env.DB_NAME     || 'restaurant_db',
  port    : process.env.MYSQLPORT     || 3306,
  charset : 'utf8mb4',
  timezone: '+00:00',
};

let db;

async function initDB() {
  db = await mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit   : 10,
  });
  const conn = await db.getConnection();
  conn.release();
  console.log('✅  MySQL подключён:', dbConfig.host);
}

// ─────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────

// CORS — разрешаем только наш фронтенд на Vercel
const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:5500';

app.use(cors({
  origin     : allowedOrigin,
  credentials: true,              // разрешаем куки между доменами
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SESSION — cross-origin требует secure:true + sameSite:'none'
app.use(session({
  secret           : process.env.SESSION_SECRET || 'la_maison_secret_2024',
  resave           : true,
  saveUninitialized: false,
  cookie: {
    secure  : isProd,                       // true на Railway (HTTPS)
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',     // 'none' нужен для cross-origin
    maxAge  : 24 * 60 * 60 * 1000,
  },
}));

// ─────────────────────────────────────────────
// Auth middleware
// ─────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  return res.status(401).json({ success: false, message: 'Требуется авторизация' });
}

// ─────────────────────────────────────────────
// Создание / проверка администратора при старте
// ─────────────────────────────────────────────
async function seedAdmin() {
  const [rows] = await db.query("SELECT * FROM admins WHERE login = 'admin'");

  if (!rows.length) {
    const hash = await bcrypt.hash('admin123', 10);
    await db.query('INSERT INTO admins (login, password) VALUES (?, ?)', ['admin', hash]);
    console.log('👤  Администратор создан: login=admin  password=admin123');
    return;
  }

  const isValid = await bcrypt.compare('admin123', rows[0].password);
  if (!isValid) {
    const hash = await bcrypt.hash('admin123', 10);
    await db.query("UPDATE admins SET password = ? WHERE login = 'admin'", [hash]);
    console.log('👤  Хэш администратора исправлен');
  } else {
    console.log('👤  Администратор OK: login=admin');
  }
}

// ═══════════════════════════════════════════════════════════
//  ПУБЛИЧНЫЙ API
// ═══════════════════════════════════════════════════════════

// Health-check для Railway
app.get('/health', (req, res) => res.json({ ok: true }));

/**
 * GET /api/tables?date=&time=&duration=
 */
app.get('/api/tables', async (req, res) => {
  try {
    const { date, time, duration = 120 } = req.query;

    const [tables] = await db.query(`
      SELECT t.*, z.zone_name
      FROM \`tables\` t
      JOIN table_zones z ON t.zone_id = z.zone_id
      ORDER BY t.table_number
    `);

    if (!date || !time) {
      return res.json({ success: true, tables: tables.map(t => ({ ...t, available: true })) });
    }

    const [busy] = await db.query(`
      SELECT DISTINCT r.table_id
      FROM reservations r
      JOIN reservation_statuses rs ON r.status_id = rs.status_id
      WHERE r.reservation_date = ?
        AND rs.status_code NOT IN ('cancelled')
        AND ADDTIME(r.reservation_time, SEC_TO_TIME(r.duration * 60)) > ?
        AND r.reservation_time < ADDTIME(?, SEC_TO_TIME(? * 60))
    `, [date, time, time, Number(duration)]);

    const busySet = new Set(busy.map(b => b.table_id));
    res.json({ success: true, tables: tables.map(t => ({ ...t, available: !busySet.has(t.table_id) })) });
  } catch (err) {
    console.error('GET /api/tables:', err);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

/**
 * POST /api/reservations
 */
app.post('/api/reservations', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const {
      full_name, phone, email,
      table_id, reservation_date, reservation_time,
      guests_count, duration = 120, special_request,
    } = req.body;

    if (!full_name || !phone || !email || !table_id ||
        !reservation_date || !reservation_time || !guests_count) {
      return res.status(400).json({ success: false, message: 'Заполните все обязательные поля' });
    }

    await conn.beginTransaction();

    const [tables] = await conn.query(`
      SELECT t.*, z.zone_name FROM \`tables\` t
      JOIN table_zones z ON t.zone_id = z.zone_id
      WHERE t.table_id = ?
    `, [table_id]);

    if (!tables.length) { await conn.rollback(); return res.status(400).json({ success: false, message: 'Стол не найден' }); }

    const table = tables[0];
    if (Number(guests_count) > table.seats_count) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: `Стол №${table.table_number} рассчитан на ${table.seats_count} мест` });
    }

    const [conflicts] = await conn.query(`
      SELECT r.reservation_id FROM reservations r
      JOIN reservation_statuses rs ON r.status_id = rs.status_id
      WHERE r.table_id = ? AND r.reservation_date = ?
        AND rs.status_code NOT IN ('cancelled')
        AND ADDTIME(r.reservation_time, SEC_TO_TIME(r.duration * 60)) > ?
        AND r.reservation_time < ADDTIME(?, SEC_TO_TIME(? * 60))
    `, [table_id, reservation_date, reservation_time, reservation_time, Number(duration)]);

    if (conflicts.length) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'Стол уже занят в выбранное время. Выберите другое.' });
    }

    let customerId;
    const [existing] = await conn.query('SELECT customer_id FROM customers WHERE email = ?', [email]);
    if (existing.length) {
      customerId = existing[0].customer_id;
      await conn.query('UPDATE customers SET full_name = ?, phone = ? WHERE customer_id = ?', [full_name, phone, customerId]);
    } else {
      const [r] = await conn.query('INSERT INTO customers (full_name, phone, email) VALUES (?,?,?)', [full_name, phone, email]);
      customerId = r.insertId;
    }

    const [[statusRow]] = await conn.query("SELECT status_id FROM reservation_statuses WHERE status_code = 'pending'");

    const [resResult] = await conn.query(`
      INSERT INTO reservations (customer_id, table_id, status_id, reservation_date, reservation_time, guests_count, duration)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [customerId, table_id, statusRow.status_id, reservation_date, reservation_time, guests_count, duration]);

    if (special_request && special_request.trim()) {
      await conn.query('INSERT INTO special_requests (reservation_id, request_text) VALUES (?, ?)', [resResult.insertId, special_request.trim()]);
    }

    await conn.commit();
    res.json({ success: true, message: 'Стол успешно забронирован!', reservation_id: resResult.insertId });

  } catch (err) {
    await conn.rollback();
    console.error('POST /api/reservations:', err);
    res.status(500).json({ success: false, message: 'Ошибка при создании брони' });
  } finally {
    conn.release();
  }
});

// ═══════════════════════════════════════════════════════════
//  ADMIN API
// ═══════════════════════════════════════════════════════════

app.post('/api/admin/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ success: false, message: 'Введите логин и пароль' });

    const [rows] = await db.query('SELECT * FROM admins WHERE login = ?', [login]);
    if (!rows.length) return res.status(401).json({ success: false, message: 'Неверный логин или пароль' });

    const match = await bcrypt.compare(password, rows[0].password);
    if (!match) return res.status(401).json({ success: false, message: 'Неверный логин или пароль' });

    req.session.adminId = rows[0].admin_id;
    req.session.login   = rows[0].login;
    req.session.save(err => {
      if (err) return res.status(500).json({ success: false, message: 'Ошибка сессии' });
      res.json({ success: true, login: rows[0].login });
    });
  } catch (err) {
    console.error('POST /api/admin/login:', err);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/admin/check', (req, res) => {
  if (req.session && req.session.adminId) return res.json({ success: true, login: req.session.login });
  res.status(401).json({ success: false });
});

app.get('/api/admin/reservations', requireAdmin, async (req, res) => {
  try {
    const { date, status } = req.query;
    const params = [];
    let where = 'WHERE 1=1';
    if (date)   { where += ' AND r.reservation_date = ?'; params.push(date); }
    if (status) { where += ' AND rs.status_code = ?';     params.push(status); }

    const [rows] = await db.query(`
      SELECT r.reservation_id, r.reservation_date, r.reservation_time,
             r.guests_count, r.duration, r.created_at,
             c.full_name, c.phone, c.email,
             t.table_number, t.seats_count, z.zone_name,
             rs.status_code, rs.status_name, rs.badge_color,
             GROUP_CONCAT(sr.request_text SEPARATOR ' | ') AS special_requests
      FROM reservations r
      JOIN customers            c  ON r.customer_id = c.customer_id
      JOIN \`tables\`           t  ON r.table_id    = t.table_id
      JOIN table_zones          z  ON t.zone_id     = z.zone_id
      JOIN reservation_statuses rs ON r.status_id   = rs.status_id
      LEFT JOIN special_requests sr ON r.reservation_id = sr.reservation_id
      ${where}
      GROUP BY r.reservation_id
      ORDER BY r.reservation_date DESC, r.reservation_time DESC
    `, params);

    res.json({ success: true, reservations: rows });
  } catch (err) {
    console.error('GET /api/admin/reservations:', err);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

app.patch('/api/admin/reservations/:id/status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const allowed = ['pending', 'confirmed', 'cancelled', 'completed'];
    if (!allowed.includes(status)) return res.status(400).json({ success: false, message: 'Недопустимый статус' });

    const [[statusRow]] = await db.query('SELECT status_id FROM reservation_statuses WHERE status_code = ?', [status]);
    await db.query('UPDATE reservations SET status_id = ? WHERE reservation_id = ?', [statusRow.status_id, id]);
    res.json({ success: true, message: 'Статус обновлён' });
  } catch (err) {
    console.error('PATCH status:', err);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

app.delete('/api/admin/reservations/:id', requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM reservations WHERE reservation_id = ?', [req.params.id]);
    res.json({ success: true, message: 'Бронь удалена' });
  } catch (err) {
    console.error('DELETE reservation:', err);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [[total]]     = await db.query(`SELECT COUNT(*) AS cnt FROM reservations r JOIN reservation_statuses rs ON r.status_id=rs.status_id WHERE rs.status_code!='cancelled'`);
    const [[today]]     = await db.query(`SELECT COUNT(*) AS cnt FROM reservations r JOIN reservation_statuses rs ON r.status_id=rs.status_id WHERE r.reservation_date=CURDATE() AND rs.status_code!='cancelled'`);
    const [[pending]]   = await db.query(`SELECT COUNT(*) AS cnt FROM reservations r JOIN reservation_statuses rs ON r.status_id=rs.status_id WHERE rs.status_code='pending'`);
    const [[customers]] = await db.query('SELECT COUNT(*) AS cnt FROM customers');
    const [[zones]]     = await db.query('SELECT COUNT(*) AS cnt FROM table_zones');

    res.json({ success: true, stats: { total: total.cnt, today: today.cnt, pending: pending.cnt, customers: customers.cnt, zones: zones.cnt } });
  } catch (err) {
    console.error('GET /api/admin/stats:', err);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// ─────────────────────────────────────────────
// Запуск
// ─────────────────────────────────────────────
initDB()
  .then(async () => {
    await seedAdmin();
    app.listen(PORT, () => {
      console.log(`🍽️  API сервер запущен на порту ${PORT}`);
      console.log(`🌐  FRONTEND_URL: ${allowedOrigin}`);
    });
  })
  .catch(err => {
    console.error('❌  Не удалось подключиться к БД:', err.message);
    process.exit(1);
  });
