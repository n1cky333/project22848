# La Maison — Backend (Railway)

REST API для системы бронирования столов ресторана «La Maison».

## Деплой на Railway

### 1. Создай аккаунт и новый проект
- Зайди на [railway.app](https://railway.app) → New Project

### 2. Добавь MySQL базу данных
- В проекте: **+ New** → **Database** → **MySQL**
- Railway автоматически создаст переменные `MYSQLHOST`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`, `MYSQLPORT`

### 3. Задеплой бэкенд
- **+ New** → **GitHub Repo** → выбери репозиторий с папкой `backend/`
- Или: **+ New** → **Empty Service** → вкладка **Source** → загрузи папку

### 4. Переменные окружения (Variables)
Добавь в разделе **Variables** своего сервиса:

```
NODE_ENV=production
SESSION_SECRET=любая_длинная_случайная_строка_минимум_32_символа
FRONTEND_URL=https://твой-проект.vercel.app
```

> `MYSQL*` переменные Railway добавит сам при подключении БД.

### 5. Залей схему БД
В разделе **MySQL** → **Query** выполни содержимое файла `schema.sql`.

### 6. Проверь деплой
- Открой `https://твой-сервис.up.railway.app/health`
- Должен вернуть `{"ok":true}`

---

## Локальная разработка

```bash
cp .env.example .env
# заполни .env своими данными

npm install
mysql -u root -p < schema.sql
npm run dev
```

API будет доступен на `http://localhost:3000`.

---

## API маршруты

| Метод  | URL                                   | Описание                  |
|--------|---------------------------------------|---------------------------|
| GET    | /health                               | Проверка работы сервера   |
| GET    | /api/tables?date=&time=&duration=     | Список столов с занятостью|
| POST   | /api/reservations                     | Создать бронирование      |
| POST   | /api/admin/login                      | Войти (admin)             |
| POST   | /api/admin/logout                     | Выйти                     |
| GET    | /api/admin/check                      | Проверить сессию          |
| GET    | /api/admin/reservations               | Список броней             |
| PATCH  | /api/admin/reservations/:id/status    | Изменить статус           |
| DELETE | /api/admin/reservations/:id           | Удалить бронь             |
| GET    | /api/admin/stats                      | Статистика дашборда       |

---

## Учётные данные администратора (по умолчанию)

```
Логин:  admin
Пароль: admin123
```

⚠️ Смени пароль после первого входа!
