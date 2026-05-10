# La Maison — Frontend (Vercel)

Клиентская часть системы бронирования ресторана «La Maison».

## Структура файлов

```
frontend/
├── config.js     ← ⭐ ГЛАВНЫЙ ФАЙЛ: укажи URL бэкенда (Railway)
├── index.html    ← Публичная страница с формой и схемой зала
├── admin.html    ← Панель администратора
├── script.js     ← Логика главной страницы
├── admin.js      ← Логика панели администратора
├── style.css     ← Стили (тёмная тема + золото)
└── vercel.json   ← Конфигурация Vercel
```

## Деплой на Vercel

### 1. Узнай URL своего Railway бэкенда
Зайди на railway.app → твой проект → вкладка **Settings** → **Networking** → скопируй URL вида:
`https://la-maison-production.up.railway.app`

### 2. Отредактируй config.js
```js
// config.js — замени на свой Railway URL
const API_URL = 'https://la-maison-production.up.railway.app';
```

### 3. Задеплой на Vercel
- Зайди на [vercel.com](https://vercel.com) → **New Project**
- Загрузи папку `frontend/` через GitHub или перетащи файлы
- Vercel автоматически определит статический сайт
- Нажми **Deploy**

### 4. Скопируй URL Vercel → вставь в Railway
- После деплоя Vercel выдаст URL: `https://la-maison.vercel.app`
- Зайди в Railway → Variables → обнови `FRONTEND_URL=https://la-maison.vercel.app`

---

## Локальный запуск

Просто открой `index.html` через Live Server (VS Code) или любой HTTP-сервер.

При локальном запуске измени `config.js`:
```js
const API_URL = 'http://localhost:3000';
```

---

## Страницы

| URL           | Назначение                          |
|---------------|-------------------------------------|
| `/`           | Главная — форма бронирования + зал  |
| `/admin.html` | Панель администратора               |
