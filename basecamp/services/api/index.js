const http = require("http");
const mysql = require("mysql2/promise");
const Redis = require("ioredis");
const { Kafka } = require("kafkajs");

const PORT = 3000;
const MYSQL_HOST = process.env.MYSQL_HOST || "basecamp-mysql";
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || "root";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || "root";
const MYSQL_DB = process.env.MYSQL_DB || "faultlab";
const REDIS_HOST = process.env.REDIS_HOST || "basecamp-redis";
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const KAFKA_BROKER = process.env.KAFKA_BROKER || "basecamp-kafka:9092";

let mysqlPool;
let redis;
let producer;
const depStatus = { mysql: false, redis: false, kafka: false };

function nowIso() {
  return new Date().toISOString();
}

function logRequest(method, path, status, tookMs, errMsg) {
  if (errMsg) {
    process.stdout.write(
      `[api] ${nowIso()} ${method} ${path} ${status} ${tookMs}ms ERROR: ${errMsg}\n`
    );
    return;
  }
  process.stdout.write(`[api] ${nowIso()} ${method} ${path} ${status} ${tookMs}ms\n`);
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("payload too large"));
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (_err) {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", (err) => reject(err));
  });
}

async function fetchProduct(id) {
  const cacheKey = `product:detail:${id}`;
  const cached = await redis.hgetall(cacheKey);
  if (cached && Object.keys(cached).length > 0) {
    return {
      id: Number(cached.id),
      name: cached.name,
      price: Number(cached.price),
      stock: Number(cached.stock),
      source: "redis",
    };
  }

  const [rows] = await mysqlPool.query(
    "SELECT id, name, price, stock FROM products WHERE id = ?",
    [id]
  );
  if (!rows.length) {
    return null;
  }

  const p = rows[0];
  await redis.hset(cacheKey, {
    id: String(p.id),
    name: p.name,
    price: String(p.price),
    stock: String(p.stock),
  });
  await redis.expire(cacheKey, 300);

  return {
    id: p.id,
    name: p.name,
    price: Number(p.price),
    stock: p.stock,
    source: "mysql",
  };
}

async function ensureRedisStock(productId) {
  const stockKey = `product:stock:${productId}`;
  const exists = await redis.exists(stockKey);
  if (exists) {
    return;
  }
  const [rows] = await mysqlPool.query("SELECT stock FROM products WHERE id = ?", [productId]);
  if (!rows.length) {
    throw new Error("product not found");
  }
  await redis.set(stockKey, String(rows[0].stock));
}

async function createOrder(payload) {
  const userId = Number(payload.user_id);
  const productId = Number(payload.product_id);
  const qty = Number(payload.qty || 1);

  if (!Number.isInteger(userId) || userId < 1) {
    throw new Error("invalid user_id");
  }
  if (!Number.isInteger(productId) || productId < 1) {
    throw new Error("invalid product_id");
  }
  if (!Number.isInteger(qty) || qty < 1) {
    throw new Error("invalid qty");
  }

  const [userRows] = await mysqlPool.query("SELECT id FROM users WHERE id = ?", [userId]);
  if (!userRows.length) {
    throw new Error("user not found");
  }

  await ensureRedisStock(productId);
  const stockKey = `product:stock:${productId}`;
  const remain = await redis.decrby(stockKey, qty);
  if (remain < 0) {
    await redis.incrby(stockKey, qty);
    throw new Error("insufficient stock");
  }

  const conn = await mysqlPool.getConnection();
  try {
    await conn.beginTransaction();

    const [productRows] = await conn.query(
      "SELECT id, price, stock FROM products WHERE id = ? FOR UPDATE",
      [productId]
    );
    if (!productRows.length) {
      throw new Error("product not found");
    }

    const product = productRows[0];
    if (product.stock < qty) {
      throw new Error("insufficient stock");
    }

    const total = Number(product.price) * qty;

    const [orderResult] = await conn.query(
      "INSERT INTO orders (user_id, status, total) VALUES (?, 'pending', ?)",
      [userId, total]
    );
    const orderId = orderResult.insertId;

    await conn.query(
      "INSERT INTO order_items (order_id, product_id, qty, price) VALUES (?, ?, ?, ?)",
      [orderId, productId, qty, product.price]
    );

    await conn.query("UPDATE products SET stock = stock - ? WHERE id = ?", [qty, productId]);
    await conn.commit();

    await producer.send({
      topic: "order.created",
      messages: [
        {
          key: String(orderId),
          value: JSON.stringify({
            order_id: orderId,
            user_id: userId,
            product_id: productId,
            qty,
            total,
            created_at: nowIso(),
          }),
        },
      ],
    });

    return { order_id: orderId, status: "pending", total };
  } catch (err) {
    await conn.rollback();
    await redis.incrby(stockKey, qty);
    throw err;
  } finally {
    conn.release();
  }
}

async function fetchOrder(orderId) {
  const [orders] = await mysqlPool.query(
    "SELECT id, user_id, status, total, created_at FROM orders WHERE id = ?",
    [orderId]
  );
  if (!orders.length) {
    return null;
  }
  const [items] = await mysqlPool.query(
    "SELECT product_id, qty, price FROM order_items WHERE order_id = ?",
    [orderId]
  );

  return {
    id: orders[0].id,
    user_id: orders[0].user_id,
    status: orders[0].status,
    total: Number(orders[0].total),
    created_at: orders[0].created_at,
    items: items.map((i) => ({
      product_id: i.product_id,
      qty: i.qty,
      price: Number(i.price),
    })),
  };
}

async function initDependencies() {
  mysqlPool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DB,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  try {
    await mysqlPool.query("SELECT 1");
    depStatus.mysql = true;
    process.stdout.write(`[api] ${nowIso()} MySQL ready\n`);
  } catch (err) {
    process.stdout.write(`[api] ${nowIso()} MySQL not ready ERROR: ${err.message}\n`);
  }

  redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true, maxRetriesPerRequest: 2 });
  try {
    await redis.connect();
    await redis.ping();
    depStatus.redis = true;
    process.stdout.write(`[api] ${nowIso()} Redis ready\n`);
  } catch (err) {
    process.stdout.write(`[api] ${nowIso()} Redis not ready ERROR: ${err.message}\n`);
  }

  const kafka = new Kafka({ clientId: "faultlab-api", brokers: [KAFKA_BROKER] });
  producer = kafka.producer();
  try {
    await producer.connect();
    depStatus.kafka = true;
    process.stdout.write(`[api] ${nowIso()} Kafka ready\n`);
  } catch (err) {
    process.stdout.write(`[api] ${nowIso()} Kafka not ready ERROR: ${err.message}\n`);
  }
}

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  const method = req.method || "GET";
  const rawPath = (req.url || "/").split("?")[0];

  let statusCode = 500;
  let errorText = "";

  try {
    if (method === "GET" && rawPath === "/health") {
      statusCode = 200;
      sendJson(res, statusCode, {
        status: "ok",
        deps: depStatus,
      });
      return;
    }

    const productMatch = rawPath.match(/^\/products\/(\d+)$/);
    if (method === "GET" && productMatch) {
      const product = await fetchProduct(Number(productMatch[1]));
      if (!product) {
        statusCode = 404;
        sendJson(res, statusCode, { error: "product not found" });
        return;
      }
      statusCode = 200;
      sendJson(res, statusCode, product);
      return;
    }

    if (method === "POST" && rawPath === "/orders") {
      const body = await parseBody(req);
      const created = await createOrder(body);
      statusCode = 201;
      sendJson(res, statusCode, created);
      return;
    }

    const orderMatch = rawPath.match(/^\/orders\/(\d+)$/);
    if (method === "GET" && orderMatch) {
      const order = await fetchOrder(Number(orderMatch[1]));
      if (!order) {
        statusCode = 404;
        sendJson(res, statusCode, { error: "order not found" });
        return;
      }
      statusCode = 200;
      sendJson(res, statusCode, order);
      return;
    }

    statusCode = 404;
    sendJson(res, statusCode, { error: "not found" });
  } catch (err) {
    errorText = err && err.message ? err.message : "unknown error";
    if (
      errorText === "invalid json" ||
      errorText.startsWith("invalid ") ||
      errorText.endsWith("not found") ||
      errorText === "insufficient stock" ||
      errorText === "payload too large"
    ) {
      statusCode = 400;
    } else {
      statusCode = 500;
    }
    sendJson(res, statusCode, { error: errorText });
  } finally {
    const tookMs = Date.now() - start;
    logRequest(method, rawPath, statusCode, tookMs, errorText || undefined);
  }
});

initDependencies()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      process.stdout.write(`[api] ${nowIso()} listening on :${PORT}\n`);
    });
  })
  .catch((err) => {
    process.stdout.write(`[api] ${nowIso()} bootstrap failed ERROR: ${err.message}\n`);
    process.exit(1);
  });

process.on("SIGTERM", async () => {
  try {
    if (producer) {
      await producer.disconnect();
    }
    if (redis) {
      await redis.quit();
    }
    if (mysqlPool) {
      await mysqlPool.end();
    }
  } catch (_err) {
    // ignore shutdown errors
  }
  process.exit(0);
});
