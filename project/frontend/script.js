/**
 * script.js — клиентская логика главной страницы
 * API_URL берётся из config.js (подключается перед этим файлом)
 */

// Если config.js не задал API_URL — работаем на том же хосте (локальный режим)
if (typeof API_URL === 'undefined') { var API_URL = ''; }

// ──────────────────────────────────────────────
// Состояние
// ──────────────────────────────────────────────
let allTables    = [];
let selectedId   = null;

// ──────────────────────────────────────────────
// Вспомогательные функции
// ──────────────────────────────────────────────
function api(path, opts = {}) {
  return fetch(API_URL + path, {
    credentials: 'include',          // передавать cookies (нужно для сессий)
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  }).then(r => r.json());
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

// ──────────────────────────────────────────────
// Установить минимальную дату = сегодня
// ──────────────────────────────────────────────
const dateInput = document.getElementById('res-date');
if (dateInput) {
  const today = new Date().toISOString().split('T')[0];
  dateInput.min   = today;
  dateInput.value = today;
}

// ──────────────────────────────────────────────
// Загрузка и отрисовка схемы зала
// ──────────────────────────────────────────────
async function loadHall() {
  const date     = dateInput.value;
  const time     = document.getElementById('res-time').value;
  const duration = document.getElementById('res-duration').value;

  const loading = document.getElementById('hall-loading');
  loading.style.display = 'block';

  const params = date && time
    ? `?date=${date}&time=${time}&duration=${duration}`
    : '';

  const data = await api('/api/tables' + params).catch(() => null);
  loading.style.display = 'none';

  if (!data || !data.success) return;
  allTables = data.tables;
  renderHall();
}

function renderHall() {
  const hall = document.getElementById('hall');
  // Удалить старые столы (не зоны/разделители)
  hall.querySelectorAll('.table-item').forEach(el => el.remove());

  allTables.forEach(t => {
    const size   = t.seats_count <= 2 ? 48 : t.seats_count <= 4 ? 54 : t.seats_count <= 6 ? 60 : 68;
    const isRound = t.shape === 'round';
    const isBusy  = !t.available;
    const isSel   = t.table_id === selectedId;

    const el = document.createElement('div');
    el.className = [
      'table-item',
      isRound ? 'table-item--round' : 'table-item--rect',
      isSel ? 'table-item--selected' : isBusy ? 'table-item--busy' : 'table-item--free',
    ].join(' ');

    el.style.cssText = `
      left: calc(${t.pos_x}% - ${size / 2}px);
      top:  calc(${t.pos_y}% - ${size / 2}px);
      width: ${size}px; height: ${size}px;
    `;

    el.innerHTML = `
      <span class="t-num">${t.table_number}</span>
      <span class="t-cap">${t.seats_count}м</span>
      <div class="table-tooltip">
        №${t.table_number} · ${t.zone_name} · ${t.seats_count} мест
      </div>
    `;

    if (!isBusy) {
      el.addEventListener('click', () => selectTable(t.table_id));
    }

    hall.appendChild(el);
  });
}

function selectTable(id) {
  selectedId = id;
  renderHall();

  const t = allTables.find(x => x.table_id === id);
  if (!t) return;

  const form = document.getElementById('booking-form');
  form.style.display = 'block';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('selected-info').innerHTML = `
    Стол: <span>№${t.table_number}</span> &nbsp;
    Зона: <span>${t.zone_name}</span> &nbsp;
    Мест: <span>до ${t.seats_count}</span> &nbsp;
    Дата: <span>${formatDate(dateInput.value)}</span> &nbsp;
    Время: <span>${document.getElementById('res-time').value}</span>
  `;

  document.getElementById('form-msg').style.display = 'none';
}

// ──────────────────────────────────────────────
// Обновление зала при изменении параметров
// ──────────────────────────────────────────────
['res-date', 'res-time', 'res-duration'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => {
    selectedId = null;
    document.getElementById('booking-form').style.display = 'none';
    loadHall();
  });
});

// ──────────────────────────────────────────────
// Кнопка «Выбрать другой стол»
// ──────────────────────────────────────────────
document.getElementById('btn-cancel-table')?.addEventListener('click', () => {
  selectedId = null;
  renderHall();
  document.getElementById('booking-form').style.display = 'none';
});

// ──────────────────────────────────────────────
// Отправка формы бронирования
// ──────────────────────────────────────────────
document.getElementById('btn-submit')?.addEventListener('click', async () => {
  const msg = document.getElementById('form-msg');
  msg.style.display = 'none';

  if (!selectedId) {
    showMsg(msg, 'Выберите стол на схеме зала', 'error');
    return;
  }

  const body = {
    table_id        : selectedId,
    reservation_date: dateInput.value,
    reservation_time: document.getElementById('res-time').value,
    duration        : Number(document.getElementById('res-duration').value),
    guests_count    : Number(document.getElementById('res-guests').value),
    full_name       : document.getElementById('f-name').value.trim(),
    phone           : document.getElementById('f-phone').value.trim(),
    email           : document.getElementById('f-email').value.trim(),
    special_request : document.getElementById('f-request').value.trim(),
  };

  if (!body.full_name || !body.phone || !body.email || !body.reservation_date || !body.reservation_time) {
    showMsg(msg, 'Заполните все обязательные поля', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.textContent = 'Отправка…';

  const res = await api('/api/reservations', {
    method: 'POST',
    body: JSON.stringify(body),
  }).catch(() => null);

  btn.disabled = false;
  btn.textContent = 'Забронировать';

  if (!res) { showMsg(msg, 'Сетевая ошибка. Попробуйте позже.', 'error'); return; }

  if (res.success) {
    showMsg(msg, `✓ ${res.message} (№ брони: ${res.reservation_id})`, 'success');
    selectedId = null;
    loadHall();
    // Очистить форму
    ['f-name','f-phone','f-email','f-request'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  } else {
    showMsg(msg, res.message || 'Ошибка бронирования', 'error');
  }
});

function showMsg(el, text, type) {
  el.textContent = text;
  el.className = `form-msg form-msg--${type}`;
  el.style.display = 'block';
}

// ──────────────────────────────────────────────
// Инициализация
// ──────────────────────────────────────────────
loadHall();
