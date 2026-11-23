import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hash } from "bcryptjs";

const dbPath = resolve(process.cwd(), process.env.DATABASE_PATH ?? "data/enterprise.db");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'director', 'accountant', 'manager', 'storekeeper')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'шт.',
    purchase_price REAL NOT NULL CHECK (purchase_price >= 0),
    sale_price REAL NOT NULL CHECK (sale_price >= 0),
    min_stock INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS warehouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    responsible TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock (
    product_id INTEGER NOT NULL REFERENCES products(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    PRIMARY KEY (product_id, warehouse_id)
  );

  CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('client', 'supplier')),
    name TEXT NOT NULL,
    inn TEXT,
    phone TEXT,
    email TEXT
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    client_id INTEGER REFERENCES partners(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    status TEXT NOT NULL DEFAULT 'completed',
    total REAL NOT NULL CHECK(total >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    price REAL NOT NULL CHECK(price >= 0),
    discount REAL NOT NULL DEFAULT 0 CHECK(discount >= 0 AND discount <= 100)
  );

  CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('receipt', 'sale', 'transfer', 'inventory')),
    product_id INTEGER NOT NULL REFERENCES products(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    quantity INTEGER NOT NULL,
    document TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS finance_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
    category TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    description TEXT NOT NULL,
    document TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  INSERT OR IGNORE INTO categories (name)
  SELECT DISTINCT category FROM products WHERE TRIM(category) <> '';
`);

const bootstrapEmail = process.env.ADMIN_EMAIL?.trim();
const bootstrapPassword = process.env.ADMIN_PASSWORD;
if (bootstrapEmail && bootstrapPassword && bootstrapPassword.length >= 12) {
  const existingAdmin = db.prepare("SELECT id FROM users WHERE email = ?").get(bootstrapEmail);
  if (!existingAdmin) {
    const passwordHash = await hash(bootstrapPassword, 12);
    db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'admin')")
      .run(bootstrapEmail, "Администратор", passwordHash);
  }
}

const productsCount = db.prepare("SELECT COUNT(*) AS count FROM products").get() as { count: number };

if (productsCount.count === 0) {
  db.exec("BEGIN");
  try {
    const product = db.prepare(`
      INSERT INTO products (sku, name, category, purchase_price, sale_price, min_stock)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const products = [
      ["NB-001", "Ноутбук ProBook 15", "Электроника", 58900, 74990, 5],
      ["MN-024", "Монитор 24″ IPS", "Электроника", 13200, 17990, 8],
      ["KB-105", "Клавиатура беспроводная", "Аксессуары", 2100, 3490, 12],
      ["MS-208", "Мышь эргономичная", "Аксессуары", 1450, 2490, 15],
      ["DS-500", "Док-станция USB-C", "Аксессуары", 6200, 8990, 6],
      ["CH-410", "Офисное кресло Flex", "Мебель", 11800, 16900, 4]
    ];
    for (const row of products) product.run(...row);

    const warehouse = db.prepare("INSERT INTO warehouses (name, address, responsible) VALUES (?, ?, ?)");
    warehouse.run("Основной склад", "г. Самара, ул. Заводская, 12", "Алексей Воронов");
    warehouse.run("Розничный склад", "г. Самара, ул. Молодогвардейская, 83", "Ирина Белова");

    const partner = db.prepare("INSERT INTO partners (type, name, inn, phone, email) VALUES (?, ?, ?, ?, ?)");
    partner.run("client", "ООО «Вектор»", "6318123456", "+7 846 200-11-22", "office@vector.demo");
    partner.run("client", "ИП Соколова", "631900123456", "+7 927 700-44-18", "sokolova@demo.ru");
    partner.run("supplier", "ООО «ТехПоставка»", "7728123401", "+7 495 111-42-00", "sales@tech.demo");

    const stock = db.prepare("INSERT INTO stock (product_id, warehouse_id, quantity) VALUES (?, ?, ?)");
    const quantities = [[1,1,18],[1,2,4],[2,1,31],[2,2,7],[3,1,44],[3,2,12],[4,1,53],[4,2,18],[5,1,11],[5,2,3],[6,1,8],[6,2,2]];
    for (const row of quantities) stock.run(...row);

    const movement = db.prepare("INSERT INTO movements (type, product_id, warehouse_id, quantity, document, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    movement.run("receipt", 1, 1, 10, "Поступление ПТ-00018", "2026-11-18 09:30:00");
    movement.run("sale", 2, 1, -2, "Реализация РН-00124", "2026-11-19 13:15:00");
    movement.run("transfer", 3, 2, 6, "Перемещение ПМ-00042", "2026-11-20 10:05:00");

    const finance = db.prepare("INSERT INTO finance_operations (type, category, amount, description, document, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    finance.run("income", "Продажи", 149980, "Оплата от ООО «Вектор»", "ПП-00421", "2026-11-18 14:20:00");
    finance.run("income", "Продажи", 28450, "Розничная выручка", "КМ-00182", "2026-11-19 19:00:00");
    finance.run("expense", "Логистика", 12600, "Доставка партии товара", "РС-00091", "2026-11-20 11:40:00");

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
