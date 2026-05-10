-- ================================================================
--  La Maison — схема базы данных (3НФ, 7 таблиц)
--  MySQL 8+  |  utf8mb4
-- ================================================================

CREATE DATABASE IF NOT EXISTS restaurant_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE restaurant_db;

-- ----------------------------------------------------------------
--  1. table_zones — зоны / залы ресторана
--     Выделена отдельно по 3НФ: название зоны функционально
--     зависит только от zone_id, а не от стола.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS table_zones (
  zone_id     INT          AUTO_INCREMENT PRIMARY KEY,
  zone_name   VARCHAR(100) NOT NULL,
  description VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------
--  2. tables — столы
--     zone_id FK → table_zones устраняет транзитивную зависимость:
--     table → zone_name (теперь table → zone_id → zone_name).
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tables` (
  table_id     INT         AUTO_INCREMENT PRIMARY KEY,
  table_number INT         NOT NULL UNIQUE,
  seats_count  INT         NOT NULL,
  zone_id      INT         NOT NULL,
  pos_x        INT         NOT NULL DEFAULT 0,
  pos_y        INT         NOT NULL DEFAULT 0,
  shape        ENUM('round','rect') DEFAULT 'round',
  CONSTRAINT fk_table_zone FOREIGN KEY (zone_id)
    REFERENCES table_zones(zone_id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------
--  3. customers — клиенты
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  customer_id INT          AUTO_INCREMENT PRIMARY KEY,
  full_name   VARCHAR(150) NOT NULL,
  phone       VARCHAR(30)  NOT NULL,
  email       VARCHAR(150) NOT NULL UNIQUE,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------
--  4. reservation_statuses — справочник статусов (словарная таблица)
--     Нормализация: убираем ENUM из reservations; теперь
--     status_name и badge_color зависят только от status_id,
--     без транзитивных зависимостей в таблице броней.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservation_statuses (
  status_id   INT         AUTO_INCREMENT PRIMARY KEY,
  status_code VARCHAR(20) NOT NULL UNIQUE,
  status_name VARCHAR(60) NOT NULL,
  badge_color VARCHAR(20) NOT NULL DEFAULT '#ffffff'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------
--  5. reservations — бронирования
--     status_id FK → reservation_statuses (вместо ENUM-строки)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations (
  reservation_id   INT  AUTO_INCREMENT PRIMARY KEY,
  customer_id      INT  NOT NULL,
  table_id         INT  NOT NULL,
  status_id        INT  NOT NULL,
  reservation_date DATE NOT NULL,
  reservation_time TIME NOT NULL,
  guests_count     INT  NOT NULL,
  duration         INT  NOT NULL DEFAULT 120,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_res_customer FOREIGN KEY (customer_id)
    REFERENCES customers(customer_id) ON DELETE CASCADE,
  CONSTRAINT fk_res_table FOREIGN KEY (table_id)
    REFERENCES `tables`(table_id) ON DELETE CASCADE,
  CONSTRAINT fk_res_status FOREIGN KEY (status_id)
    REFERENCES reservation_statuses(status_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------
--  6. special_requests — особые пожелания к брони
--     Многозначная зависимость: у одной брони может быть несколько
--     пожеланий — выносим в отдельную таблицу (требование 1НФ→3НФ).
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS special_requests (
  request_id     INT  AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT  NOT NULL,
  request_text   TEXT NOT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sr_reservation FOREIGN KEY (reservation_id)
    REFERENCES reservations(reservation_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------
--  7. admins — администраторы
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  admin_id   INT          AUTO_INCREMENT PRIMARY KEY,
  login      VARCHAR(80)  NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ================================================================
--  Начальные данные
-- ================================================================

-- Зоны зала
INSERT INTO table_zones (zone_name, description) VALUES
  ('Основной зал',  'Центральная зона ресторана'),
  ('Терраса',       'Открытая зона у окон'),
  ('VIP-зал',       'Приватная зона для особых гостей');

-- Столы (12 шт.)
INSERT INTO `tables` (table_number, seats_count, zone_id, pos_x, pos_y, shape) VALUES
  ( 1, 2, 1,  9, 14, 'round'),
  ( 2, 2, 1, 25, 14, 'round'),
  ( 3, 4, 1, 42, 11, 'rect'),
  ( 4, 4, 1, 62, 11, 'rect'),
  ( 5, 6, 2, 81, 14, 'round'),
  ( 6, 2, 1,  9, 50, 'round'),
  ( 7, 4, 1, 27, 48, 'rect'),
  ( 8, 8, 3, 48, 45, 'rect'),
  ( 9, 4, 1, 72, 48, 'rect'),
  (10, 2, 2, 89, 50, 'round'),
  (11, 4, 1, 18, 79, 'round'),
  (12, 6, 3, 56, 78, 'round');

-- Статусы бронирований
INSERT INTO reservation_statuses (status_code, status_name, badge_color) VALUES
  ('pending',   'Ожидает',      '#ff9f0a'),
  ('confirmed', 'Подтверждено', '#34c759'),
  ('cancelled', 'Отменено',     '#ff3b30'),
  ('completed', 'Завершено',    '#0a84ff');

-- ⚠️  Администратор создаётся автоматически сервером при первом запуске.
--     Логин: admin  |  Пароль: admin123
--     Хэш генерируется через bcrypt в server.js (функция seedAdmin)
