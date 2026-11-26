import chatRouter from "./chat.js";
import stockAlertsRouter from "./stock-alerts.js";
import shopRouter from "./shop.js";
import "dotenv/config";
import stocksRouter from "./stocks.js";
import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";

import db from "./db.js";
import sessionStore from "./session-store.js";
import forumRouter from "./forum.js";
import forumSocialRouter from "./forum-social.js";

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDirectory = path.resolve(__dirname, "../public");

const MAX_FILE_SIZE = 25 * 1024 * 1024;

const TASK_CATEGORIES = [
    "Work",
    "Personal",
    "Study",
    "Shopping"
];

const ALLOWED_FILES = {
    ".jpeg": { mime: "image/jpeg", kind: "image" },
    ".jpg": { mime: "image/jpeg", kind: "image" },
    ".png": { mime: "image/png", kind: "image" },
    ".gif": { mime: "image/gif", kind: "image" },
    ".webp": { mime: "image/webp", kind: "image" },
    ".avif": { mime: "image/avif", kind: "image" },

    ".mp4": { mime: "video/mp4", kind: "video" },
    ".webm": { mime: "video/webm", kind: "video" },
    ".mov": { mime: "video/quicktime", kind: "video" },

    ".txt": { mime: "text/plain", kind: "text" },
    ".md": { mime: "text/markdown", kind: "text" },
    ".markdown": { mime: "text/markdown", kind: "text" },
    ".csv": { mime: "text/csv", kind: "text" }
};

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    throw new Error(
        "SESSION_SECRET must be set in .env and contain at least 32 characters."
    );
}

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

app.use(
    session({
        name: "taskspace.sid",
        secret: SESSION_SECRET,
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: 1000 * 60 * 60 * 24
        }
    })
);

app.use(express.static(publicDirectory));

// --------------------------------------------------
// Validation helpers
// --------------------------------------------------

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        createdAt: user.created_at
    };
}

function requireAuth(req, res, next) {
    if (!req.session?.userId) {
        return res.status(401).json({
            error: "Please log in first."
        });
    }

    next();
}

function validUsername(username) {
    return (
        typeof username === "string" &&
        /^[a-zA-Z0-9_]{3,30}$/.test(username)
    );
}

function validPassword(password) {
    return (
        typeof password === "string" &&
        password.length >= 12 &&
        Buffer.byteLength(password, "utf8") <= 72
    );
}

function validTaskTitle(title) {
    return (
        typeof title === "string" &&
        title.trim().length >= 1 &&
        title.trim().length <= 200
    );
}

function validPriority(priority) {
    return ["low", "medium", "high"].includes(priority);
}

function validCategory(category) {
    return TASK_CATEGORIES.includes(category);
}

function validDueDate(value) {
    if (value === null || value === "") {
        return true;
    }

    if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
        return false;
    }

    const date = new Date(`${value}T00:00:00.000Z`);

    return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
    );
}

function validTaskId(value) {
    if (
        typeof value !== "string" &&
        typeof value !== "number"
    ) {
        return null;
    }

    if (typeof value === "string" && !/^[1-9]\d*$/.test(value)) {
        return null;
    }

    const id = Number(value);

    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function getTaskById(id, userId) {
    return db.prepare(`
        SELECT
            id,
            user_id,
            title,
            completed,
            priority,
            due_date,
            category,
            created_at
        FROM tasks
        WHERE id = ? AND user_id = ?
    `).get(id, userId);
}

function getMediaById(id, userId) {
    return db.prepare(`
        SELECT
            id,
            user_id,
            task_id,
            original_name,
            mime_type,
            size_bytes,
            created_at
        FROM media_files
        WHERE id = ? AND user_id = ?
    `).get(id, userId);
}

function validMediaId(value) {
    return validTaskId(value);
}

function cleanFileName(value) {
    if (typeof value !== "string") {
        return "";
    }

    const name = value
        .replace(/\\/g, "/")
        .split("/")
        .pop()
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim();

    return name.slice(0, 200);
}

function decodeFileName(value) {
    if (typeof value !== "string") {
        return "";
    }

    try {
        return cleanFileName(decodeURIComponent(value));
    } catch {
        return "";
    }
}

function validateFileContent(buffer, mime, extension) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return false;
    }

    if (mime === "image/jpeg") {
        return (
            buffer.length >= 3 &&
            buffer[0] === 0xff &&
            buffer[1] === 0xd8 &&
            buffer[2] === 0xff
        );
    }

    if (mime === "image/png") {
        return (
            buffer.length >= 8 &&
            buffer.subarray(0, 8).equals(
                Buffer.from([
                    137, 80, 78, 71, 13, 10, 26, 10
                ])
            )
        );
    }

    if (mime === "image/gif") {
        const signature = buffer.subarray(0, 6).toString("ascii");
        return signature === "GIF87a" || signature === "GIF89a";
    }

    if (mime === "image/webp") {
        return (
            buffer.length >= 12 &&
            buffer.toString("ascii", 0, 4) === "RIFF" &&
            buffer.toString("ascii", 8, 12) === "WEBP"
        );
    }

    if (mime === "image/avif") {
        return (
            buffer.length >= 12 &&
            buffer.toString("ascii", 4, 8) === "ftyp" &&
            ["avif", "avis"].includes(
                buffer.toString("ascii", 8, 12)
            )
        );
    }

    if (mime === "video/mp4" || mime === "video/quicktime") {
        return (
            buffer.length >= 12 &&
            buffer.toString("ascii", 4, 8) === "ftyp"
        );
    }

    if (mime === "video/webm") {
        return (
            buffer.length >= 4 &&
            buffer.subarray(0, 4).equals(
                Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
            )
        );
    }

    if (
        mime === "text/plain" ||
        mime === "text/markdown" ||
        mime === "text/csv"
    ) {
        if (buffer.includes(0)) {
            return false;
        }

        try {
            new TextDecoder("utf-8", { fatal: true }).decode(buffer);
            return true;
        } catch {
            return false;
        }
    }

    return Boolean(ALLOWED_FILES[extension]);
}

// --------------------------------------------------
// Health check
// --------------------------------------------------

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        application: "TaskSpace",
        timestamp: new Date().toISOString()
    });
});

// --------------------------------------------------
app.get("/api/system-status", requireAuth, (req, res) => {
    try {
        db.prepare("SELECT 1 AS ok").get();

        return res.json({
            status: "ok",
            application: "TaskSpace",
            checks: {
                database: "ok",
                sessionConfiguration: "ok"
            },
            uptimeSeconds: Math.floor(process.uptime()),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error("System status database check failed:", error);

        return res.status(503).json({
            status: "degraded",
            application: "TaskSpace",
            checks: {
                database: "error",
                sessionConfiguration: "ok"
            },
            timestamp: new Date().toISOString()
        });
    }
});
// Register
// --------------------------------------------------

app.post("/api/auth/register", async (req, res, next) => {
    try {
        const { username, password } = req.body ?? {};

        if (!validUsername(username)) {
            return res.status(400).json({
                error:
                    "Username must contain 3–30 letters, numbers or underscores."
            });
        }

        if (!validPassword(password)) {
            return res.status(400).json({
                error:
                    "Password must be at least 12 characters and no more than 72 UTF-8 bytes."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        let result;

        try {
            result = db.prepare(`
                INSERT INTO users (username, password_hash)
                VALUES (?, ?)
            `).run(username, passwordHash);
        } catch (error) {
            if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
                return res.status(409).json({
                    error: "That username is already registered."
                });
            }

            throw error;
        }

        req.session.userId = Number(result.lastInsertRowid);

        req.session.save((error) => {
            if (error) {
                return next(error);
            }

            res.status(201).json({
                message: "Account created successfully.",
                user: {
                    id: Number(result.lastInsertRowid),
                    username
                }
            });
        });
    } catch (error) {
        next(error);
    }
});

// --------------------------------------------------
// Login
// --------------------------------------------------

app.post("/api/auth/login", async (req, res, next) => {
    try {
        const { username, password } = req.body ?? {};

        if (
            typeof username !== "string" ||
            typeof password !== "string" ||
            username.length > 30 ||
            Buffer.byteLength(password, "utf8") > 72
        ) {
            return res.status(400).json({
                error: "Invalid username or password."
            });
        }

        const user = db.prepare(`
            SELECT id, username, password_hash, created_at
            FROM users
            WHERE username = ?
        `).get(username);

        const passwordMatches = await bcrypt.compare(
            password,
            user?.password_hash ??
                "$2b$12$invalidhashpaddinginvalidhashpaddinginvalidhashpadding"
        );

        if (!user || !passwordMatches) {
            return res.status(401).json({
                error: "Invalid username or password."
            });
        }

        req.session.regenerate((error) => {
            if (error) {
                return next(error);
            }

            req.session.userId = user.id;

            req.session.save((saveError) => {
                if (saveError) {
                    return next(saveError);
                }

                res.json({
                    message: "Logged in successfully.",
                    user: publicUser(user)
                });
            });
        });
    } catch (error) {
        next(error);
    }
});

// --------------------------------------------------
// Current user
// --------------------------------------------------

app.get("/api/auth/me", (req, res, next) => {
    if (!req.session.userId) {
        return res.json({ user: null });
    }

    const user = db.prepare(`
        SELECT id, username, created_at
        FROM users
        WHERE id = ?
    `).get(req.session.userId);

    if (!user) {
        return req.session.destroy((error) => {
            if (error) {
                return next(error);
            }

            res.clearCookie("taskspace.sid", {
                httpOnly: true,
                sameSite: "lax",
                secure: process.env.NODE_ENV === "production"
            });

            res.json({ user: null });
        });
    }

    res.json({ user: publicUser(user) });
});

// --------------------------------------------------
// Logout
// --------------------------------------------------

app.post("/api/auth/logout", (req, res, next) => {
    if (!req.session) {
        return res.json({ message: "Logged out." });
    }

    req.session.destroy((error) => {
        if (error) {
            return next(error);
        }

        res.clearCookie("taskspace.sid", {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production"
        });

        res.json({ message: "Logged out successfully." });
    });
});

// --------------------------------------------------
// List, search, filter and sort tasks
// --------------------------------------------------

app.get("/api/tasks", requireAuth, (req, res) => {
    const search = typeof req.query.search === "string"
        ? req.query.search.trim().slice(0, 200)
        : "";

    const filter = typeof req.query.filter === "string"
        ? req.query.filter
        : "all";

    const sort = typeof req.query.sort === "string"
        ? req.query.sort
        : "newest";

    const category = typeof req.query.category === "string"
        ? req.query.category
        : "";

    const allowedFilters = [
        "all",
        "pending",
        "completed",
        "high"
    ];

    const allowedSorts = [
        "newest",
        "dueDate",
        "priority"
    ];

    if (!allowedFilters.includes(filter)) {
        return res.status(400).json({ error: "Invalid filter." });
    }

    if (!allowedSorts.includes(sort)) {
        return res.status(400).json({
            error: "Invalid sort option."
        });
    }

    if (category && !validCategory(category)) {
        return res.status(400).json({ error: "Invalid category." });
    }

    const conditions = ["user_id = ?"];
    const parameters = [req.session.userId];

    if (search) {
        conditions.push("title LIKE ? ESCAPE '\\'");
        const escapedSearch = search.replace(/[\\%_]/g, "\\$&");
        parameters.push(`%${escapedSearch}%`);
    }

    if (filter === "pending") {
        conditions.push("completed = 0");
    }

    if (filter === "completed") {
        conditions.push("completed = 1");
    }

    if (filter === "high") {
        conditions.push("priority = 'high'");
    }

    if (category) {
        conditions.push("category = ?");
        parameters.push(category);
    }

    let orderBy = "id DESC";

    if (sort === "dueDate") {
        orderBy =
            "CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC, id DESC";
    } else if (sort === "priority") {
        orderBy = `
            CASE priority
                WHEN 'high' THEN 1
                WHEN 'medium' THEN 2
                WHEN 'low' THEN 3
                ELSE 4
            END,
            id DESC
        `;
    }

    const tasks = db.prepare(`
        SELECT
            id,
            title,
            completed,
            priority,
            due_date,
            category,
            created_at
        FROM tasks
        WHERE ${conditions.join(" AND ")}
        ORDER BY ${orderBy}
    `).all(...parameters);

    res.json({
        tasks,
        categories: TASK_CATEGORIES
    });
});

// --------------------------------------------------
// Create a task
// --------------------------------------------------

app.post("/api/tasks", requireAuth, (req, res) => {
    const body = req.body ?? {};
    const { title } = body;
    const priority = body.priority ?? "medium";
    const dueDate = body.due_date ?? body.dueDate ?? null;
    const category = body.category ?? "Personal";

    if (!validTaskTitle(title)) {
        return res.status(400).json({
            error: "Task title must contain 1–200 characters."
        });
    }

    if (!validPriority(priority)) {
        return res.status(400).json({
            error: "Priority must be low, medium or high."
        });
    }

    if (!validDueDate(dueDate)) {
        return res.status(400).json({
            error: "Due date must be a valid YYYY-MM-DD date or null."
        });
    }

    if (!validCategory(category)) {
        return res.status(400).json({
            error: "Category must be Work, Personal, Study or Shopping."
        });
    }

    const result = db.prepare(`
        INSERT INTO tasks (
            user_id,
            title,
            priority,
            due_date,
            category
        )
        VALUES (?, ?, ?, ?, ?)
    `).run(
        req.session.userId,
        title.trim(),
        priority,
        dueDate || null,
        category
    );

    res.status(201).json({
        task: getTaskById(
            Number(result.lastInsertRowid),
            req.session.userId
        )
    });
});

// --------------------------------------------------
// Edit a task
// --------------------------------------------------

app.patch("/api/tasks/:id", requireAuth, (req, res) => {
    const id = validTaskId(req.params.id);

    if (!id) {
        return res.status(400).json({ error: "Invalid task ID." });
    }

    const body = req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({
            error: "A JSON object is required."
        });
    }

    const allowedKeys = new Set([
        "title",
        "completed",
        "priority",
        "due_date",
        "dueDate",
        "category"
    ]);

    const keys = Object.keys(body);

    if (
        keys.length === 0 ||
        keys.some((key) => !allowedKeys.has(key))
    ) {
        return res.status(400).json({
            error: "Provide valid task fields to update."
        });
    }

    if (
        Object.hasOwn(body, "due_date") &&
        Object.hasOwn(body, "dueDate")
    ) {
        return res.status(400).json({
            error: "Provide due_date or dueDate, not both."
        });
    }

    const updates = [];
    const parameters = [];

    if (Object.hasOwn(body, "title")) {
        if (!validTaskTitle(body.title)) {
            return res.status(400).json({
                error: "Task title must contain 1–200 characters."
            });
        }

        updates.push("title = ?");
        parameters.push(body.title.trim());
    }

    if (Object.hasOwn(body, "completed")) {
        if (typeof body.completed !== "boolean") {
            return res.status(400).json({
                error: "Completed must be true or false."
            });
        }

        updates.push("completed = ?");
        parameters.push(body.completed ? 1 : 0);
    }

    if (Object.hasOwn(body, "priority")) {
        if (!validPriority(body.priority)) {
            return res.status(400).json({
                error: "Priority must be low, medium or high."
            });
        }

        updates.push("priority = ?");
        parameters.push(body.priority);
    }

    if (Object.hasOwn(body, "category")) {
        if (!validCategory(body.category)) {
            return res.status(400).json({
                error: "Category must be Work, Personal, Study or Shopping."
            });
        }

        updates.push("category = ?");
        parameters.push(body.category);
    }

    const hasDueDate =
        Object.hasOwn(body, "due_date") ||
        Object.hasOwn(body, "dueDate");

    if (hasDueDate) {
        const dueDate = Object.hasOwn(body, "due_date")
            ? body.due_date
            : body.dueDate;

        if (!validDueDate(dueDate)) {
            return res.status(400).json({
                error: "Due date must be a valid YYYY-MM-DD date or null."
            });
        }

        updates.push("due_date = ?");
        parameters.push(dueDate || null);
    }

    parameters.push(id, req.session.userId);

    const result = db.prepare(`
        UPDATE tasks
        SET ${updates.join(", ")}
        WHERE id = ? AND user_id = ?
    `).run(...parameters);

    if (result.changes === 0) {
        return res.status(404).json({ error: "Task not found." });
    }

    res.json({
        task: getTaskById(id, req.session.userId)
    });
});

// --------------------------------------------------
// Delete a task
// --------------------------------------------------

app.delete("/api/tasks/:id", requireAuth, (req, res) => {
    const id = validTaskId(req.params.id);

    if (!id) {
        return res.status(400).json({ error: "Invalid task ID." });
    }

    const result = db.prepare(`
        DELETE FROM tasks
        WHERE id = ? AND user_id = ?
    `).run(id, req.session.userId);

    if (result.changes === 0) {
        return res.status(404).json({ error: "Task not found." });
    }

    res.json({ message: "Task deleted successfully." });
});

// ==================================================
// MEDIA LIBRARY API
// ==================================================

// List metadata only; never return BLOB data in the listing.
app.get("/api/media", requireAuth, (req, res) => {
    const taskIdValue = req.query.taskId;
    let taskId = null;

    if (taskIdValue !== undefined && taskIdValue !== "all") {
        taskId = validTaskId(taskIdValue);

        if (!taskId) {
            return res.status(400).json({ error: "Invalid task ID." });
        }

        const task = getTaskById(taskId, req.session.userId);

        if (!task) {
            return res.status(404).json({ error: "Task not found." });
        }
    }

    let media;

    if (taskId !== null) {
        media = db.prepare(`
            SELECT
                m.id,
                m.task_id,
                m.original_name,
                m.mime_type,
                m.size_bytes,
                m.created_at,
                t.title AS task_title
            FROM media_files AS m
            LEFT JOIN tasks AS t ON t.id = m.task_id
            WHERE m.user_id = ? AND m.task_id = ?
            ORDER BY m.created_at DESC, m.id DESC
        `).all(req.session.userId, taskId);
    } else {
        media = db.prepare(`
            SELECT
                m.id,
                m.task_id,
                m.original_name,
                m.mime_type,
                m.size_bytes,
                m.created_at,
                t.title AS task_title
            FROM media_files AS m
            LEFT JOIN tasks AS t ON t.id = m.task_id
            WHERE m.user_id = ?
            ORDER BY m.created_at DESC, m.id DESC
        `).all(req.session.userId);
    }

    res.json({
        media,
        maxFileSize: MAX_FILE_SIZE
    });
});

// Upload one file as raw bytes.
app.post(
    "/api/media",
    requireAuth,
    express.raw({
        type: "application/octet-stream",
        limit: MAX_FILE_SIZE
    }),
    (req, res) => {
        const buffer = req.body;

        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
            return res.status(400).json({
                error: "Select a non-empty file to upload."
            });
        }

        if (buffer.length > MAX_FILE_SIZE) {
            return res.status(413).json({
                error: "Each file must be 25 MiB or smaller."
            });
        }

        const originalName = decodeFileName(req.get("X-File-Name"));

        if (!originalName || originalName.length > 200) {
            return res.status(400).json({
                error: "The file name is invalid."
            });
        }

        const extension = path.extname(originalName).toLowerCase();
        const fileDefinition = ALLOWED_FILES[extension];

        if (!fileDefinition) {
            return res.status(415).json({
                error:
                    "Unsupported file type. Upload an image, video, TXT, Markdown or CSV file."
            });
        }

        const suppliedMime = String(req.get("X-File-Type") || "")
            .split(";")[0]
            .trim()
            .toLowerCase();

        if (suppliedMime !== fileDefinition.mime) {
            return res.status(415).json({
                error: "The file type does not match its extension."
            });
        }

        if (
            !validateFileContent(
                buffer,
                fileDefinition.mime,
                extension
            )
        ) {
            return res.status(415).json({
                error:
                    "The file contents do not match an accepted file format."
            });
        }

        let taskId = null;
        const taskIdHeader = req.get("X-Task-Id");

        if (taskIdHeader && taskIdHeader !== "null") {
            taskId = validTaskId(taskIdHeader);

            if (!taskId) {
                return res.status(400).json({
                    error: "Invalid task ID."
                });
            }

            const task = getTaskById(taskId, req.session.userId);

            if (!task) {
                return res.status(404).json({
                    error: "Task not found or you do not own it."
                });
            }
        }

        const result = db.prepare(`
            INSERT INTO media_files (
                user_id,
                task_id,
                original_name,
                mime_type,
                size_bytes,
                file_data
            )
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            req.session.userId,
            taskId,
            originalName,
            fileDefinition.mime,
            buffer.length,
            buffer
        );

        res.status(201).json({
            message: "File uploaded successfully.",
            media: getMediaById(
                Number(result.lastInsertRowid),
                req.session.userId
            )
        });
    }
);

// Preview images and videos. Text files are returned as plain text.
app.get("/api/media/:id/content", requireAuth, (req, res) => {
    const id = validMediaId(req.params.id);

    if (!id) {
        return res.status(400).json({ error: "Invalid media ID." });
    }

    const media = db.prepare(`
        SELECT original_name, mime_type, size_bytes, file_data
        FROM media_files
        WHERE id = ? AND user_id = ?
    `).get(id, req.session.userId);

    if (!media) {
        return res.status(404).json({ error: "File not found." });
    }

    const definition = ALLOWED_FILES[
        path.extname(media.original_name).toLowerCase()
    ];

    if (!definition || definition.mime !== media.mime_type) {
        return res.status(415).json({ error: "Unsupported file type." });
    }

    res.set({
        "Content-Type": definition.kind === "text"
            ? "text/plain; charset=utf-8"
            : media.mime_type,
        "Content-Length": String(media.size_bytes),
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store"
    });

    res.send(media.file_data);
});

// Download a file as an attachment.
app.get("/api/media/:id/download", requireAuth, (req, res) => {
    const id = validMediaId(req.params.id);

    if (!id) {
        return res.status(400).json({ error: "Invalid media ID." });
    }

    const media = db.prepare(`
        SELECT original_name, mime_type, size_bytes, file_data
        FROM media_files
        WHERE id = ? AND user_id = ?
    `).get(id, req.session.userId);

    if (!media) {
        return res.status(404).json({ error: "File not found." });
    }

    res.set({
        "Content-Type": media.mime_type,
        "Content-Length": String(media.size_bytes),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store"
    });

    res.attachment(media.original_name);
    res.send(media.file_data);
});

// Delete a file from the library and SQLite.
app.delete("/api/media/:id", requireAuth, (req, res) => {
    const id = validMediaId(req.params.id);

    if (!id) {
        return res.status(400).json({ error: "Invalid media ID." });
    }

    const result = db.prepare(`
        DELETE FROM media_files
        WHERE id = ? AND user_id = ?
    `).run(id, req.session.userId);

    if (result.changes === 0) {
        return res.status(404).json({ error: "File not found." });
    }

    res.json({ message: "File deleted successfully." });
});

// ==================================================
// FORUM API
// ==================================================

// The router defines /categories, /posts and /comments routes.
// Authentication for forum write operations is enforced in forum.js.
app.use("/api/forum", forumRouter);
app.use("/api/forum-social", forumSocialRouter);
app.use("/api/stocks", stocksRouter);
app.use("/api/stock-alerts", stockAlertsRouter);
app.use("/api/shop", shopRouter);
app.use("/api/chat", requireAuth, chatRouter);
// --------------------------------------------------
// Not found and error handling
// --------------------------------------------------

app.use("/api", (req, res) => {
    res.status(404).json({
        error: "API endpoint not found."
    });
});

app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    if (error.type === "entity.too.large" || error.status === 413) {
        return res.status(413).json({
            error: "Request body or uploaded file is too large."
        });
    }

    console.error(error);

    res.status(500).json({
        error: "An unexpected server error occurred."
    });
});

// --------------------------------------------------
// Start server and close cleanly
// --------------------------------------------------

const server = app.listen(PORT, () => {
    console.log(`TaskSpace is running at http://localhost:${PORT}`);
});

let shuttingDown = false;

function shutdown() {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    server.close(() => {
        db.close();
        process.exit(0);
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

