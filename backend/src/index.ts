import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { compare, hash } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { db } from "./db.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");
const jwtKey = new TextEncoder().encode(jwtSecret);

type Role = "admin" | "director" | "accountant" | "manager" | "storekeeper";
type AuthRequest = Request & { auth?: { userId: number; email: string; role: Role } };

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "enterprise-api" }));

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200)
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = db.prepare("SELECT id, email, name, password_hash, role FROM users WHERE email = ? AND active = 1")
      .get(email.trim()) as { id: number; email: string; name: string; password_hash: string; role: Role } | undefined;
    if (!user || !(await compare(password, user.password_hash))) {
      res.status(401).json({ error: "Неверный email или пароль" });
      return;
    }
    const token = await new SignJWT({ email: user.email, role: user.role })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(String(user.id))
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(jwtKey);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) { next(error); }
});

app.use("/api", async (req: AuthRequest, res, next) => {
  if (req.path === "/health" || req.path === "/auth/login") return next();
  const authorization = req.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Требуется авторизация" });
    return;
  }
  try {
    const { payload } = await jwtVerify(authorization.slice(7), jwtKey, { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.email !== "string" || typeof payload.role !== "string") throw new Error("Invalid claims");
    req.auth = { userId: Number(payload.sub), email: payload.email, role: payload.role as Role };
    next();
  } catch {
    res.status(401).json({ error: "Сессия недействительна или истекла" });
  }
});

app.get("/api/auth/me", (req: AuthRequest, res) => {
  res.json({ userId: req.auth?.userId, email: req.auth?.email, role: req.auth?.role });
});

function allowRoles(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      res.status(403).json({ error: "Недостаточно прав для этой операции" });
      return;
    }
    next();
  };
}

const createUserSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(200),
  role: z.enum(["admin", "director", "accountant", "manager", "storekeeper"])
});

const categorySchema = z.object({ name: z.string().trim().min(2).max(80) });
const productSchema = z.object({
  sku: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(80),
  unit: z.string().trim().min(1).max(16).default("шт."),
  purchase_price: z.number().finite().min(0),
  sale_price: z.number().finite().min(0),
  min_stock: z.number().int().min(0).default(0)
});
const warehouseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(2).max(240),
  responsible: z.string().trim().min(2).max(100)
});
const partnerSchema = z.object({
  type: z.enum(["client", "supplier"]),
  name: z.string().trim().min(2).max(160),
  inn: z.string().trim().max(12).optional().default(""),
  phone: z.string().trim().max(32).optional().default(""),
  email: z.union([z.string().email().max(254), z.literal("")]).optional().default("")
});

function handleWriteError(error: unknown, next: NextFunction, res: Response) {
  if (error instanceof Error && (error.message.includes("UNIQUE constraint failed") || error.message.includes("FOREIGN KEY constraint failed"))) {
    res.status(error.message.includes("UNIQUE") ? 409 : 409).json({ error: error.message.includes("UNIQUE") ? "Запись с таким значением уже существует" : "Запись используется в документах и не может быть удалена" });
    return;
  }
  next(error);
}

app.get("/api/categories", allowRoles("admin", "director", "manager", "storekeeper"), (_req, res) => {
  res.json(db.prepare("SELECT id, name FROM categories ORDER BY name").all());
});

app.post("/api/categories", allowRoles("admin", "director", "manager"), (req, res, next) => {
  try {
    const { name } = categorySchema.parse(req.body);
    const result = db.prepare("INSERT INTO categories (name) VALUES (?)").run(name);
    res.status(201).json({ id: Number(result.lastInsertRowid), name });
  } catch (error) { handleWriteError(error, next, res); }
});

app.patch("/api/categories/:id", allowRoles("admin", "director", "manager"), (req, res, next) => {
  try {
    const { name } = categorySchema.parse(req.body);
    const result = db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name, Number(req.params.id));
    if (!result.changes) { res.status(404).json({ error: "Категория не найдена" }); return; }
    res.json({ id: Number(req.params.id), name });
  } catch (error) { handleWriteError(error, next, res); }
});

app.delete("/api/categories/:id", allowRoles("admin"), (req, res) => {
  const result = db.prepare("DELETE FROM categories WHERE id = ?").run(Number(req.params.id));
  if (!result.changes) { res.status(404).json({ error: "Категория не найдена" }); return; }
  res.status(204).end();
});

app.get("/api/warehouses", allowRoles("admin", "director", "manager", "storekeeper"), (_req, res) => {
  res.json(db.prepare("SELECT id, name, address, responsible FROM warehouses ORDER BY name").all());
});

app.post("/api/warehouses", allowRoles("admin", "director", "storekeeper"), (req, res, next) => {
  try {
    const input = warehouseSchema.parse(req.body);
    const result = db.prepare("INSERT INTO warehouses (name, address, responsible) VALUES (?, ?, ?)").run(input.name, input.address, input.responsible);
    res.status(201).json({ id: Number(result.lastInsertRowid), ...input });
  } catch (error) { handleWriteError(error, next, res); }
});

app.patch("/api/warehouses/:id", allowRoles("admin", "director", "storekeeper"), (req, res, next) => {
  try {
    const input = warehouseSchema.parse(req.body);
    const result = db.prepare("UPDATE warehouses SET name = ?, address = ?, responsible = ? WHERE id = ?")
      .run(input.name, input.address, input.responsible, Number(req.params.id));
    if (!result.changes) { res.status(404).json({ error: "Склад не найден" }); return; }
    res.json({ id: Number(req.params.id), ...input });
  } catch (error) { handleWriteError(error, next, res); }
});

app.delete("/api/warehouses/:id", allowRoles("admin"), (req, res, next) => {
  try {
    const result = db.prepare("DELETE FROM warehouses WHERE id = ?").run(Number(req.params.id));
    if (!result.changes) { res.status(404).json({ error: "Склад не найден" }); return; }
    res.status(204).end();
  } catch (error) { handleWriteError(error, next, res); }
});

app.post("/api/products", allowRoles("admin", "director", "manager"), (req, res, next) => {
  try {
    const input = productSchema.parse(req.body);
    const category = db.prepare("SELECT id FROM categories WHERE name = ? COLLATE NOCASE").get(input.category);
    if (!category) { res.status(400).json({ error: "Сначала создайте категорию товара" }); return; }
    const result = db.prepare(`INSERT INTO products (sku, name, category, unit, purchase_price, sale_price, min_stock)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(input.sku, input.name, input.category, input.unit, input.purchase_price, input.sale_price, input.min_stock);
    res.status(201).json({ id: Number(result.lastInsertRowid), ...input, stock: 0, active: 1 });
  } catch (error) { handleWriteError(error, next, res); }
});

app.patch("/api/products/:id", allowRoles("admin", "director", "manager"), (req, res, next) => {
  try {
    const input = productSchema.partial().parse(req.body);
    if (!Object.keys(input).length) { res.status(400).json({ error: "Передайте хотя бы одно поле" }); return; }
    if (input.category && !db.prepare("SELECT id FROM categories WHERE name = ? COLLATE NOCASE").get(input.category)) {
      res.status(400).json({ error: "Категория не найдена" }); return;
    }
    const fields = Object.keys(input) as Array<keyof typeof input>;
    const result = db.prepare(`UPDATE products SET ${fields.map((field) => `${field} = ?`).join(", ")} WHERE id = ? AND active = 1`)
      .run(...fields.map((field) => input[field] ?? null), Number(req.params.id));
    if (!result.changes) { res.status(404).json({ error: "Товар не найден" }); return; }
    res.json(db.prepare("SELECT * FROM products WHERE id = ?").get(Number(req.params.id)));
  } catch (error) { handleWriteError(error, next, res); }
});

app.delete("/api/products/:id", allowRoles("admin", "director"), (req, res) => {
  const result = db.prepare("UPDATE products SET active = 0 WHERE id = ? AND active = 1").run(Number(req.params.id));
  if (!result.changes) { res.status(404).json({ error: "Товар не найден" }); return; }
  res.status(204).end();
});

app.post("/api/partners", allowRoles("admin", "director", "manager", "accountant"), (req, res, next) => {
  try {
    const input = partnerSchema.parse(req.body);
    const result = db.prepare("INSERT INTO partners (type, name, inn, phone, email) VALUES (?, ?, ?, ?, ?)")
      .run(input.type, input.name, input.inn, input.phone, input.email);
    res.status(201).json({ id: Number(result.lastInsertRowid), ...input });
  } catch (error) { handleWriteError(error, next, res); }
});

app.patch("/api/partners/:id", allowRoles("admin", "director", "manager", "accountant"), (req, res, next) => {
  try {
    const input = partnerSchema.parse(req.body);
    const result = db.prepare("UPDATE partners SET type = ?, name = ?, inn = ?, phone = ?, email = ? WHERE id = ?")
      .run(input.type, input.name, input.inn, input.phone, input.email, Number(req.params.id));
    if (!result.changes) { res.status(404).json({ error: "Контрагент не найден" }); return; }
    res.json({ id: Number(req.params.id), ...input });
  } catch (error) { handleWriteError(error, next, res); }
});

app.delete("/api/partners/:id", allowRoles("admin", "director"), (req, res, next) => {
  try {
    const result = db.prepare("DELETE FROM partners WHERE id = ?").run(Number(req.params.id));
    if (!result.changes) { res.status(404).json({ error: "Контрагент не найден" }); return; }
    res.status(204).end();
  } catch (error) { handleWriteError(error, next, res); }
});

app.post("/api/auth/users", allowRoles("admin"), async (req, res, next) => {
  try {
    const input = createUserSchema.parse(req.body);
    const passwordHash = await hash(input.password, 12);
    const result = db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)")
      .run(input.email.trim(), input.name, passwordHash, input.role);
    res.status(201).json({ id: Number(result.lastInsertRowid), email: input.email.trim(), name: input.name, role: input.role });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      res.status(409).json({ error: "Пользователь с таким email уже существует" });
      return;
    }
    next(error);
  }
});

app.get("/api/dashboard", allowRoles("admin", "director", "accountant", "manager"), (_req, res) => {
  const revenue = db.prepare("SELECT COALESCE(SUM(amount), 0) AS value FROM finance_operations WHERE type = 'income'").get() as { value: number };
  const expenses = db.prepare("SELECT COALESCE(SUM(amount), 0) AS value FROM finance_operations WHERE type = 'expense'").get() as { value: number };
  const stockValue = db.prepare(`
    SELECT COALESCE(SUM(s.quantity * p.purchase_price), 0) AS value
    FROM stock s JOIN products p ON p.id = s.product_id
  `).get() as { value: number };
  const lowStock = db.prepare(`
    SELECT COUNT(*) AS value FROM (
      SELECT p.id FROM products p LEFT JOIN stock s ON s.product_id = p.id
      GROUP BY p.id HAVING COALESCE(SUM(s.quantity), 0) <= p.min_stock
    )
  `).get() as { value: number };

  res.json({
    metrics: {
      revenue: revenue.value,
      profit: revenue.value - expenses.value,
      stockValue: stockValue.value,
      lowStock: lowStock.value
    },
    salesByDay: [
      { day: "14 ноя", value: 84000 }, { day: "15 ноя", value: 121000 },
      { day: "16 ноя", value: 97000 }, { day: "17 ноя", value: 158000 },
      { day: "18 ноя", value: 149980 }, { day: "19 ноя", value: 178430 },
      { day: "20 ноя", value: 132600 }
    ]
  });
});

app.get("/api/products", allowRoles("admin", "director", "manager", "storekeeper"), (_req, res) => {
  const rows = db.prepare(`
    SELECT p.*, COALESCE(SUM(s.quantity), 0) AS stock
    FROM products p LEFT JOIN stock s ON s.product_id = p.id
    WHERE p.active = 1
    GROUP BY p.id ORDER BY p.name
  `).all();
  res.json(rows);
});

app.get("/api/stock", allowRoles("admin", "director", "manager", "storekeeper"), (_req, res) => {
  const rows = db.prepare(`
    SELECT s.product_id AS productId, p.sku, p.name, p.category,
           s.warehouse_id AS warehouseId, w.name AS warehouse,
           s.quantity, p.min_stock AS minStock, p.purchase_price AS purchasePrice
    FROM stock s
    JOIN products p ON p.id = s.product_id
    JOIN warehouses w ON w.id = s.warehouse_id
    ORDER BY p.name, w.name
  `).all();
  res.json(rows);
});

app.get("/api/partners", allowRoles("admin", "director", "manager", "accountant"), (req, res) => {
  const type = req.query.type;
  const rows = type === "client" || type === "supplier"
    ? db.prepare("SELECT * FROM partners WHERE type = ? ORDER BY name").all(type)
    : db.prepare("SELECT * FROM partners ORDER BY name").all();
  res.json(rows);
});

app.get("/api/movements", allowRoles("admin", "director", "manager", "storekeeper"), (_req, res) => {
  const rows = db.prepare(`
    SELECT m.id, m.type, p.name AS product, w.name AS warehouse,
           m.quantity, m.document, m.created_at AS createdAt
    FROM movements m
    JOIN products p ON p.id = m.product_id
    JOIN warehouses w ON w.id = m.warehouse_id
    ORDER BY m.created_at DESC LIMIT 50
  `).all();
  res.json(rows);
});

app.get("/api/finances", allowRoles("admin", "director", "accountant"), (_req, res) => {
  const rows = db.prepare(`
    SELECT id, type, category, amount, description, document, created_at AS createdAt
    FROM finance_operations ORDER BY created_at DESC LIMIT 50
  `).all();
  res.json(rows);
});

const saleSchema = z.object({
  clientId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().positive(),
    discount: z.number().min(0).max(100).default(0)
  })).min(1)
});

app.post("/api/sales", allowRoles("admin", "director", "manager"), (req, res, next) => {
  try {
    const input = saleSchema.parse(req.body);
    const number = `РН-${String(Date.now()).slice(-6)}`;
    let total = 0;
    const prepared = input.items.map((item) => {
      const product = db.prepare("SELECT id, name, sale_price AS price FROM products WHERE id = ? AND active = 1").get(item.productId) as { id: number; name: string; price: number } | undefined;
      if (!product) throw new Error(`Товар #${item.productId} не найден`);
      const balance = db.prepare("SELECT quantity FROM stock WHERE product_id = ? AND warehouse_id = ?").get(item.productId, input.warehouseId) as { quantity: number } | undefined;
      if (!balance || balance.quantity < item.quantity) {
        throw new Error(`Недостаточно товара «${product.name}»: доступно ${balance?.quantity ?? 0}`);
      }
      total += product.price * item.quantity * (1 - item.discount / 100);
      return { ...item, price: product.price };
    });

    db.exec("BEGIN IMMEDIATE");
    try {
      const sale = db.prepare("INSERT INTO sales (number, client_id, warehouse_id, total) VALUES (?, ?, ?, ?)").run(number, input.clientId, input.warehouseId, total);
      const saleId = Number(sale.lastInsertRowid);
      const addItem = db.prepare("INSERT INTO sale_items (sale_id, product_id, quantity, price, discount) VALUES (?, ?, ?, ?, ?)");
      const reduceStock = db.prepare("UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND warehouse_id = ?");
      const movement = db.prepare("INSERT INTO movements (type, product_id, warehouse_id, quantity, document) VALUES ('sale', ?, ?, ?, ?)");
      for (const item of prepared) {
        addItem.run(saleId, item.productId, item.quantity, item.price, item.discount);
        reduceStock.run(item.quantity, item.productId, input.warehouseId);
        movement.run(item.productId, input.warehouseId, -item.quantity, number);
      }
      db.prepare("INSERT INTO finance_operations (type, category, amount, description, document) VALUES ('income', 'Продажи', ?, 'Оплата по реализации', ?)").run(total, number);
      db.exec("COMMIT");
      res.status(201).json({ id: saleId, number, total });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof z.ZodError
    ? "Некорректные данные документа"
    : error instanceof Error ? error.message : "Внутренняя ошибка сервера";
  res.status(error instanceof z.ZodError ? 400 : 422).json({ error: message });
});

app.listen(port, () => {
  console.log(`Enterprise API: http://localhost:${port}/api`);
});
