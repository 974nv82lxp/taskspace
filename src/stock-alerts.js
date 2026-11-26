import express from "express";
import db from "./db.js";

const router = express.Router();

const SYMBOL_PATTERN = /^[A-Z0-9.^_-]{1,20}$/;
const MAX_ALERTS_PER_USER = 50;

// Preserve all existing tables and data.
db.exec(`
    CREATE TABLE IF NOT EXISTS stock_price_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        condition TEXT NOT NULL
            CHECK (condition IN ('above', 'below')),
        target_price REAL NOT NULL
            CHECK (target_price > 0),
        enabled INTEGER NOT NULL DEFAULT 1
            CHECK (enabled IN (0, 1)),
        triggered INTEGER NOT NULL DEFAULT 0
            CHECK (triggered IN (0, 1)),
        last_price REAL,
        triggered_at TEXT,
        created_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        FOREIGN KEY (user_id)
            REFERENCES users(id)
            ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS
        idx_stock_price_alerts_user_created
    ON stock_price_alerts(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS
        idx_stock_price_alerts_enabled
    ON stock_price_alerts(enabled, triggered);
`);

function requireAuth(req, res, next) {
    if (!req.session?.userId) {
        return res.status(401).json({
            error: "Please log in to manage stock price alerts."
        });
    }

    next();
}

function validId(value) {
    if (
        typeof value !== "string" ||
        !/^[1-9]\d*$/.test(value)
    ) {
        return null;
    }

    const id = Number(value);

    return Number.isSafeInteger(id) ? id : null;
}

function normalizeSymbol(value) {
    if (typeof value !== "string") {
        return null;
    }

    const symbol = value.trim().toUpperCase();

    return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

function publicAlert(alert) {
    return {
        id: alert.id,
        symbol: alert.symbol,
        condition: alert.condition,
        targetPrice: alert.target_price,
        enabled: Boolean(alert.enabled),
        triggered: Boolean(alert.triggered),
        lastPrice: alert.last_price,
        triggeredAt: alert.triggered_at,
        createdAt: alert.created_at
    };
}

function getUserAlert(id, userId) {
    return db.prepare(`
        SELECT *
        FROM stock_price_alerts
        WHERE id = ? AND user_id = ?
    `).get(id, userId);
}

router.use(requireAuth);

// List only the signed-in user's alerts.
router.get("/", (req, res) => {
    const alerts = db.prepare(`
        SELECT *
        FROM stock_price_alerts
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
    `).all(req.session.userId);

    res.json({
        alerts: alerts.map(publicAlert),
        maxAlerts: MAX_ALERTS_PER_USER
    });
});

// Create an alert.
router.post("/", (req, res) => {
    const body = req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({
            error: "A JSON object is required."
        });
    }

    const symbol = normalizeSymbol(body.symbol);
    const condition = body.condition;
    const targetPrice = body.targetPrice;

    if (!symbol) {
        return res.status(400).json({
            error: "Enter a valid stock symbol."
        });
    }

    if (!["above", "below"].includes(condition)) {
        return res.status(400).json({
            error: "Condition must be above or below."
        });
    }

    if (
        typeof targetPrice !== "number" ||
        !Number.isFinite(targetPrice) ||
        targetPrice <= 0 ||
        targetPrice > 1_000_000_000
    ) {
        return res.status(400).json({
            error: "Target price must be a positive number."
        });
    }

    const count = db.prepare(`
        SELECT COUNT(*) AS count
        FROM stock_price_alerts
        WHERE user_id = ?
    `).get(req.session.userId).count;

    if (count >= MAX_ALERTS_PER_USER) {
        return res.status(400).json({
            error: `You can have up to ${MAX_ALERTS_PER_USER} alerts.`
        });
    }

    const result = db.prepare(`
        INSERT INTO stock_price_alerts (
            user_id,
            symbol,
            condition,
            target_price
        )
        VALUES (?, ?, ?, ?)
    `).run(
        req.session.userId,
        symbol,
        condition,
        targetPrice
    );

    const alert = getUserAlert(
        Number(result.lastInsertRowid),
        req.session.userId
    );

    res.status(201).json({
        message: "Price alert created.",
        alert: publicAlert(alert)
    });
});

// Enable or disable an alert.
router.patch("/:id", (req, res) => {
    const id = validId(req.params.id);

    if (!id) {
        return res.status(400).json({
            error: "Invalid alert ID."
        });
    }

    const body = req.body;

    if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        typeof body.enabled !== "boolean" ||
        Object.keys(body).length !== 1
    ) {
        return res.status(400).json({
            error: "Provide only enabled: true or enabled: false."
        });
    }

    const alert = getUserAlert(id, req.session.userId);

    if (!alert) {
        return res.status(404).json({
            error: "Price alert not found."
        });
    }

    // Re-enabling an alert resets its triggered state.
    db.prepare(`
        UPDATE stock_price_alerts
        SET enabled = ?,
            triggered = CASE WHEN ? = 1 THEN 0 ELSE triggered END,
            triggered_at = CASE WHEN ? = 1 THEN NULL ELSE triggered_at END
        WHERE id = ? AND user_id = ?
    `).run(
        body.enabled ? 1 : 0,
        body.enabled ? 1 : 0,
        body.enabled ? 1 : 0,
        id,
        req.session.userId
    );

    res.json({
        message: body.enabled ? "Alert enabled." : "Alert disabled.",
        alert: publicAlert(getUserAlert(id, req.session.userId))
    });
});

// Delete only an alert belonging to the signed-in user.
router.delete("/:id", (req, res) => {
    const id = validId(req.params.id);

    if (!id) {
        return res.status(400).json({
            error: "Invalid alert ID."
        });
    }

    const result = db.prepare(`
        DELETE FROM stock_price_alerts
        WHERE id = ? AND user_id = ?
    `).run(id, req.session.userId);

    if (result.changes === 0) {
        return res.status(404).json({
            error: "Price alert not found."
        });
    }

    res.json({ message: "Price alert deleted." });
});

export default router;
