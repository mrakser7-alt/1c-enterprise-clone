import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

test("ERP API authentication, stock documents, payments, roles and error responses", { timeout: 30_000 }, async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "enterprise-api-test-"));
  const databasePath = join(dataDir, "test.sqlite");
  const portServer = createServer();
  await new Promise((resolve, reject) => portServer.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  const port = portServer.address().port;
  await new Promise((resolve, reject) => portServer.close((error) => error ? reject(error) : resolve()));

  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      DATABASE_PATH: databasePath,
      PORT: String(port),
      JWT_SECRET: "automated-test-secret-that-is-long-enough",
      ADMIN_EMAIL: "admin@example.invalid",
      ADMIN_PASSWORD: "test-admin-password"
    },
    stdio: "ignore"
  });
  const base = `http://127.0.0.1:${port}/api`;
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`API process exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) { ready = true; break; }
    } catch { /* API is still starting. */ }
    await delay(100);
  }
  assert.equal(ready, true, "API should start with an isolated temporary database");

  const call = (path, { method = "GET", token, body, rawBody, headers = {} } = {}) => fetch(`${base}${path}`, {
    method,
    headers: { ...(body !== undefined || rawBody !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : rawBody
  });
  const json = async (response) => response.json();
  const login = async (email, password) => {
    const response = await call("/auth/login", { method: "POST", body: { email, password } });
    return { response, data: await json(response) };
  };

  const invalidLogin = await call("/auth/login", { method: "POST", body: { email: "nope", password: "x" } });
  assert.equal(invalidLogin.status, 400);
  assert.equal((await call("/products")).status, 401);

  const adminLogin = await login("admin@example.invalid", "test-admin-password");
  assert.equal(adminLogin.response.status, 200);
  const adminToken = adminLogin.data.token;
  assert.equal((await call("/unknown-route", { token: adminToken })).status, 404);
  assert.equal((await call("/categories", { method: "POST", token: adminToken, rawBody: "{" })).status, 400);
  assert.equal((await call("/categories", { method: "POST", token: adminToken, rawBody: "x".repeat(1_100_000) })).status, 413);

  const before = await json(await call("/stock", { token: adminToken }));
  const sourceBefore = before.find((row) => row.productId === 1 && row.warehouseId === 1).quantity;
  const destinationBefore = before.find((row) => row.productId === 1 && row.warehouseId === 2).quantity;

  const purchaseResponse = await call("/purchases", {
    method: "POST", token: adminToken,
    body: { supplierId: 3, warehouseId: 1, items: [{ productId: 1, quantity: 3, price: 100 }] }
  });
  const purchase = await json(purchaseResponse);
  assert.equal(purchaseResponse.status, 201);
  const draftStock = await json(await call("/stock", { token: adminToken }));
  assert.equal(draftStock.find((row) => row.productId === 1 && row.warehouseId === 1).quantity, sourceBefore);
  const received = await call(`/purchases/${purchase.id}/receive`, { method: "POST", token: adminToken, body: {} });
  assert.equal(received.status, 200);
  assert.equal((await call(`/purchases/${purchase.id}/receive`, { method: "POST", token: adminToken, body: {} })).status, 409);
  let stock = await json(await call("/stock", { token: adminToken }));
  assert.equal(stock.find((row) => row.productId === 1 && row.warehouseId === 1).quantity, sourceBefore + 3);

  const transferResponse = await call("/transfers", {
    method: "POST", token: adminToken,
    body: { sourceWarehouseId: 1, destinationWarehouseId: 2, items: [{ productId: 1, quantity: 2 }] }
  });
  assert.equal(transferResponse.status, 201);
  stock = await json(await call("/stock", { token: adminToken }));
  const sourceAfterTransfer = stock.find((row) => row.productId === 1 && row.warehouseId === 1).quantity;
  const destinationAfterTransfer = stock.find((row) => row.productId === 1 && row.warehouseId === 2).quantity;
  assert.equal(sourceAfterTransfer, sourceBefore + 1);
  assert.equal(destinationAfterTransfer, destinationBefore + 2);
  const transferCountBeforeFailure = (await json(await call("/transfers", { token: adminToken }))).length;
  assert.equal((await call("/transfers", {
    method: "POST", token: adminToken,
    body: { sourceWarehouseId: 1, destinationWarehouseId: 2, items: [{ productId: 1, quantity: 1_000_000 }] }
  })).status, 409);
  assert.equal((await json(await call("/transfers", { token: adminToken }))).length, transferCountBeforeFailure, "failed transfer must roll back its document");
  stock = await json(await call("/stock", { token: adminToken }));
  assert.equal(stock.find((row) => row.productId === 1 && row.warehouseId === 1).quantity, sourceAfterTransfer);
  assert.equal(stock.find((row) => row.productId === 1 && row.warehouseId === 2).quantity, destinationAfterTransfer);

  const countedQuantity = destinationBefore + 1;
  const inventoryResponse = await call("/inventory-counts", {
    method: "POST", token: adminToken,
    body: { warehouseId: 2, items: [{ productId: 1, countedQuantity }] }
  });
  const inventory = await json(inventoryResponse);
  assert.equal(inventoryResponse.status, 201);
  assert.equal(inventory.items[0].difference, -1);
  stock = await json(await call("/stock", { token: adminToken }));
  assert.equal(stock.find((row) => row.productId === 1 && row.warehouseId === 2).quantity, countedQuantity);
  const inventoryMovements = await json(await call("/movements?type=inventory&productId=1", { token: adminToken }));
  assert.equal(inventoryMovements.items[0].quantity, -1);

  const invalidSale = await call("/sales", { method: "POST", token: adminToken, body: { items: [] } });
  assert.equal(invalidSale.status, 400);
  const insufficientSale = await call("/sales", {
    method: "POST", token: adminToken,
    body: { clientId: 1, warehouseId: 1, items: [{ productId: 2, quantity: 1_000_000 }] }
  });
  assert.equal(insufficientSale.status, 409);

  const saleResponse = await call("/sales", {
    method: "POST", token: adminToken,
    body: { clientId: 1, warehouseId: 1, initialPayment: 100, paymentMethod: "cash", items: [{ productId: 2, quantity: 2, discount: 10 }] }
  });
  const sale = await json(saleResponse);
  assert.equal(saleResponse.status, 201);
  assert.equal(sale.total, 32_382);
  assert.equal(sale.debt, 32_282);
  const overpayment = await call(`/sales/${sale.id}/payments`, {
    method: "POST", token: adminToken, body: { amount: sale.debt + 1, method: "cash" }
  });
  assert.equal(overpayment.status, 409);
  const payment = await call(`/sales/${sale.id}/payments`, {
    method: "POST", token: adminToken, body: { amount: sale.debt, method: "transfer" }
  });
  assert.equal(payment.status, 201);
  const payments = await json(await call(`/sales/${sale.id}/payments`, { token: adminToken }));
  assert.equal(payments.length, 2);

  const reports = await json(await call("/reports?from=2020-01-01&to=2030-12-31", { token: adminToken }));
  assert.equal(reports.summary.salesCount, 1);
  assert.equal(reports.summary.revenue, sale.total);
  assert.equal(reports.summary.received, sale.total);
  assert.equal(reports.summary.debt, 0);

  const accountantCreated = await call("/auth/users", {
    method: "POST", token: adminToken,
    body: { email: "read-only@example.invalid", name: "Read Only", password: "read-only-test-password", role: "accountant" }
  });
  assert.equal(accountantCreated.status, 201);
  const accountantLogin = await login("read-only@example.invalid", "read-only-test-password");
  assert.equal(accountantLogin.response.status, 200);
  assert.equal((await call("/products", { token: accountantLogin.data.token })).status, 200);
  assert.equal((await call("/sales", { method: "POST", token: accountantLogin.data.token, body: {} })).status, 403);

  const movements = await json(await call("/movements?limit=200", { token: adminToken }));
  assert.ok(movements.items.some((row) => row.type === "receipt" && row.quantity === 3));
  assert.ok(movements.items.some((row) => row.type === "transfer" && row.quantity === -2));
  assert.ok(movements.items.some((row) => row.type === "sale" && row.quantity === -2));
});
