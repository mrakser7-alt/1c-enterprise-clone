import { Bot, InlineKeyboard } from "grammy";

const token = process.env.BOT_TOKEN?.trim();
const apiUrl = (process.env.API_URL ?? "http://localhost:4000/api").replace(/\/+$/, "");
const apiEmail = process.env.BOT_API_EMAIL?.trim();
const apiPassword = process.env.BOT_API_PASSWORD;

if (!token) throw new Error("BOT_TOKEN is required");
if (!apiEmail || !apiPassword) throw new Error("BOT_API_EMAIL and BOT_API_PASSWORD are required");
if (!/^https?:\/\//.test(apiUrl)) throw new Error("API_URL must be an HTTP(S) URL");
const apiHost = new URL(apiUrl).hostname;
if (new URL(apiUrl).protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(apiHost)) {
  throw new Error("API_URL must use HTTPS outside localhost");
}

const rawAllowedIds = process.env.ALLOWED_USER_IDS?.trim() ?? "";
if (!rawAllowedIds) throw new Error("ALLOWED_USER_IDS must contain at least one authorized Telegram user ID");
const allowedUserIds = new Set<number>();
for (const rawId of rawAllowedIds.split(",")) {
  const id = rawId.trim();
  if (!/^\d{1,16}$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
    throw new Error("ALLOWED_USER_IDS contains an invalid Telegram user ID");
  }
  allowedUserIds.add(Number(id));
}

type ApiToken = { token: string; expiresAt: number };
let apiToken: ApiToken | undefined;
let loginInProgress: Promise<string> | undefined;

async function login(): Promise<string> {
  if (apiToken && apiToken.expiresAt > Date.now() + 60_000) return apiToken.token;
  if (!loginInProgress) {
    loginInProgress = (async () => {
      const response = await fetch(`${apiUrl}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: apiEmail, password: apiPassword }),
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) throw new Error("API login failed");
      const result = await response.json() as { token?: unknown };
      if (typeof result.token !== "string" || !result.token) throw new Error("API login response is invalid");
      apiToken = { token: result.token, expiresAt: Date.now() + 7 * 60 * 60 * 1000 };
      return result.token;
    })().finally(() => { loginInProgress = undefined; });
  }
  return loginInProgress;
}

async function apiGet<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const bearer = await login();
    const response = await fetch(`${apiUrl}${path}`, {
      headers: { authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(8_000)
    });
    if (response.status === 401 && attempt === 0) {
      apiToken = undefined;
      continue;
    }
    if (!response.ok) throw new Error(`API request failed (${response.status})`);
    return await response.json() as T;
  }
  throw new Error("API authorization failed");
}

const bot = new Bot(token);
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId || !allowedUserIds.has(userId)) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Доступ закрыт" });
    else if (ctx.chat) await ctx.reply("Доступ закрыт. Обратитесь к владельцу системы.");
    return;
  }
  await next();
});

function menu() {
  return new InlineKeyboard()
    .text("📦 Каталог", "catalog").text("📊 Отчёты", "reports").row()
    .text("🧾 Последние продажи", "recent");
}

bot.command("start", (ctx) => ctx.reply(
  "Пульс · учёт предприятия\n\nБот предоставляет разрешённым пользователям доступ только для просмотра каталога, отчётов и последних продаж.",
  { reply_markup: menu() }
));

bot.callbackQuery("catalog", async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    const products = await apiGet<Array<{ name: string; sale_price: number; stock: number }>>("/products");
    const lines = products.slice(0, 12).map((product) =>
      `• ${product.name}\n  ${product.sale_price.toLocaleString("ru-RU")} ₽ · ${product.stock} шт.`);
    await ctx.reply(`📦 Каталог\n\n${lines.join("\n\n") || "Каталог пока пуст."}`);
  } catch {
    console.error("Telegram bot catalog request failed");
    await ctx.reply("Не удалось загрузить каталог. Попробуйте позже.");
  }
});

bot.callbackQuery("reports", async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    const data = await apiGet<{ period: { from: string; to: string }; summary: {
      revenue: number; received: number; debt: number; salesCount: number;
    }; stockSummary: { units: number; lowStockCount: number } }>("/reports");
    await ctx.reply([
      `📊 Отчёт за ${data.period.from} — ${data.period.to}`,
      `Продаж: ${data.summary.salesCount}`,
      `Выручка: ${data.summary.revenue.toLocaleString("ru-RU")} ₽`,
      `Получено: ${data.summary.received.toLocaleString("ru-RU")} ₽`,
      `Долг клиентов: ${data.summary.debt.toLocaleString("ru-RU")} ₽`,
      `Остаток: ${data.stockSummary.units.toLocaleString("ru-RU")} шт. · низкий запас: ${data.stockSummary.lowStockCount}`
    ].join("\n"));
  } catch {
    console.error("Telegram bot report request failed");
    await ctx.reply("Не удалось загрузить отчёт. Попробуйте позже.");
  }
});

bot.callbackQuery("recent", async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    const sales = await apiGet<Array<{ number: string; total: number; debt: number; createdAt: string }>>("/sales");
    const lines = sales.slice(0, 5).map((sale) =>
      `• ${sale.number} · ${new Date(sale.createdAt.replace(" ", "T") + "Z").toLocaleDateString("ru-RU")}\n  ${sale.total.toLocaleString("ru-RU")} ₽ · долг ${sale.debt.toLocaleString("ru-RU")} ₽`);
    await ctx.reply(`🧾 Последние продажи\n\n${lines.join("\n\n") || "Продаж пока нет."}`);
  } catch {
    console.error("Telegram bot recent sales request failed");
    await ctx.reply("Не удалось загрузить продажи. Попробуйте позже.");
  }
});

bot.catch(() => console.error("Telegram bot update failed"));
bot.start({ onStart: () => console.log("Telegram bot started") });
