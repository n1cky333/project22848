/**
 * admin.js — логика административной панели
 */

if (typeof API_URL === 'undefined') { var API_URL = ''; }

function api(path, opts = {}) {
  return fetch(API_URL + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  }).then(r => r.json());
}

// ──────────────────────────────────────────────
// Проверка сессии при загрузке
// ──────────────────────────────────────────────
async function checkSession() {
  const res = await api('/api/admin/check').catch(() => null);
  if (res && res.success) {
    showPanel();
    loadStats();
  } else {
    showLogin();
  }
}

// ──────────────────────────────────────────────
// Показать / скрыть экраны
// ──────────────────────────────────────────────
function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('admin-panel').style.display  = 'none';
}
function showPanel() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-panel').style.display  = 'flex';
}

// ──────────────────────────────────────────────
// Логин
// ──────────────────────────────────────────────
document.getElementById('btn-login')?.addEventListener('click', async () => {
  const login    = document.getElementById('l-login').value.trim();
  const password = document.getElementById('l-pass').value;
  const err      = document.getElementById('login-err');
  err.style.display = 'none';

  const btn = document.getElementById('btn-login');
  btn.disabled = true; btn.textContent = 'Вход…';

  const res = await api('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ login, password }),
  }).catch(() => null);

  btn.disabled = false; btn.textContent = 'Войти';

  if (res && res.success) {
    showPanel();
    loadStats();
  } else {
    err.textContent = (res && res.message) || 'Ошибка входа';
    err.className = 'form-msg form-msg--error';
    err.style.display = 'block';
  }
});

// Enter в поле пароля
document.getElementById('l-pass')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-login').click();
});

// ──────────────────────────────────────────────
// Выход
// ──────────────────────────────────────────────
document.getElementById('btn-logout')?.addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

// ──────────────────────────────────────────────
// Навигация между разделами
// ──────────────────────────────────────────────
document.querySelectorAll('.sidebar__item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sidebar__item').forEach(b => b.classList.remove('sidebar__item--active'));
    btn.classList.add('sidebar__item--active');

    const view = btn.dataset.view;
    document.querySelectorAll('.admin-view').forEach(v => v.style.display = 'none');
    document.getElementById(`view-${view}`).style.display = 'block';

    if (view === 'dashboard')    loadStats();
    if (view === 'reservations') loadReservations();
  });
});

// ──────────────────────────────────────────────
// Статистика
// ──────────────────────────────────────────────
async function loadStats() {
  const res = await api('/api/admin/stats').catch(() => null);
  if (!res || !res.success) return;
  const s = res.stats;
  document.getElementById('stat-total').textContent     = s.total;
  document.getElementById('stat-today').textContent     = s.today;
  document.getElementById('stat-pending').textContent   = s.pending;
  document.getElementById('stat-customers').textContent = s.customers;
  document.getElementById('stat-zones').textContent     = s.zones;
}

// ──────────────────────────────────────────────
// Бронирования
// ──────────────────────────────────────────────
async function loadReservations() {
  const date   = document.getElementById('f-date').value;
  const status = document.getElementById('f-status').value;

  let params = '';
  if (date)   params += `date=${date}&`;
  if (status) params += `status=${status}&`;
  if (params) params = '?' + params.slice(0, -1);

  document.getElementById('res-tbody').innerHTML =
    '<tr><td colspan="9" class="table-empty">Загрузка…</td></tr>';

  const res = await api('/api/admin/reservations' + params).catch(() => null);

  if (!res || !res.success) {
    document.getElementById('res-tbody').innerHTML =
      '<tr><td colspan="9" class="table-empty">Ошибка загрузки</td></tr>';
    return;
  }

  if (!res.reservations.length) {
    document.getElementById('res-tbody').innerHTML =
      '<tr><td colspan="9" class="table-empty">Бронирований не найдено</td></tr>';
    return;
  }

  document.getElementById('res-tbody').innerHTML = res.reservations
    .map(r => {
      const badgeStyle = `background:${hexToRgba(r.badge_color,0.18)};color:${r.badge_color};border:1px solid ${hexToRgba(r.badge_color,0.4)};`;
      const dt = r.reservation_date ? r.reservation_date.split('T')[0] : '';
      const [y,m,d] = dt.split('-');
      const dateStr = `${d}.${m}.${y}`;

      return `<tr>
        <td>${r.reservation_id}</td>
        <td>${dateStr} ${r.reservation_time?.slice(0,5)}</td>
        <td>${esc(r.full_name)}</td>
        <td>${esc(r.phone)}</td>
        <td>№${r.table_number} · ${esc(r.zone_name)}</td>
        <td>${r.guests_count}</td>
        <td>${r.special_requests ? esc(r.special_requests) : '—'}</td>
        <td>
          <select class="status-select" data-id="${r.reservation_id}" onchange="changeStatus(this)">
            ${statusOptions(r.status_code)}
          </select>
        </td>
        <td>
          <button class="btn-delete" onclick="deleteRes(${r.reservation_id}, this)">Удалить</button>
        </td>
      </tr>`;
    }).join('');
}

function statusOptions(current) {
  const statuses = [
    { code: 'pending',   name: 'Ожидает' },
    { code: 'confirmed', name: 'Подтверждено' },
    { code: 'completed', name: 'Завершено' },
    { code: 'cancelled', name: 'Отменено' },
  ];
  return statuses.map(s =>
    `<option value="${s.code}" ${s.code === current ? 'selected' : ''}>${s.name}</option>`
  ).join('');
}

async function changeStatus(select) {
  const id     = select.dataset.id;
  const status = select.value;
  const res = await api(`/api/admin/reservations/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  }).catch(() => null);
  if (!res || !res.success) {
    alert('Ошибка обновления статуса');
    loadReservations();
  }
}

async function deleteRes(id, btn) {
  if (!confirm('Удалить это бронирование?')) return;
  btn.disabled = true;
  const res = await api(`/api/admin/reservations/${id}`, { method: 'DELETE' }).catch(() => null);
  if (res && res.success) {
    loadReservations();
    loadStats();
  } else {
    alert('Ошибка удаления');
    btn.disabled = false;
  }
}

// ──────────────────────────────────────────────
// Фильтры
// ──────────────────────────────────────────────
document.getElementById('btn-filter')?.addEventListener('click', loadReservations);

document.getElementById('btn-reset-filter')?.addEventListener('click', () => {
  document.getElementById('f-date').value   = '';
  document.getElementById('f-status').value = '';
  loadReservations();
});

// ──────────────────────────────────────────────
// Утилиты
// ──────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ──────────────────────────────────────────────
// Инициализация
// ──────────────────────────────────────────────
checkSession();
