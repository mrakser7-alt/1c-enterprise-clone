import { Bot, InlineKeyboard } from "grammy";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is required");

const allowed = new Set(
  (process.env.ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((id) => Number(id.trim()))
    .filter(Number.isFinite)
);
const apiUrl = process.env.API_URL ?? "http://localhost:4000/api";
const webAppUrl = process.env.WEB_APP_URL;
const bot = new Bot(token);

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId || !allowed.has(userId)) {
    await ctx.reply("Доступ закрыт. Обратитесь к владельцу системы.");
    return;
  }
  await next();
});

function menu() {
  const keyboard = new InlineKeyboard();
  if (webAppUrl) keyboard.webApp("✨ Открыть приложение", webAppUrl).row();
  return keyboard
    .text("💰 Записать продажу", "sale").row()
    .text("📦 Каталог", "catalog").text("📊 Отчёты", "reports").row()
    .text("🧾 Последние продажи", "recent").text("📄 CSV", "csv");
}

bot.command("start", (ctx) => ctx.reply(
  "Пульс · личный учёт\n\nТовары, продажи, остатки и расходы в одном месте.",
  { reply_markup: menu() }
));

bot.callbackQuery("catalog", async (ctx) => {
  await ctx.answerCallbackQuery();
  const response = await fetch(`${apiUrl}/products`);
  const products = await response.json() as Array<{ name: string; sale_price: number; stock: number }>;
  const text = products.slice(0, 12).map((p) => `• ${p.name}\n  ${p.sale_price.toLocaleString("ru-RU")} ₽ · ${p.stock} шт.`).join("\n\n");
  await ctx.reply(`📦 Каталог\n\n${text || "Каталог пока пуст."}`);
});

bot.callbackQuery("reports", async (ctx) => {
  await ctx.answerCallbackQuery();
  const response = await fetch(`${apiUrl}/dashboard`);
  const data = await response.json() as { metrics: { revenue: number; profit: number; stockValue: number; lowStock: number } };
  await ctx.reply([
    "📊 Сводка",
    `Выручка: ${data.metrics.revenue.toLocaleString("ru-RU")} ₽`,
    `Прибыль: ${data.metrics.profit.toLocaleString("ru-RU")} ₽`,
    `Товаров на сумму: ${data.metrics.stockValue.toLocaleString("ru-RU")} ₽`,
    `Низкий остаток: ${data.metrics.lowStock}`
  ].join("\n"));
});

bot.callbackQuery(["sale", "recent", "csv"], async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Функция подключается к ERP и будет расширена" });
  await ctx.reply("Откройте веб-приложение: там эта операция уже доступна.", { reply_markup: menu() });
});

bot.catch((error) => console.error("Telegram bot error:", error.error));
bot.start({ onStart: () => console.log("Telegram bot started") });
