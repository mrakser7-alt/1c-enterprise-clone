export type Product = {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  purchase_price: number;
  sale_price: number;
  min_stock: number;
  stock: number;
};

export type Movement = {
  id: number;
  type: "receipt" | "sale" | "transfer" | "inventory";
  product: string;
  warehouse: string;
  quantity: number;
  document: string;
  createdAt: string;
};

export type Finance = {
  id: number;
  type: "income" | "expense";
  category: string;
  amount: number;
  description: string;
  document: string;
  createdAt: string;
};

export type Dashboard = {
  metrics: { revenue: number; profit: number; stockValue: number; lowStock: number };
  salesByDay: Array<{ day: string; value: number }>;
};

export const demoProducts: Product[] = [
  { id: 1, sku: "NB-001", name: "Ноутбук ProBook 15", category: "Электроника", unit: "шт.", purchase_price: 58900, sale_price: 74990, min_stock: 5, stock: 22 },
  { id: 2, sku: "MN-024", name: "Монитор 24″ IPS", category: "Электроника", unit: "шт.", purchase_price: 13200, sale_price: 17990, min_stock: 8, stock: 38 },
  { id: 3, sku: "KB-105", name: "Клавиатура беспроводная", category: "Аксессуары", unit: "шт.", purchase_price: 2100, sale_price: 3490, min_stock: 12, stock: 56 },
  { id: 4, sku: "MS-208", name: "Мышь эргономичная", category: "Аксессуары", unit: "шт.", purchase_price: 1450, sale_price: 2490, min_stock: 15, stock: 71 },
  { id: 5, sku: "DS-500", name: "Док-станция USB-C", category: "Аксессуары", unit: "шт.", purchase_price: 6200, sale_price: 8990, min_stock: 6, stock: 14 },
  { id: 6, sku: "CH-410", name: "Офисное кресло Flex", category: "Мебель", unit: "шт.", purchase_price: 11800, sale_price: 16900, min_stock: 4, stock: 10 }
];

export const demoDashboard: Dashboard = {
  metrics: { revenue: 934120, profit: 286340, stockValue: 3275400, lowStock: 2 },
  salesByDay: [
    { day: "14 ноя", value: 84000 }, { day: "15 ноя", value: 121000 },
    { day: "16 ноя", value: 97000 }, { day: "17 ноя", value: 158000 },
    { day: "18 ноя", value: 149980 }, { day: "19 ноя", value: 178430 },
    { day: "20 ноя", value: 132600 }
  ]
};

export const demoMovements: Movement[] = [
  { id: 1, type: "transfer", product: "Клавиатура беспроводная", warehouse: "Розничный склад", quantity: 6, document: "Перемещение ПМ-00042", createdAt: "2026-11-20 10:05:00" },
  { id: 2, type: "sale", product: "Монитор 24″ IPS", warehouse: "Основной склад", quantity: -2, document: "Реализация РН-00124", createdAt: "2026-11-19 13:15:00" },
  { id: 3, type: "receipt", product: "Ноутбук ProBook 15", warehouse: "Основной склад", quantity: 10, document: "Поступление ПТ-00018", createdAt: "2026-11-18 09:30:00" }
];

export const demoFinances: Finance[] = [
  { id: 1, type: "expense", category: "Логистика", amount: 12600, description: "Доставка партии товара", document: "РС-00091", createdAt: "2026-11-20 11:40:00" },
  { id: 2, type: "income", category: "Продажи", amount: 28450, description: "Розничная выручка", document: "КМ-00182", createdAt: "2026-11-19 19:00:00" },
  { id: 3, type: "income", category: "Продажи", amount: 149980, description: "Оплата от ООО «Вектор»", document: "ПП-00421", createdAt: "2026-11-18 14:20:00" }
];

const apiBase = import.meta.env.VITE_API_URL ?? "/api";

async function request<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${apiBase}${path}`);
    if (!response.ok) throw new Error(String(response.status));
    return await response.json() as T;
  } catch {
    return fallback;
  }
}

export const api = {
  dashboard: () => request<Dashboard>("/dashboard", demoDashboard),
  products: () => request<Product[]>("/products", demoProducts),
  movements: () => request<Movement[]>("/movements", demoMovements),
  finances: () => request<Finance[]>("/finances", demoFinances)
};
