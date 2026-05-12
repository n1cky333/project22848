/**
 * server.js — La Maison Restaurant API
 * Авторизация через токен в заголовке X-Admin-Token
 * (вместо cookie — для кросс-доменной работы Railway + Vercel)
 */
require('dotenv').config();
const express = require('express');
const mysql   = require('mysql2/promise');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;
const origin = (process.env.FRONTEND_URL || '').replace(/\/+$/, '') || '*';

// ── Logging Middleware (самый первый!) ───────────────────────────
app.use((req, res, next) => {
  console.log(`→ ${req.method} ${req.url}`);
  console.log('Headers:', {
    authorization: req.headers.authorization || null,
    'x-admin-token': req.headers['x-admin-token'] || null
  });
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', req.body);
  }
  next();
});



// Токены в памяти: token -> { adminId, login, expiresAt }
const tokens = new Map();
const TOKEN_TTL = 24 * 60 * 60 * 1000;

// ── БД ────────────────────────────────────────
const dbCfg = {
  host    : process.env.MYSQLHOST     || process.env.DB_HOST     || 'localhost',
  user    : process.env.MYSQLUSER     || process.env.DB_USER     || 'root',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.MYSQLDATABASE || process.env.DB_NAME     || 'restaurant_db',
  port    : parseInt(process.env.MYSQLPORT || '3306', 10),
  charset : 'utf8mb4',
  timezone: '+00:00',
};
let db;
async function initDB() {
  db = await mysql.createPool({ ...dbCfg, waitForConnections: true, connectionLimit: 10 });
  const c = await db.getConnection(); c.release();
  console.log('✅  MySQL подключён:', dbCfg.host);
}

// ── CORS + Logging ──────────────────────────────────────
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token']
}));

app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Admin-Token');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(204);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Auth middleware (поддержка двух способов) ───────────────────────────
function auth(req, res, next) {
  let token = req.headers['x-admin-token'];

  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.substring(7).trim();
  }

  if (!token) {
    console.log('❌ No token in request');
    return res.status(401).json({ success: false, message: 'Требуется авторизация' });
  }

  const session = tokens.get(token);
  if (!session) {
    console.log('❌ Token not found');
    return res.status(401).json({ success: false, message: 'Токен недействителен' });
  }

  if (Date.now() > session.expiresAt) {
    tokens.delete(token);
    return res.status(401).json({ success: false, message: 'Сессия истекла' });
  }

  req.adminId = session.adminId;
  req.adminLogin = session.login;
  next();
}

// ── seedAdmin ─────────────────────────────────
async function seedAdmin() {
  const [r] = await db.query("SELECT * FROM admins WHERE login='admin'");
  if (!r.length) {
    await db.query('INSERT INTO admins(login,password) VALUES(?,?)', ['admin', await bcrypt.hash('admin123', 10)]);
    console.log('👤  Создан admin / admin123');
  } else if (!await bcrypt.compare('admin123', r[0].password)) {
    await db.query("UPDATE admins SET password=? WHERE login='admin'", [await bcrypt.hash('admin123', 10)]);
    console.log('👤  Хэш исправлен');
  } else console.log('👤  Администратор OK');
}

// ═══════════════════════════════════════════════
// ПУБЛИЧНЫЕ МАРШРУТЫ
// ═══════════════════════════════════════════════
app.get('/health', (_q, r) => r.json({ ok: true }));

app.get('/api/tables', async (req, res) => {
  try {
    const { date, time, duration = 120 } = req.query;
    const [tables] = await db.query(`
      SELECT t.*, z.zone_name FROM \`tables\` t
      JOIN table_zones z ON t.zone_id=z.zone_id ORDER BY t.table_number`);
    if (!date || !time) return res.json({ success: true, tables: tables.map(t => ({ ...t, available: true })) });
    const [busy] = await db.query(`
      SELECT DISTINCT r.table_id FROM reservations r
      JOIN reservation_statuses rs ON r.status_id=rs.status_id
      WHERE r.reservation_date=? AND rs.status_code NOT IN('cancelled')
        AND ADDTIME(r.reservation_time,SEC_TO_TIME(r.duration*60))>?
        AND r.reservation_time<ADDTIME(?,SEC_TO_TIME(?*60))`,
      [date, time, time, Number(duration)]);
    const bs = new Set(busy.map(b => b.table_id));
    res.json({ success: true, tables: tables.map(t => ({ ...t, available: !bs.has(t.table_id) })) });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Ошибка сервера' }); }
});

app.post('/api/reservations', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { full_name, phone, email, table_id, reservation_date, reservation_time, guests_count, duration = 120, special_request } = req.body;
    if (!full_name || !phone || !email || !table_id || !reservation_date || !reservation_time || !guests_count)
      return res.status(400).json({ success: false, message: 'Заполните все обязательные поля' });

    await conn.beginTransaction();

    const [tbls] = await conn.query(`SELECT t.*,z.zone_name FROM \`tables\` t JOIN table_zones z ON t.zone_id=z.zone_id WHERE t.table_id=?`, [table_id]);
    if (!tbls.length) { await conn.rollback(); return res.status(400).json({ success: false, message: 'Стол не найден' }); }
    const tbl = tbls[0];
    if (Number(guests_count) > tbl.seats_count) { await conn.rollback(); return res.status(400).json({ success: false, message: `Стол №${tbl.table_number} рассчитан на ${tbl.seats_count} мест` }); }

    const [conf] = await conn.query(`
      SELECT r.reservation_id FROM reservations r
      JOIN reservation_statuses rs ON r.status_id=rs.status_id
      WHERE r.table_id=? AND r.reservation_date=? AND rs.status_code NOT IN('cancelled')
        AND ADDTIME(r.reservation_time,SEC_TO_TIME(r.duration*60))>?
        AND r.reservation_time<ADDTIME(?,SEC_TO_TIME(?*60))`,
      [table_id, reservation_date, reservation_time, reservation_time, Number(duration)]);
    if (conf.length) { await conn.rollback(); return res.status(409).json({ success: false, message: 'Стол уже занят в это время. Выберите другое.' }); }

    let cid;
    const [ex] = await conn.query('SELECT customer_id FROM customers WHERE email=?', [email]);
    if (ex.length) { cid = ex[0].customer_id; await conn.query('UPDATE customers SET full_name=?,phone=? WHERE customer_id=?', [full_name, phone, cid]); }
    else { const [r] = await conn.query('INSERT INTO customers(full_name,phone,email) VALUES(?,?,?)', [full_name, phone, email]); cid = r.insertId; }

    const [[sr]] = await conn.query("SELECT status_id FROM reservation_statuses WHERE status_code='pending'");
    const [rr] = await conn.query(
      `INSERT INTO reservations(customer_id,table_id,status_id,reservation_date,reservation_time,guests_count,duration) VALUES(?,?,?,?,?,?,?)`,
      [cid, table_id, sr.status_id, reservation_date, reservation_time, guests_count, duration]);

    if (special_request?.trim())
      await conn.query('INSERT INTO special_requests(reservation_id,request_text) VALUES(?,?)', [rr.insertId, special_request.trim()]);

    await conn.commit();
    res.json({ success: true, message: 'Стол успешно забронирован!', reservation_id: rr.insertId });
  } catch (e) { await conn.rollback(); console.error(e); res.status(500).json({ success: false, message: 'Ошибка сервера' }); }
  finally { conn.release(); }
});

// ═══════════════════════════════════════════════
// ADMIN МАРШРУТЫ (токен в заголовке X-Admin-Token)
// ═══════════════════════════════════════════════
app.post('/api/admin/login', async (req, res) => {
  try {
    console.log('=== LOGIN ATTEMPT ===');
    const { login, password } = req.body || {};
    console.log('Login:', login);

    if (!login || !password) {
      return res.status(400).json({ success: false, message: 'Введите логин и пароль' });
    }

    const [rows] = await db.query('SELECT * FROM admins WHERE login=?', [login]);
    
    if (!rows.length) {
      console.log('❌ User not found');
      return res.status(401).json({ success: false, message: 'Неверный логин или пароль' });
    }

    const passwordMatch = await bcrypt.compare(password, rows[0].password);
    console.log('Password match:', passwordMatch);

    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Неверный логин или пароль' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(token, { 
      adminId: rows[0].admin_id, 
      login: rows[0].login, 
      expiresAt: Date.now() + TOKEN_TTL 
    });

    console.log(`✅ SUCCESSFUL LOGIN! Token created: ${token.substring(0,20)}...`);

    res.json({ 
      success: true, 
      token: token,
      login: rows[0].login 
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

app.post('/api/admin/logout', auth, (req, res) => {
  tokens.delete(req.headers['x-admin-token']);
  res.json({ success: true });
});

app.get('/api/admin/check', auth, (req, res) => res.json({ success: true, login: req.adminLogin }));

app.get('/api/admin/reservations', auth, async (req, res) => {
  try {
    const { date, status } = req.query;
    const params = []; let where = 'WHERE 1=1';
    if (date)   { where += ' AND r.reservation_date=?';  params.push(date); }
    if (status) { where += ' AND rs.status_code=?';       params.push(status); }
    const [rows] = await db.query(`
      SELECT r.reservation_id,r.reservation_date,r.reservation_time,r.guests_count,r.duration,r.created_at,
             c.full_name,c.phone,c.email,
             t.table_number,t.seats_count,z.zone_name,
             rs.status_code,rs.status_name,rs.badge_color,
             GROUP_CONCAT(sr.request_text SEPARATOR ' | ') AS special_requests
      FROM reservations r
      JOIN customers c ON r.customer_id=c.customer_id
      JOIN \`tables\` t ON r.table_id=t.table_id
      JOIN table_zones z ON t.zone_id=z.zone_id
      JOIN reservation_statuses rs ON r.status_id=rs.status_id
      LEFT JOIN special_requests sr ON r.reservation_id=sr.reservation_id
      ${where} GROUP BY r.reservation_id
      ORDER BY r.reservation_date DESC,r.reservation_time DESC`, params);
    res.json({ success: true, reservations: rows });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Ошибка сервера' }); }
});

app.patch('/api/admin/reservations/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['pending','confirmed','cancelled','completed'].includes(status))
      return res.status(400).json({ success: false, message: 'Недопустимый статус' });
    const [[sr]] = await db.query('SELECT status_id FROM reservation_statuses WHERE status_code=?', [status]);
    await db.query('UPDATE reservations SET status_id=? WHERE reservation_id=?', [sr.status_id, req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Ошибка сервера' }); }
});

app.delete('/api/admin/reservations/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM reservations WHERE reservation_id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Ошибка сервера' }); }
});

app.get('/api/admin/stats', auth, async (req, res) => {
  try {
    const [[t1]] = await db.query(`SELECT COUNT(*) c FROM reservations r JOIN reservation_statuses rs ON r.status_id=rs.status_id WHERE rs.status_code!='cancelled'`);
    const [[t2]] = await db.query(`SELECT COUNT(*) c FROM reservations r JOIN reservation_statuses rs ON r.status_id=rs.status_id WHERE r.reservation_date=CURDATE() AND rs.status_code!='cancelled'`);
    const [[t3]] = await db.query(`SELECT COUNT(*) c FROM reservations r JOIN reservation_statuses rs ON r.status_id=rs.status_id WHERE rs.status_code='pending'`);
    const [[t4]] = await db.query('SELECT COUNT(*) c FROM customers');
    const [[t5]] = await db.query('SELECT COUNT(*) c FROM table_zones');
    res.json({ success: true, stats: { total: t1.c, today: t2.c, pending: t3.c, customers: t4.c, zones: t5.c } });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Ошибка сервера' }); }
});

// ── Запуск ────────────────────────────────────
initDB().then(async () => {
  await seedAdmin();
  app.listen(PORT, () => {
    console.log(`🍽️  Сервер запущен на порту ${PORT}`);
    console.log(`🌐 FRONTEND_URL: ${origin}`);
  });
}).catch(e => { 
  console.error('❌ БД:', e.message); 
  process.exit(1); 
});
