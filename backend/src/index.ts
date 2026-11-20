import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "./db.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "enterprise-api" }));

app.get("/api/dashboard", (_req, res) => {
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

app.get("/api/products", (_req, res) => {
  const rows = db.prepare(`
    SELECT p.*, COALESCE(SUM(s.quantity), 0) AS stock
    FROM products p LEFT JOIN stock s ON s.product_id = p.id
    GROUP BY p.id ORDER BY p.name
  `).all();
  res.json(rows);
});

app.get("/api/stock", (_req, res) => {
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

app.get("/api/partners", (req, res) => {
  const type = req.query.type;
  const rows = type === "client" || type === "supplier"
    ? db.prepare("SELECT * FROM partners WHERE type = ? ORDER BY name").all(type)
    : db.prepare("SELECT * FROM partners ORDER BY name").all();
  res.json(rows);
});

app.get("/api/movements", (_req, res) => {
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

app.get("/api/finances", (_req, res) => {
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

app.post("/api/sales", (req, res, next) => {
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
