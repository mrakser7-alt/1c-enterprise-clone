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

const isCalendarDate = (value?: string) => !value || (
  !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
  new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
);

const reportsPeriodSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
}).refine(({ from, to }) => isCalendarDate(from) && isCalendarDate(to) && (!from || !to || from <= to), {
  message: "Укажите существующие даты, начало периода не может быть позже его окончания"
});

app.get("/api/reports", allowRoles("admin", "director", "accountant", "manager"), (req, res) => {
  const parsedPeriod = reportsPeriodSchema.safeParse(req.query);
  if (!parsedPeriod.success) {
    res.status(400).json({ error: "Укажите корректный период в формате ГГГГ-ММ-ДД" });
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const from = parsedPeriod.data.from ?? `${today.slice(0, 7)}-01`;
  const to = parsedPeriod.data.to ?? today;

  const summary = db.prepare(`SELECT COUNT(*) AS salesCount,
      COALESCE(SUM(s.total), 0) AS revenue,
      COALESCE(SUM(s.paid_amount), 0) AS received,
      COALESCE(SUM(MAX(s.total - s.paid_amount, 0)), 0) AS debt
    FROM sales s WHERE s.status = 'completed' AND date(s.created_at) BETWEEN date(?) AND date(?)`)
    .get(from, to) as { salesCount: number; revenue: number; received: number; debt: number };

  const revenueByDay = db.prepare(`SELECT date(s.created_at) AS day,
      ROUND(SUM(s.total), 2) AS revenue, ROUND(SUM(s.paid_amount), 2) AS received,
      COUNT(*) AS salesCount
    FROM sales s WHERE s.status = 'completed' AND date(s.created_at) BETWEEN date(?) AND date(?)
    GROUP BY date(s.created_at) ORDER BY day`)
    .all(from, to) as Array<{ day: string; revenue: number; received: number; salesCount: number }>;

  const stock = db.prepare(`SELECT p.id AS productId, p.sku, p.name, p.category,
      s.warehouse_id AS warehouseId, w.name AS warehouse, COALESCE(s.quantity, 0) AS quantity,
      p.min_stock AS minStock, p.purchase_price AS purchasePrice,
      COALESCE(total.totalQuantity, 0) AS totalQuantity,
      COALESCE(total.totalQuantity, 0) <= p.min_stock AS lowStock
    FROM products p CROSS JOIN warehouses w
    LEFT JOIN stock s ON s.product_id = p.id AND s.warehouse_id = w.id
    LEFT JOIN (SELECT product_id, SUM(quantity) AS totalQuantity FROM stock GROUP BY product_id) total
      ON total.product_id = p.id
    WHERE p.active = 1 ORDER BY p.name, w.name`).all() as Array<{
      productId: number; sku: string; name: string; category: string; warehouseId: number;
      warehouse: string; quantity: number; minStock: number; purchasePrice: number;
      totalQuantity: number; lowStock: number;
    }>;

  const stockSummary = db.prepare(`SELECT COALESCE(SUM(s.quantity), 0) AS units,
      ROUND(COALESCE(SUM(s.quantity * p.purchase_price), 0), 2) AS purchaseValue,
      COUNT(DISTINCT CASE WHEN COALESCE(totals.totalQuantity, 0) <= p.min_stock THEN p.id END) AS lowStockCount,
      COUNT(DISTINCT p.id) AS productCount
    FROM products p LEFT JOIN stock s ON s.product_id = p.id
    LEFT JOIN (SELECT product_id, SUM(quantity) AS totalQuantity FROM stock GROUP BY product_id) totals
      ON totals.product_id = p.id WHERE p.active = 1`).get() as {
        units: number; purchaseValue: number; lowStockCount: number; productCount: number;
      };

  const stockByWarehouse = db.prepare(`SELECT w.id AS warehouseId, w.name AS warehouse,
      COUNT(DISTINCT p.id) AS productCount, COALESCE(SUM(s.quantity), 0) AS units,
      ROUND(COALESCE(SUM(s.quantity * p.purchase_price), 0), 2) AS purchaseValue
    FROM warehouses w LEFT JOIN stock s ON s.warehouse_id = w.id
    LEFT JOIN products p ON p.id = s.product_id AND p.active = 1
    GROUP BY w.id ORDER BY w.name`).all();

  const popularProducts = db.prepare(`SELECT p.id AS productId, p.sku, p.name,
      SUM(si.quantity) AS quantitySold,
      ROUND(SUM(si.quantity * si.price * (1 - si.discount / 100.0)), 2) AS revenue,
      COUNT(DISTINCT si.sale_id) AS salesCount
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    JOIN products p ON p.id = si.product_id
    WHERE s.status = 'completed' AND date(s.created_at) BETWEEN date(?) AND date(?)
    GROUP BY p.id ORDER BY quantitySold DESC, revenue DESC, p.name LIMIT 10`)
    .all(from, to);

  res.json({
    period: { from, to },
    summary: {
      salesCount: summary.salesCount,
      revenue: summary.revenue,
      received: summary.received,
      debt: summary.debt,
      averageCheck: summary.salesCount ? Math.round((summary.revenue / summary.salesCount) * 100) / 100 : 0
    },
    revenueByDay,
    stockSummary,
    stockByWarehouse,
    stock,
    popularProducts
  });
});

app.get("/api/products", allowRoles("admin", "director", "accountant", "manager", "storekeeper"), (_req, res) => {
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

app.get("/api/movements", allowRoles("admin", "director", "manager", "storekeeper"), (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (["receipt", "sale", "transfer", "inventory"].includes(String(req.query.type))) {
    conditions.push("m.type = ?"); params.push(String(req.query.type));
  }
  for (const field of ["productId", "warehouseId"] as const) {
    if (req.query[field] !== undefined) {
      const id = Number(req.query[field]);
      if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: `Некорректный параметр ${field}` }); return; }
      conditions.push(field === "productId" ? "m.product_id = ?" : "m.warehouse_id = ?"); params.push(id);
    }
  }
  for (const field of ["from", "to"] as const) {
    if (req.query[field] !== undefined) {
      const day = String(req.query[field]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
        res.status(400).json({ error: `Параметр ${field} должен иметь формат ГГГГ-ММ-ДД` }); return;
      }
      conditions.push(field === "from" ? "date(m.created_at) >= date(?)" : "date(m.created_at) <= date(?)"); params.push(day);
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.prepare(`SELECT COUNT(*) AS count FROM movements m ${where}`).get(...params) as { count: number };
  const rows = db.prepare(`
    SELECT m.id, m.type, p.name AS product, w.name AS warehouse,
           m.quantity, m.document, m.created_at AS createdAt
    FROM movements m
    JOIN products p ON p.id = m.product_id
    JOIN warehouses w ON w.id = m.warehouse_id
    ${where} ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  res.json({ items: rows, total: total.count, limit, offset });
});

const stockDocumentItemsSchema = z.array(z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(1_000_000)
})).min(1).max(200);

const transferSchema = z.object({
  sourceWarehouseId: z.number().int().positive(),
  destinationWarehouseId: z.number().int().positive(),
  items: stockDocumentItemsSchema
}).refine((input) => input.sourceWarehouseId !== input.destinationWarehouseId, {
  message: "Склады отправления и назначения должны различаться"
});

app.get("/api/transfers", allowRoles("admin", "director", "manager", "storekeeper"), (_req, res) => {
  const rows = db.prepare(`SELECT t.id, t.number, t.source_warehouse_id AS sourceWarehouseId,
      source.name AS sourceWarehouse, t.destination_warehouse_id AS destinationWarehouseId,
      destination.name AS destinationWarehouse, t.status, t.created_at AS createdAt,
      i.product_id AS productId, p.name AS product, i.quantity
    FROM stock_transfers t
    JOIN warehouses source ON source.id = t.source_warehouse_id
    JOIN warehouses destination ON destination.id = t.destination_warehouse_id
    JOIN stock_transfer_items i ON i.transfer_id = t.id
    JOIN products p ON p.id = i.product_id
    ORDER BY t.created_at DESC, t.id DESC`).all() as Array<Record<string, unknown> & { id: number }>;
  const grouped = new Map<number, Record<string, unknown> & { items: Array<Record<string, unknown>> }>();
  for (const row of rows) {
    let transfer = grouped.get(row.id);
    if (!transfer) {
      transfer = { id: row.id, number: row.number, sourceWarehouseId: row.sourceWarehouseId,
        sourceWarehouse: row.sourceWarehouse, destinationWarehouseId: row.destinationWarehouseId,
        destinationWarehouse: row.destinationWarehouse, status: row.status, createdAt: row.createdAt, items: [] };
      grouped.set(row.id, transfer);
    }
    transfer.items.push({ productId: row.productId, product: row.product, quantity: row.quantity });
  }
  res.json([...grouped.values()]);
});

app.post("/api/transfers", allowRoles("admin", "director", "storekeeper"), (req, res, next) => {
  try {
    const input = transferSchema.parse(req.body);
    if (new Set(input.items.map((item) => item.productId)).size !== input.items.length) {
      res.status(400).json({ error: "Товар в перемещении указан более одного раза" }); return;
    }
    const source = db.prepare("SELECT id FROM warehouses WHERE id = ?").get(input.sourceWarehouseId);
    const destination = db.prepare("SELECT id FROM warehouses WHERE id = ?").get(input.destinationWarehouseId);
    if (!source || !destination) { res.status(400).json({ error: "Укажите существующие склады" }); return; }
    const items = input.items.map((item) => {
      const product = db.prepare("SELECT id, name FROM products WHERE id = ? AND active = 1").get(item.productId) as { id: number; name: string } | undefined;
      if (!product) throw new Error(`Товар #${item.productId} не найден или архивирован`);
      return { ...item, product: product.name };
    });
    const number = `ПМ-${String(Date.now()).slice(-8)}`;
    db.exec("BEGIN IMMEDIATE");
    try {
      const transfer = db.prepare("INSERT INTO stock_transfers (number, source_warehouse_id, destination_warehouse_id) VALUES (?, ?, ?)")
        .run(number, input.sourceWarehouseId, input.destinationWarehouseId);
      const transferId = Number(transfer.lastInsertRowid);
      const sourceBalance = db.prepare("SELECT quantity FROM stock WHERE product_id = ? AND warehouse_id = ?");
      for (const item of items) {
        const balance = sourceBalance.get(item.productId, input.sourceWarehouseId) as { quantity: number } | undefined;
        if (!balance || balance.quantity < item.quantity) throw new Error(`Недостаточно товара «${item.product}» на складе отправления: доступно ${balance?.quantity ?? 0}`);
      }
      const insertItem = db.prepare("INSERT INTO stock_transfer_items (transfer_id, product_id, quantity) VALUES (?, ?, ?)");
      const reduce = db.prepare("UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND warehouse_id = ? AND quantity >= ?");
      const add = db.prepare(`INSERT INTO stock (product_id, warehouse_id, quantity) VALUES (?, ?, ?)
        ON CONFLICT(product_id, warehouse_id) DO UPDATE SET quantity = quantity + excluded.quantity`);
      const movement = db.prepare("INSERT INTO movements (type, product_id, warehouse_id, quantity, document) VALUES ('transfer', ?, ?, ?, ?)");
      for (const item of items) {
        insertItem.run(transferId, item.productId, item.quantity);
        const reduced = reduce.run(item.quantity, item.productId, input.sourceWarehouseId, item.quantity);
        if (!reduced.changes) throw new Error(`Остаток товара «${item.product}» изменился, повторите перемещение`);
        add.run(item.productId, input.destinationWarehouseId, item.quantity);
        movement.run(item.productId, input.sourceWarehouseId, -item.quantity, number);
        movement.run(item.productId, input.destinationWarehouseId, item.quantity, number);
      }
      db.exec("COMMIT");
      res.status(201).json({ id: transferId, number, sourceWarehouseId: input.sourceWarehouseId,
        destinationWarehouseId: input.destinationWarehouseId, status: "completed", items });
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Товар #")) { res.status(400).json({ error: error.message }); return; }
    if (error instanceof Error && error.message.startsWith("Недостаточно товара")) { res.status(409).json({ error: error.message }); return; }
    handleWriteError(error, next, res);
  }
});

const inventoryCountSchema = z.object({
  warehouseId: z.number().int().positive(),
  items: z.array(z.object({ productId: z.number().int().positive(), countedQuantity: z.number().int().min(0).max(1_000_000) })).min(1).max(500)
});

app.get("/api/inventory-counts", allowRoles("admin", "director", "manager", "storekeeper"), (_req, res) => {
  const rows = db.prepare(`SELECT c.id, c.number, c.warehouse_id AS warehouseId, w.name AS warehouse,
      c.status, c.created_at AS createdAt, i.product_id AS productId, p.name AS product,
      i.expected_quantity AS expectedQuantity, i.counted_quantity AS countedQuantity, i.difference
    FROM inventory_counts c JOIN warehouses w ON w.id = c.warehouse_id
    JOIN inventory_count_items i ON i.inventory_count_id = c.id JOIN products p ON p.id = i.product_id
    ORDER BY c.created_at DESC, c.id DESC`).all() as Array<Record<string, unknown> & { id: number }>;
  const grouped = new Map<number, Record<string, unknown> & { items: Array<Record<string, unknown>> }>();
  for (const row of rows) {
    let count = grouped.get(row.id);
    if (!count) {
      count = { id: row.id, number: row.number, warehouseId: row.warehouseId, warehouse: row.warehouse,
        status: row.status, createdAt: row.createdAt, items: [] };
      grouped.set(row.id, count);
    }
    count.items.push({ productId: row.productId, product: row.product, expectedQuantity: row.expectedQuantity,
      countedQuantity: row.countedQuantity, difference: row.difference });
  }
  res.json([...grouped.values()]);
});

app.post("/api/inventory-counts", allowRoles("admin", "director", "storekeeper"), (req, res, next) => {
  try {
    const input = inventoryCountSchema.parse(req.body);
    if (!db.prepare("SELECT id FROM warehouses WHERE id = ?").get(input.warehouseId)) {
      res.status(400).json({ error: "Склад не найден" }); return;
    }
    if (new Set(input.items.map((item) => item.productId)).size !== input.items.length) {
      res.status(400).json({ error: "Товар в инвентаризации указан более одного раза" }); return;
    }
    const prepared = input.items.map((item) => {
      const product = db.prepare("SELECT id, name FROM products WHERE id = ? AND active = 1").get(item.productId) as { id: number; name: string } | undefined;
      if (!product) throw new Error(`Товар #${item.productId} не найден или архивирован`);
      return { ...item, name: product.name };
    });
    const number = `ИНВ-${String(Date.now()).slice(-8)}`;
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db.prepare("INSERT INTO inventory_counts (number, warehouse_id) VALUES (?, ?)").run(number, input.warehouseId);
      const countId = Number(result.lastInsertRowid);
      const balanceQuery = db.prepare("SELECT quantity FROM stock WHERE product_id = ? AND warehouse_id = ?");
      const insertItem = db.prepare(`INSERT INTO inventory_count_items
        (inventory_count_id, product_id, expected_quantity, counted_quantity, difference) VALUES (?, ?, ?, ?, ?)`);
      const setStock = db.prepare(`INSERT INTO stock (product_id, warehouse_id, quantity) VALUES (?, ?, ?)
        ON CONFLICT(product_id, warehouse_id) DO UPDATE SET quantity = excluded.quantity`);
      const movement = db.prepare("INSERT INTO movements (type, product_id, warehouse_id, quantity, document) VALUES ('inventory', ?, ?, ?, ?)");
      const resultItems = prepared.map((item) => {
        const row = balanceQuery.get(item.productId, input.warehouseId) as { quantity: number } | undefined;
        const expectedQuantity = row?.quantity ?? 0;
        const difference = item.countedQuantity - expectedQuantity;
        insertItem.run(countId, item.productId, expectedQuantity, item.countedQuantity, difference);
        setStock.run(item.productId, input.warehouseId, item.countedQuantity);
        if (difference !== 0) movement.run(item.productId, input.warehouseId, difference, number);
        return { productId: item.productId, product: item.name, expectedQuantity, countedQuantity: item.countedQuantity, difference };
      });
      db.exec("COMMIT");
      res.status(201).json({ id: countId, number, warehouseId: input.warehouseId, status: "completed", items: resultItems });
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Товар #")) { res.status(400).json({ error: error.message }); return; }
    handleWriteError(error, next, res);
  }
});

app.get("/api/finances", allowRoles("admin", "director", "accountant"), (_req, res) => {
  const rows = db.prepare(`
    SELECT id, type, category, amount, description, document, created_at AS createdAt
    FROM finance_operations ORDER BY created_at DESC LIMIT 50
  `).all();
  res.json(rows);
});

const purchaseSchema = z.object({
  supplierId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().positive().max(1_000_000),
    price: z.number().finite().min(0)
  })).min(1).max(200)
});

app.get("/api/purchases", allowRoles("admin", "director", "manager", "accountant", "storekeeper"), (_req, res) => {
  const purchases = db.prepare(`
    SELECT p.id, p.number, p.supplier_id AS supplierId, partner.name AS supplier,
           p.warehouse_id AS warehouseId, w.name AS warehouse, p.status, p.total,
           p.created_at AS createdAt, p.received_at AS receivedAt
    FROM purchases p
    JOIN partners partner ON partner.id = p.supplier_id
    JOIN warehouses w ON w.id = p.warehouse_id
    ORDER BY p.created_at DESC
  `).all() as Array<Record<string, unknown> & { id: number }>;
  const items = db.prepare(`
    SELECT pi.product_id AS productId, pr.name AS product, pi.quantity, pi.price
    FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id
    WHERE pi.purchase_id = ? ORDER BY pi.id
  `);
  res.json(purchases.map((purchase) => ({ ...purchase, items: items.all(purchase.id) })));
});

app.post("/api/purchases", allowRoles("admin", "director", "manager", "accountant"), (req, res, next) => {
  try {
    const input = purchaseSchema.parse(req.body);
    const supplier = db.prepare("SELECT id FROM partners WHERE id = ? AND type = 'supplier'").get(input.supplierId);
    if (!supplier) { res.status(400).json({ error: "Выберите существующего поставщика" }); return; }
    const warehouse = db.prepare("SELECT id FROM warehouses WHERE id = ?").get(input.warehouseId);
    if (!warehouse) { res.status(400).json({ error: "Склад не найден" }); return; }
    const prepared = input.items.map((item) => {
      const product = db.prepare("SELECT id FROM products WHERE id = ? AND active = 1").get(item.productId);
      if (!product) throw new Error(`Товар #${item.productId} не найден или архивирован`);
      return item;
    });
    const total = prepared.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const number = `ПТ-${String(Date.now()).slice(-8)}`;
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db.prepare("INSERT INTO purchases (number, supplier_id, warehouse_id, total) VALUES (?, ?, ?, ?)")
        .run(number, input.supplierId, input.warehouseId, total);
      const purchaseId = Number(result.lastInsertRowid);
      const insertItem = db.prepare("INSERT INTO purchase_items (purchase_id, product_id, quantity, price) VALUES (?, ?, ?, ?)");
      for (const item of prepared) insertItem.run(purchaseId, item.productId, item.quantity, item.price);
      db.exec("COMMIT");
      res.status(201).json({ id: purchaseId, number, supplierId: input.supplierId, warehouseId: input.warehouseId, status: "draft", total, items: prepared });
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Товар #")) { res.status(400).json({ error: error.message }); return; }
    handleWriteError(error, next, res);
  }
});

app.post("/api/purchases/:id/receive", allowRoles("admin", "director", "manager", "storekeeper"), (req, res, next) => {
  try {
    const purchaseId = Number(req.params.id);
    if (!Number.isSafeInteger(purchaseId) || purchaseId <= 0) { res.status(400).json({ error: "Некорректный номер закупки" }); return; }
    db.exec("BEGIN IMMEDIATE");
    try {
      const purchase = db.prepare("SELECT id, number, warehouse_id AS warehouseId, status FROM purchases WHERE id = ?")
        .get(purchaseId) as { id: number; number: string; warehouseId: number; status: string } | undefined;
      if (!purchase) { db.exec("ROLLBACK"); res.status(404).json({ error: "Закупка не найдена" }); return; }
      if (purchase.status !== "draft") { db.exec("ROLLBACK"); res.status(409).json({ error: "Поступление уже проведено" }); return; }
      const items = db.prepare("SELECT product_id AS productId, quantity FROM purchase_items WHERE purchase_id = ?").all(purchaseId) as Array<{ productId: number; quantity: number }>;
      if (!items.length) { db.exec("ROLLBACK"); res.status(409).json({ error: "В закупке нет товарных строк" }); return; }
      const addStock = db.prepare(`INSERT INTO stock (product_id, warehouse_id, quantity) VALUES (?, ?, ?)
        ON CONFLICT(product_id, warehouse_id) DO UPDATE SET quantity = quantity + excluded.quantity`);
      const movement = db.prepare("INSERT INTO movements (type, product_id, warehouse_id, quantity, document) VALUES ('receipt', ?, ?, ?, ?)");
      for (const item of items) {
        addStock.run(item.productId, purchase.warehouseId, item.quantity);
        movement.run(item.productId, purchase.warehouseId, item.quantity, purchase.number);
      }
      db.prepare("UPDATE purchases SET status = 'received', received_at = CURRENT_TIMESTAMP WHERE id = ?").run(purchaseId);
      db.exec("COMMIT");
      res.json({ id: purchaseId, number: purchase.number, status: "received", receivedItems: items.length });
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } catch (error) { next(error); }
});

const saleSchema = z.object({
  clientId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  initialPayment: z.number().finite().min(0).optional().default(0),
  paymentMethod: z.enum(["cash", "card", "transfer"]).optional().default("transfer"),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().positive(),
    discount: z.number().min(0).max(100).default(0)
  })).min(1)
});

const paymentSchema = z.object({
  amount: z.number().finite().positive(),
  method: z.enum(["cash", "card", "transfer"]),
  reference: z.string().trim().max(100).optional().default("")
});

app.get("/api/sales", allowRoles("admin", "director", "manager", "accountant"), (_req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.number, s.client_id AS clientId, p.name AS client,
           s.warehouse_id AS warehouseId, w.name AS warehouse, s.status, s.total,
           s.paid_amount AS paidAmount, MAX(s.total - s.paid_amount, 0) AS debt,
           CASE WHEN s.paid_amount >= s.total THEN 'paid'
                WHEN s.paid_amount > 0 THEN 'partially_paid' ELSE 'unpaid' END AS paymentStatus,
           s.created_at AS createdAt
    FROM sales s JOIN partners p ON p.id = s.client_id
    JOIN warehouses w ON w.id = s.warehouse_id
    ORDER BY s.created_at DESC
  `).all();
  res.json(rows);
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
    total = Math.round((total + Number.EPSILON) * 100) / 100;
    if (input.initialPayment > total) { res.status(400).json({ error: "Первоначальная оплата не может превышать сумму продажи" }); return; }

    db.exec("BEGIN IMMEDIATE");
    try {
      const sale = db.prepare("INSERT INTO sales (number, client_id, warehouse_id, total, paid_amount) VALUES (?, ?, ?, ?, ?)")
        .run(number, input.clientId, input.warehouseId, total, input.initialPayment);
      const saleId = Number(sale.lastInsertRowid);
      const addItem = db.prepare("INSERT INTO sale_items (sale_id, product_id, quantity, price, discount) VALUES (?, ?, ?, ?, ?)");
      const reduceStock = db.prepare("UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND warehouse_id = ?");
      const movement = db.prepare("INSERT INTO movements (type, product_id, warehouse_id, quantity, document) VALUES ('sale', ?, ?, ?, ?)");
      for (const item of prepared) {
        addItem.run(saleId, item.productId, item.quantity, item.price, item.discount);
        reduceStock.run(item.quantity, item.productId, input.warehouseId);
        movement.run(item.productId, input.warehouseId, -item.quantity, number);
      }
      if (input.initialPayment > 0) {
        db.prepare("INSERT INTO sale_payments (sale_id, amount, method) VALUES (?, ?, ?)").run(saleId, input.initialPayment, input.paymentMethod);
        db.prepare("INSERT INTO finance_operations (type, category, amount, description, document) VALUES ('income', 'Продажи', ?, 'Оплата по реализации', ?)").run(input.initialPayment, number);
      }
      db.exec("COMMIT");
      res.status(201).json({ id: saleId, number, status: "completed", total, paidAmount: input.initialPayment, debt: total - input.initialPayment, paymentStatus: input.initialPayment === total ? "paid" : input.initialPayment > 0 ? "partially_paid" : "unpaid" });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

app.get("/api/sales/:id/payments", allowRoles("admin", "director", "accountant", "manager"), (req, res) => {
  const saleId = Number(req.params.id);
  const sale = db.prepare("SELECT id FROM sales WHERE id = ?").get(saleId);
  if (!sale) { res.status(404).json({ error: "Продажа не найдена" }); return; }
  res.json(db.prepare(`SELECT id, amount, method, reference, created_at AS createdAt
    FROM sale_payments WHERE sale_id = ? ORDER BY created_at DESC`).all(saleId));
});

app.post("/api/sales/:id/payments", allowRoles("admin", "director", "manager", "accountant"), (req, res, next) => {
  try {
    const saleId = Number(req.params.id);
    if (!Number.isSafeInteger(saleId) || saleId <= 0) { res.status(400).json({ error: "Некорректный номер продажи" }); return; }
    const input = paymentSchema.parse(req.body);
    db.exec("BEGIN IMMEDIATE");
    try {
      const sale = db.prepare("SELECT number, total, paid_amount AS paidAmount FROM sales WHERE id = ?")
        .get(saleId) as { number: string; total: number; paidAmount: number } | undefined;
      if (!sale) { db.exec("ROLLBACK"); res.status(404).json({ error: "Продажа не найдена" }); return; }
      const balance = Math.round((sale.total - sale.paidAmount + Number.EPSILON) * 100) / 100;
      if (input.amount > balance) { db.exec("ROLLBACK"); res.status(409).json({ error: `Сумма платежа превышает долг ${balance.toFixed(2)}` }); return; }
      const payment = db.prepare("INSERT INTO sale_payments (sale_id, amount, method, reference) VALUES (?, ?, ?, ?)")
        .run(saleId, input.amount, input.method, input.reference);
      const paidAmount = Math.round((sale.paidAmount + input.amount + Number.EPSILON) * 100) / 100;
      db.prepare("UPDATE sales SET paid_amount = ? WHERE id = ?").run(paidAmount, saleId);
      db.prepare("INSERT INTO finance_operations (type, category, amount, description, document) VALUES ('income', 'Продажи', ?, 'Оплата по реализации', ?)").run(input.amount, sale.number);
      db.exec("COMMIT");
      res.status(201).json({ id: Number(payment.lastInsertRowid), saleId, amount: input.amount, paidAmount, debt: Math.max(0, sale.total - paidAmount), paymentStatus: paidAmount >= sale.total ? "paid" : "partially_paid" });
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } catch (error) { next(error); }
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
