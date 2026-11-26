import express from "express";
import db from "./db.js";

const router = express.Router();

const MAX_QUANTITY = 99;
const MAX_CART_ITEMS = 50;

/*
 * TaskSpace Shop
 *
 * Prices are stored as whole øre to avoid floating-point rounding.
 * Product records are seeded only when their SKU does not already exist.
 * Existing TaskSpace tables and records are not replaced.
 */
db.exec(`
    CREATE TABLE IF NOT EXISTS shop_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price_ore INTEGER NOT NULL CHECK (price_ore >= 0),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        )
    );

    CREATE TABLE IF NOT EXISTS shopping_cart_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
        created_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        updated_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        UNIQUE(user_id, product_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES shop_products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_shop_cart_user
        ON shopping_cart_items(user_id);

    CREATE TABLE IF NOT EXISTS shop_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'demo_order'
            CHECK (status IN ('demo_order', 'cancelled')),
        total_ore INTEGER NOT NULL CHECK (total_ore >= 0),
        currency TEXT NOT NULL DEFAULT 'NOK',
        created_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shop_order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER,
        product_name TEXT NOT NULL,
        unit_price_ore INTEGER NOT NULL CHECK (unit_price_ore >= 0),
        quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
        line_total_ore INTEGER NOT NULL CHECK (line_total_ore >= 0),
        FOREIGN KEY (order_id) REFERENCES shop_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES shop_products(id)
            ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_shop_orders_user
        ON shop_orders(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_shop_order_items_order
        ON shop_order_items(order_id);
`);

// Demonstration products. INSERT OR IGNORE keeps existing catalogue data.
const seedProducts = db.prepare(`
    INSERT OR IGNORE INTO shop_products
        (sku, name, description, price_ore)
    VALUES (?, ?, ?, ?)
`);

const seedDemoProducts = db.transaction(() => {
    const products = [
        [
            "TS-PLANNER-001",
            "Task Planner",
            "A simple paper planner for organising your daily priorities.",
            14900
        ],
        [
            "TS-DESK-002",
            "Desk Organiser",
            "Keep pens, notes and small work essentials together.",
            19900
        ],
        [
            "TS-TIMER-003",
            "Focus Timer",
            "A demonstration product for focused work sessions.",
            24900
        ],
        [
            "TS-NOTEBOOK-004",
            "Idea Notebook",
            "A notebook for capturing plans, ideas and project notes.",
            9900
        ]
    ];

    for (const product of products) {
        seedProducts.run(...product);
    }
});

seedDemoProducts();

function requireShopAuth(req, res, next) {
    if (!req.session?.userId) {
        return res.status(401).json({
            error: "Please log in to use your shopping cart."
        });
    }

    next();
}

function validPositiveId(value) {
    if (
        typeof value !== "string" ||
        !/^[1-9]\d*$/.test(value)
    ) {
        return null;
    }

    const id = Number(value);

    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validQuantity(value) {
    return (
        Number.isInteger(value) &&
        value >= 1 &&
        value <= MAX_QUANTITY
    );
}

function publicProduct(product) {
    return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        description: product.description,
        priceOre: product.price_ore,
        currency: "NOK"
    };
}

function getCart(userId) {
    const items = db.prepare(`
        SELECT
            p.id AS product_id,
            p.sku,
            p.name,
            p.description,
            p.price_ore,
            c.quantity,
            c.updated_at
        FROM shopping_cart_items AS c
        JOIN shop_products AS p ON p.id = c.product_id
        WHERE c.user_id = ? AND p.active = 1
        ORDER BY c.created_at ASC, c.id ASC
    `).all(userId);

    const totalOre = items.reduce(
        (sum, item) => sum + item.price_ore * item.quantity,
        0
    );

    return {
        items: items.map((item) => ({
            productId: item.product_id,
            sku: item.sku,
            name: item.name,
            description: item.description,
            priceOre: item.price_ore,
            quantity: item.quantity,
            lineTotalOre: item.price_ore * item.quantity
        })),
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
        totalOre,
        currency: "NOK"
    };
}

// Public catalogue; no login is required to browse products.
router.get("/products", (req, res) => {
    const products = db.prepare(`
        SELECT id, sku, name, description, price_ore
        FROM shop_products
        WHERE active = 1
        ORDER BY id ASC
    `).all();

    res.json({
        products: products.map(publicProduct),
        currency: "NOK"
    });
});

// Read the logged-in user's cart.
router.get("/cart", requireShopAuth, (req, res) => {
    res.json({ cart: getCart(req.session.userId) });
});

// Add a product, or increase its existing quantity.
router.post("/cart", requireShopAuth, (req, res) => {
    const body = req.body ?? {};
    const productId = validPositiveId(String(body.productId ?? ""));
    const quantity = body.quantity === undefined ? 1 : body.quantity;

    if (!productId || !validQuantity(quantity)) {
        return res.status(400).json({
            error: "Provide a valid product ID and quantity from 1 to 99."
        });
    }

    const product = db.prepare(`
        SELECT id
        FROM shop_products
        WHERE id = ? AND active = 1
    `).get(productId);

    if (!product) {
        return res.status(404).json({ error: "Product not found." });
    }

    const userId = req.session.userId;
    const existing = db.prepare(`
        SELECT quantity
        FROM shopping_cart_items
        WHERE user_id = ? AND product_id = ?
    `).get(userId, productId);

    const currentDistinctItems = db.prepare(`
        SELECT COUNT(*) AS count
        FROM shopping_cart_items
        WHERE user_id = ?
    `).get(userId).count;

    if (!existing && currentDistinctItems >= MAX_CART_ITEMS) {
        return res.status(400).json({
            error: `Your cart can contain up to ${MAX_CART_ITEMS} different products.`
        });
    }

    const newQuantity = (existing?.quantity ?? 0) + quantity;

    if (!validQuantity(newQuantity)) {
        return res.status(400).json({
            error: `The maximum quantity per product is ${MAX_QUANTITY}.`
        });
    }

    db.prepare(`
        INSERT INTO shopping_cart_items
            (user_id, product_id, quantity, updated_at)
        VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ON CONFLICT(user_id, product_id)
        DO UPDATE SET
            quantity = excluded.quantity,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `).run(userId, productId, newQuantity);

    res.status(200).json({
        message: "Cart updated.",
        cart: getCart(userId)
    });
});

// Set a product's quantity.
router.patch("/cart/:productId", requireShopAuth, (req, res) => {
    const productId = validPositiveId(req.params.productId);
    const quantity = req.body?.quantity;

    if (!productId || !validQuantity(quantity)) {
        return res.status(400).json({
            error: "Provide a valid product ID and quantity from 1 to 99."
        });
    }

    const result = db.prepare(`
        UPDATE shopping_cart_items
        SET quantity = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE user_id = ? AND product_id = ?
    `).run(quantity, req.session.userId, productId);

    if (result.changes === 0) {
        return res.status(404).json({
            error: "That product is not in your cart."
        });
    }

    res.json({ cart: getCart(req.session.userId) });
});

// Remove a product from the logged-in user's cart.
router.delete("/cart/:productId", requireShopAuth, (req, res) => {
    const productId = validPositiveId(req.params.productId);

    if (!productId) {
        return res.status(400).json({ error: "Invalid product ID." });
    }

    db.prepare(`
        DELETE FROM shopping_cart_items
        WHERE user_id = ? AND product_id = ?
    `).run(req.session.userId, productId);

    res.json({
        message: "Product removed from cart.",
        cart: getCart(req.session.userId)
    });
});

// Demo checkout: saves an order and its price snapshots.
// This does not charge a payment method or create a real shipment.
const createDemoOrder = db.transaction((userId) => {
    const cart = getCart(userId);

    if (cart.items.length === 0) {
        return { error: "Your shopping cart is empty." };
    }

    const orderResult = db.prepare(`
        INSERT INTO shop_orders (user_id, status, total_ore, currency)
        VALUES (?, 'demo_order', ?, 'NOK')
    `).run(userId, cart.totalOre);

    const orderId = Number(orderResult.lastInsertRowid);

    const insertItem = db.prepare(`
        INSERT INTO shop_order_items (
            order_id,
            product_id,
            product_name,
            unit_price_ore,
            quantity,
            line_total_ore
        )
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const item of cart.items) {
        insertItem.run(
            orderId,
            item.productId,
            item.name,
            item.priceOre,
            item.quantity,
            item.lineTotalOre
        );
    }

    db.prepare(`
        DELETE FROM shopping_cart_items
        WHERE user_id = ?
    `).run(userId);

    return {
        order: {
            id: orderId,
            status: "demo_order",
            totalOre: cart.totalOre,
            currency: "NOK",
            items: cart.items
        }
    };
});

router.post("/checkout", requireShopAuth, (req, res) => {
    const result = createDemoOrder(req.session.userId);

    if (result.error) {
        return res.status(400).json({ error: result.error });
    }

    res.status(201).json({
        message: "Demo order saved. No payment was taken.",
        order: result.order,
        cart: getCart(req.session.userId)
    });
});

// View the logged-in user's order history.
router.get("/orders", requireShopAuth, (req, res) => {
    const orders = db.prepare(`
        SELECT id, status, total_ore, currency, created_at
        FROM shop_orders
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 50
    `).all(req.session.userId);

    res.json({
        orders: orders.map((order) => ({
            id: order.id,
            status: order.status,
            totalOre: order.total_ore,
            currency: order.currency,
            createdAt: order.created_at
        }))
    });
});

export default router;
