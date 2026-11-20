import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Archive, ArrowDownLeft, ArrowRightLeft, ArrowUpRight, BarChart3,
  Bell, Boxes, Building2, Check, ChevronDown, CircleDollarSign,
  ClipboardList, Download, FileText, LayoutDashboard, Menu, Package,
  Plus, Search, Settings, ShoppingBag, ShoppingCart, Store, Truck,
  Users, Warehouse, X
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, demoFinances, demoMovements, demoProducts, type Dashboard, type Finance, type Movement, type Product } from "./lib/data";

type Page = "dashboard" | "products" | "warehouse" | "sales" | "purchases" | "finance" | "reports" | "partners";
type NavItem = { id: Page; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }> };

const nav: Array<{ title: string; items: NavItem[] }> = [
  { title: "Главное", items: [
    { id: "dashboard", label: "Обзор", icon: LayoutDashboard },
    { id: "products", label: "Номенклатура", icon: Package },
    { id: "warehouse", label: "Склад", icon: Warehouse }
  ]},
  { title: "Операции", items: [
    { id: "sales", label: "Продажи", icon: ShoppingCart },
    { id: "purchases", label: "Закупки", icon: Truck },
    { id: "finance", label: "Финансы", icon: CircleDollarSign }
  ]},
  { title: "Аналитика", items: [
    { id: "reports", label: "Отчёты", icon: BarChart3 },
    { id: "partners", label: "Контрагенты", icon: Users }
  ]}
];

const titles: Record<Page, { eyebrow: string; title: string; text: string }> = {
  dashboard: { eyebrow: "Операционный центр", title: "Добрый день, Максим", text: "Картина бизнеса на 20 ноября 2026" },
  products: { eyebrow: "Справочники", title: "Номенклатура", text: "Товары, цены и контроль минимального остатка" },
  warehouse: { eyebrow: "Логистика", title: "Складской учёт", text: "Остатки и движения по всем складам" },
  sales: { eyebrow: "Торговля", title: "Продажи", text: "Заказы клиентов и реализация товаров" },
  purchases: { eyebrow: "Снабжение", title: "Закупки", text: "Поставщики, заказы и поступления" },
  finance: { eyebrow: "Деньги", title: "Финансы", text: "Доходы, расходы и движение денежных средств" },
  reports: { eyebrow: "Аналитика", title: "Отчёты", text: "Ключевые показатели компании в реальном времени" },
  partners: { eyebrow: "Справочники", title: "Контрагенты", text: "Клиенты и поставщики компании" }
};

const money = (value: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value);
const shortMoney = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} млн ₽` : `${Math.round(value / 1000)} тыс. ₽`;

function Status({ children, tone = "green" }: { children: React.ReactNode; tone?: "green" | "amber" | "blue" | "gray" }) {
  return <span className={`status status-${tone}`}><i />{children}</span>;
}

function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: ComponentType<{ size?: number }>; tone: string }) {
  return <article className="metric-card">
    <div className={`metric-icon ${tone}`}><Icon size={20} /></div>
    <div className="metric-label">{label}</div>
    <strong>{value}</strong>
    <div className="metric-detail"><span>↗ 12,4%</span> {detail}</div>
  </article>;
}

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [sidebar, setSidebar] = useState(false);
  const [query, setQuery] = useState("");
  const [saleOpen, setSaleOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [products, setProducts] = useState<Product[]>(demoProducts);
  const [movements, setMovements] = useState<Movement[]>(demoMovements);
  const [finances, setFinances] = useState<Finance[]>(demoFinances);

  useEffect(() => {
    Promise.all([api.dashboard(), api.products(), api.movements(), api.finances()]).then(([d, p, m, f]) => {
      setDashboard(d); setProducts(p); setMovements(m); setFinances(f);
    });
  }, []);

  const filtered = useMemo(() => products.filter((p) => `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(query.toLowerCase())), [products, query]);
  const selectPage = (id: Page) => { setPage(id); setSidebar(false); setQuery(""); };
  const t = titles[page];

  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 3200);
  };

  return <div className="app-shell">
    <aside className={`sidebar ${sidebar ? "open" : ""}`}>
      <div className="brand"><div className="brand-mark">П</div><div><strong>Пульс</strong><span>УЧЁТ ПРЕДПРИЯТИЯ</span></div><button className="mobile-close" onClick={() => setSidebar(false)}><X size={20} /></button></div>
      <nav>
        {nav.map((group) => <div className="nav-group" key={group.title}>
          <p>{group.title}</p>
          {group.items.map(({ id, label, icon: Icon }) => <button className={page === id ? "active" : ""} onClick={() => selectPage(id)} key={id}>
            <Icon size={19} strokeWidth={1.8} /><span>{label}</span>{id === "warehouse" && <b>2</b>}
          </button>)}
        </div>)}
      </nav>
      <div className="sidebar-foot">
        <button><Settings size={18} /> Настройки</button>
        <div className="user"><div className="avatar">МВ</div><div><strong>Максим Волков</strong><span>Администратор</span></div><ChevronDown size={16} /></div>
      </div>
    </aside>

    {sidebar && <div className="scrim" onClick={() => setSidebar(false)} />}
    <main>
      <header className="topbar">
        <button className="menu-button" onClick={() => setSidebar(true)}><Menu size={21} /></button>
        <div className="global-search"><Search size={18} /><input placeholder="Найти документ, товар или клиента" /><kbd>⌘ K</kbd></div>
        <div className="top-actions"><Status>Система работает</Status><button className="icon-button"><Bell size={19} /><i /></button><button className="round-avatar">МВ</button></div>
      </header>

      <div className="content">
        <div className="page-head">
          <div><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.text}</p></div>
          <div className="head-actions"><button className="secondary"><Download size={17} /> Экспорт</button><button className="primary" onClick={() => setSaleOpen(true)}><Plus size={18} /> Новая продажа</button></div>
        </div>

        {page === "dashboard" && dashboard && <DashboardView dashboard={dashboard} products={products} movements={movements} setPage={selectPage} />}
        {page === "products" && <ProductsView products={filtered} query={query} setQuery={setQuery} flash={flash} />}
        {page === "warehouse" && <WarehouseView products={filtered} movements={movements} query={query} setQuery={setQuery} />}
        {page === "sales" && <SalesView openSale={() => setSaleOpen(true)} />}
        {page === "purchases" && <PurchasesView flash={flash} />}
        {page === "finance" && <FinanceView finances={finances} />}
        {page === "reports" && dashboard && <ReportsView dashboard={dashboard} products={products} />}
        {page === "partners" && <PartnersView flash={flash} />}
      </div>
    </main>

    {saleOpen && <SaleModal products={products} onClose={() => setSaleOpen(false)} onSave={(productId, qty) => {
      setProducts((list) => list.map((p) => p.id === productId ? { ...p, stock: Math.max(0, p.stock - qty) } : p));
      setSaleOpen(false); flash("Продажа РН-00125 проведена. Остатки обновлены.");
    }} />}
    {notice && <div className="toast"><Check size={18} />{notice}</div>}
  </div>;
}

function DashboardView({ dashboard, products, movements, setPage }: { dashboard: Dashboard; products: Product[]; movements: Movement[]; setPage: (p: Page) => void }) {
  return <>
    <section className="metrics-grid">
      <MetricCard label="Выручка за месяц" value={shortMoney(dashboard.metrics.revenue)} detail="к прошлому месяцу" icon={ArrowUpRight} tone="lime" />
      <MetricCard label="Валовая прибыль" value={shortMoney(dashboard.metrics.profit)} detail="маржа 30,7%" icon={CircleDollarSign} tone="violet" />
      <MetricCard label="Товаров на складах" value={money(dashboard.metrics.stockValue)} detail="208 единиц" icon={Boxes} tone="blue" />
      <MetricCard label="Требуют внимания" value={String(dashboard.metrics.lowStock)} detail="ниже минимума" icon={Bell} tone="orange" />
    </section>
    <section className="dashboard-grid">
      <article className="panel chart-panel">
        <div className="panel-head"><div><h2>Динамика продаж</h2><p>Выручка за последние 7 дней</p></div><button>7 дней <ChevronDown size={15} /></button></div>
        <div className="chart-summary"><strong>921 010 ₽</strong><span>+18,2% за неделю</span></div>
        <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={dashboard.salesByDay} margin={{ left: -18, right: 4 }}>
          <defs><linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b7f52b" stopOpacity={0.3}/><stop offset="100%" stopColor="#b7f52b" stopOpacity={0}/></linearGradient></defs>
          <CartesianGrid stroke="#eceee9" vertical={false} /><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#8c9089", fontSize: 12 }} /><YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}к`} tick={{ fill: "#8c9089", fontSize: 12 }} />
          <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ borderRadius: 12, border: "1px solid #e3e5df" }} /><Area type="monotone" dataKey="value" stroke="#4e6e0c" strokeWidth={2.5} fill="url(#salesGradient)" />
        </AreaChart></ResponsiveContainer></div>
      </article>
      <article className="panel attention-panel">
        <div className="panel-head"><div><h2>Требует внимания</h2><p>Задачи на сегодня</p></div><span className="count">4</span></div>
        <button className="attention-item"><div className="attention-icon warn"><Package size={18} /></div><div><strong>Низкий остаток</strong><span>Док-станция USB-C · 3 шт.</span></div><em>Склад</em></button>
        <button className="attention-item"><div className="attention-icon blue"><FileText size={18} /></div><div><strong>Ожидает оплаты</strong><span>Заказ РН-00121 · 128 900 ₽</span></div><em>Продажи</em></button>
        <button className="attention-item"><div className="attention-icon violet"><Truck size={18} /></div><div><strong>Поставка задерживается</strong><span>Заказ ПЗ-00034 · 2 дня</span></div><em>Закупки</em></button>
        <button className="view-all" onClick={() => setPage("warehouse")}>Показать все задачи</button>
      </article>
    </section>
    <section className="panel table-panel">
      <div className="panel-head"><div><h2>Последние операции</h2><p>Документы по складу и продажам</p></div><button onClick={() => setPage("warehouse")}>Все операции</button></div>
      <MovementTable movements={movements} />
    </section>
    <section className="quick-grid">
      <button onClick={() => setPage("sales")}><span><ShoppingBag /></span><strong>Создать продажу</strong><small>Новый заказ клиента</small></button>
      <button onClick={() => setPage("purchases")}><span><Truck /></span><strong>Оформить закупку</strong><small>Заказ поставщику</small></button>
      <button onClick={() => setPage("warehouse")}><span><ArrowRightLeft /></span><strong>Переместить товар</strong><small>Между складами</small></button>
      <button onClick={() => setPage("reports")}><span><BarChart3 /></span><strong>Открыть отчёт</strong><small>Аналитика бизнеса</small></button>
    </section>
  </>;
}

function ProductsView({ products, query, setQuery, flash }: { products: Product[]; query: string; setQuery: (v: string) => void; flash: (v: string) => void }) {
  return <section className="panel table-panel">
    <div className="table-toolbar"><div className="search-field"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по названию или артикулу" /></div><button className="secondary"><Archive size={17} /> Категории</button><button className="primary" onClick={() => flash("Карточка нового товара подготовлена") }><Plus size={17} /> Добавить товар</button></div>
    <div className="table-scroll"><table><thead><tr><th>Товар</th><th>Категория</th><th>Закупка</th><th>Продажа</th><th>Остаток</th><th>Статус</th></tr></thead><tbody>
      {products.map((p) => <tr key={p.id}><td><div className="product-cell"><div className="product-thumb"><Package size={18} /></div><div><strong>{p.name}</strong><span>{p.sku}</span></div></div></td><td>{p.category}</td><td>{money(p.purchase_price)}</td><td><strong>{money(p.sale_price)}</strong></td><td>{p.stock} {p.unit}</td><td>{p.stock <= p.min_stock ? <Status tone="amber">Низкий остаток</Status> : <Status>В наличии</Status>}</td></tr>)}
    </tbody></table></div>
  </section>;
}

function WarehouseView({ products, movements, query, setQuery }: { products: Product[]; movements: Movement[]; query: string; setQuery: (v: string) => void }) {
  return <>
    <section className="warehouse-cards"><article><Warehouse /><div><span>Основной склад</span><strong>165 позиций</strong><small>2,8 млн ₽</small></div></article><article><Store /><div><span>Розничный склад</span><strong>43 позиции</strong><small>475 тыс. ₽</small></div></article><article className="add-warehouse"><Plus /><span>Добавить склад</span></article></section>
    <section className="panel table-panel"><div className="table-toolbar"><div className="search-field"><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти товар на складе" /></div><button className="secondary"><ClipboardList size={17}/> Инвентаризация</button><button className="primary"><ArrowRightLeft size={17}/> Перемещение</button></div>
      <div className="table-scroll"><table><thead><tr><th>Товар</th><th>Основной</th><th>Розничный</th><th>Всего</th><th>Резерв</th><th>Доступно</th></tr></thead><tbody>{products.map((p) => <tr key={p.id}><td><div className="product-cell"><div className="product-thumb"><Package size={18}/></div><div><strong>{p.name}</strong><span>{p.sku}</span></div></div></td><td>{Math.round(p.stock * .75)}</td><td>{p.stock - Math.round(p.stock * .75)}</td><td><strong>{p.stock}</strong></td><td>{Math.min(3, Math.floor(p.stock / 8))}</td><td><Status tone={p.stock <= p.min_stock ? "amber" : "green"}>{Math.max(0, p.stock - 2)} шт.</Status></td></tr>)}</tbody></table></div>
    </section>
    <section className="panel table-panel compact"><div className="panel-head"><div><h2>Последние движения</h2><p>Приходы, продажи и перемещения</p></div></div><MovementTable movements={movements}/></section>
  </>;
}

function MovementTable({ movements }: { movements: Movement[] }) {
  const labels = { receipt: "Поступление", sale: "Продажа", transfer: "Перемещение", inventory: "Инвентаризация" };
  return <div className="table-scroll"><table><thead><tr><th>Документ</th><th>Операция</th><th>Товар</th><th>Склад</th><th>Количество</th><th>Дата</th></tr></thead><tbody>{movements.map((m) => <tr key={m.id}><td><strong>{m.document}</strong></td><td><Status tone={m.type === "sale" ? "blue" : m.type === "transfer" ? "gray" : "green"}>{labels[m.type]}</Status></td><td>{m.product}</td><td>{m.warehouse}</td><td className={m.quantity > 0 ? "positive" : "negative"}>{m.quantity > 0 ? "+" : ""}{m.quantity} шт.</td><td>{new Date(m.createdAt.replace(" ", "T")).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td></tr>)}</tbody></table></div>;
}

function SalesView({ openSale }: { openSale: () => void }) {
  const sales = [
    ["РН-00124", "ООО «Вектор»", "149 980 ₽", "Оплачено", "20 ноя, 13:15"],
    ["РН-00123", "ИП Соколова", "28 450 ₽", "Оплачено", "19 ноя, 18:42"],
    ["РН-00122", "ООО «Альфа Софт»", "76 900 ₽", "В работе", "19 ноя, 11:20"],
    ["РН-00121", "АО «Регион»", "128 900 ₽", "Ожидает оплаты", "18 ноя, 16:05"]
  ];
  return <section className="panel table-panel"><div className="table-toolbar"><div className="search-field"><Search size={17}/><input placeholder="Номер заказа или клиент" /></div><button className="secondary"><Download size={17}/> Выгрузить</button><button className="primary" onClick={openSale}><Plus size={17}/> Создать реализацию</button></div><div className="table-scroll"><table><thead><tr><th>Номер</th><th>Клиент</th><th>Сумма</th><th>Статус</th><th>Дата</th></tr></thead><tbody>{sales.map((s) => <tr key={s[0]}><td><strong>{s[0]}</strong></td><td>{s[1]}</td><td><strong>{s[2]}</strong></td><td><Status tone={s[3] === "Оплачено" ? "green" : s[3] === "В работе" ? "blue" : "amber"}>{s[3]}</Status></td><td>{s[4]}</td></tr>)}</tbody></table></div></section>;
}

function PurchasesView({ flash }: { flash: (v: string) => void }) {
  return <section className="empty-layout"><div className="panel procurement-card"><div className="large-icon"><Truck /></div><span>Снабжение</span><h2>Планируйте закупки по остаткам</h2><p>Система подскажет, какие товары заканчиваются, и поможет оформить заказ поставщику.</p><button className="primary" onClick={() => flash("Черновик заказа поставщику ПЗ-00035 создан") }><Plus size={17}/> Новый заказ поставщику</button></div><div className="panel tips"><h3>Рекомендации</h3><div><Package/><p><strong>Док-станция USB-C</strong><span>Заказать 12 шт. до 24 ноября</span></p></div><div><Package/><p><strong>Офисное кресло Flex</strong><span>Заказать 6 шт. до 27 ноября</span></p></div></div></section>;
}

function FinanceView({ finances }: { finances: Finance[] }) {
  const income = finances.filter((f) => f.type === "income").reduce((s, f) => s + f.amount, 0);
  const expense = finances.filter((f) => f.type === "expense").reduce((s, f) => s + f.amount, 0);
  return <><section className="finance-summary"><article><ArrowDownLeft/><span>Поступления</span><strong>{money(income)}</strong></article><article><ArrowUpRight/><span>Расходы</span><strong>{money(expense)}</strong></article><article className="dark-card"><CircleDollarSign/><span>Денежный поток</span><strong>{money(income-expense)}</strong></article></section><section className="panel table-panel"><div className="panel-head"><div><h2>Финансовые операции</h2><p>Все движения денежных средств</p></div></div><div className="table-scroll"><table><thead><tr><th>Операция</th><th>Категория</th><th>Документ</th><th>Дата</th><th>Сумма</th></tr></thead><tbody>{finances.map((f) => <tr key={f.id}><td><strong>{f.description}</strong></td><td>{f.category}</td><td>{f.document}</td><td>{new Date(f.createdAt.replace(" ", "T")).toLocaleDateString("ru-RU")}</td><td className={f.type === "income" ? "positive" : "negative"}>{f.type === "income" ? "+" : "−"}{money(f.amount)}</td></tr>)}</tbody></table></div></section></>;
}

function ReportsView({ dashboard, products }: { dashboard: Dashboard; products: Product[] }) {
  const top = [...products].sort((a,b) => b.stock*b.sale_price-a.stock*a.sale_price).slice(0,5);
  return <section className="reports-grid"><article className="panel chart-panel"><div className="panel-head"><div><h2>Выручка по дням</h2><p>Текущий период</p></div></div><div className="chart-wrap large"><ResponsiveContainer width="100%" height="100%"><AreaChart data={dashboard.salesByDay}><CartesianGrid stroke="#eceee9" vertical={false}/><XAxis dataKey="day" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip formatter={(v)=>money(Number(v))}/><Area type="monotone" dataKey="value" stroke="#5d781e" fill="#dfff9b"/></AreaChart></ResponsiveContainer></div></article><article className="panel ranking"><div className="panel-head"><div><h2>Товары в обороте</h2><p>По розничной стоимости</p></div></div>{top.map((p,i)=><div key={p.id}><b>{i+1}</b><span><strong>{p.name}</strong><small>{p.stock} шт.</small></span><em>{money(p.stock*p.sale_price)}</em></div>)}</article></section>;
}

function PartnersView({ flash }: { flash: (v: string) => void }) {
  const partners = [["ООО «Вектор»","Клиент","+7 846 200-11-22","6318123456"],["ИП Соколова","Клиент","+7 927 700-44-18","631900123456"],["ООО «ТехПоставка»","Поставщик","+7 495 111-42-00","7728123401"]];
  return <section className="panel table-panel"><div className="table-toolbar"><div className="search-field"><Search size={17}/><input placeholder="Название, ИНН или телефон"/></div><button className="primary" onClick={()=>flash("Новая карточка контрагента создана")}><Plus size={17}/> Добавить контрагента</button></div><div className="table-scroll"><table><thead><tr><th>Название</th><th>Тип</th><th>Телефон</th><th>ИНН</th><th>Состояние</th></tr></thead><tbody>{partners.map(p=><tr key={p[0]}><td><div className="company-cell"><span>{p[0].slice(0,2)}</span><strong>{p[0]}</strong></div></td><td>{p[1]}</td><td>{p[2]}</td><td>{p[3]}</td><td><Status>Активен</Status></td></tr>)}</tbody></table></div></section>;
}

function SaleModal({ products, onClose, onSave }: { products: Product[]; onClose: () => void; onSave: (id: number, qty: number) => void }) {
  const [productId, setProductId] = useState(products[0]?.id ?? 1);
  const [qty, setQty] = useState(1);
  const product = products.find((p) => p.id === productId) ?? products[0];
  const valid = product && qty > 0 && qty <= product.stock;
  return <div className="modal-layer"><div className="modal"><div className="modal-head"><div><span>Новый документ</span><h2>Реализация товаров</h2></div><button onClick={onClose}><X size={20}/></button></div><div className="modal-body"><label>Клиент<select><option>ООО «Вектор»</option><option>ИП Соколова</option></select></label><label>Склад<select><option>Основной склад</option><option>Розничный склад</option></select></label><div className="form-row"><label>Товар<select value={productId} onChange={(e)=>setProductId(Number(e.target.value))}>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Количество<input type="number" min="1" max={product?.stock} value={qty} onChange={(e)=>setQty(Number(e.target.value))}/></label></div>{product && <div className="sale-line"><div><Package/><span><strong>{product.name}</strong><small>Доступно: {product.stock} шт.</small></span></div><strong>{money(product.sale_price*qty)}</strong></div>}{!valid && <p className="form-error">Нельзя продать больше товара, чем есть на складе.</p>}</div><div className="modal-foot"><button className="secondary" onClick={onClose}>Отмена</button><button className="primary" disabled={!valid} onClick={()=>valid && onSave(productId, qty)}><Check size={17}/> Провести продажу</button></div></div></div>;
}

export default App;
