
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const databaseDirectory = path.resolve(currentDirectory, "../data");
const databasePath = process.env.TASKSPACE_DB_PATH
    ? path.resolve(process.env.TASKSPACE_DB_PATH)
    : path.join(databaseDirectory, "taskspace.db");

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

// --------------------------------------------------
// Original users and tasks tables
// --------------------------------------------------

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        )
    );

    CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0
            CHECK (completed IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        FOREIGN KEY (user_id)
            REFERENCES users(id)
            ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_user_id
        ON tasks(user_id);
`);

// --------------------------------------------------
// Safe database migration helpers
// --------------------------------------------------

function getColumns(tableName) {
    const allowedTables = ["users", "tasks"];

    if (!allowedTables.includes(tableName)) {
        throw new Error("Unsupported database table.");
    }

    return db.prepare(`PRAGMA table_info(${tableName})`).all();
}

function addColumnIfMissing(tableName, columnName, definition) {
    const columns = getColumns(tableName);

    if (!columns.some((column) => column.name === columnName)) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);

        console.log(
            `Database migration: added ${tableName}.${columnName}`
        );
    }
}

// --------------------------------------------------
// User and administrator migrations
// --------------------------------------------------

// Existing users remain ordinary users until an administrator
// explicitly promotes an account through a trusted local process.
addColumnIfMissing(
    "users",
    "role",
    "role TEXT NOT NULL DEFAULT 'user' " +
        "CHECK (role IN ('user', 'admin'))"
);

addColumnIfMissing(
    "users",
    "is_suspended",
    "is_suspended INTEGER NOT NULL DEFAULT 0 " +
        "CHECK (is_suspended IN (0, 1))"
);

db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_role
        ON users(role);

    CREATE INDEX IF NOT EXISTS idx_users_suspended
        ON users(is_suspended);
`);

// --------------------------------------------------
// Safe task-table migrations
// --------------------------------------------------

addColumnIfMissing(
    "tasks",
    "priority",
    "priority TEXT NOT NULL DEFAULT 'medium' " +
        "CHECK (priority IN ('low', 'medium', 'high'))"
);

addColumnIfMissing(
    "tasks",
    "due_date",
    "due_date TEXT DEFAULT NULL"
);

addColumnIfMissing(
    "tasks",
    "category",
    "category TEXT NOT NULL DEFAULT 'Personal' " +
        "CHECK (category IN ('Work', 'Personal', 'Study', 'Shopping'))"
);

// --------------------------------------------------
// Task indexes
// --------------------------------------------------

db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_user_priority
        ON tasks(user_id, priority);

    CREATE INDEX IF NOT EXISTS idx_tasks_user_due_date
        ON tasks(user_id, due_date);

    CREATE INDEX IF NOT EXISTS idx_tasks_user_category
        ON tasks(user_id, category);
`);

// --------------------------------------------------
// Media library
//
// Uploaded files are stored as SQLite BLOBs.
// Deleting a user deletes their media.
// Deleting a task leaves its media in the library,
// with task_id set to NULL.
// --------------------------------------------------

db.exec(`
    CREATE TABLE IF NOT EXISTS media_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        task_id INTEGER DEFAULT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL
            CHECK (size_bytes >= 0),
        file_data BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        FOREIGN KEY (user_id)
            REFERENCES users(id)
            ON DELETE CASCADE,
        FOREIGN KEY (task_id)
            REFERENCES tasks(id)
            ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_media_user_created
        ON media_files(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_media_user_task
        ON media_files(user_id, task_id);
`);

// --------------------------------------------------
// Administrator audit log
// --------------------------------------------------

db.exec(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        admin_user_id INTEGER DEFAULT NULL,

        action TEXT NOT NULL,

        target_type TEXT NOT NULL,

        target_id TEXT DEFAULT NULL,

        details_json TEXT DEFAULT NULL,

        ip_address TEXT DEFAULT NULL,

        created_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),

        FOREIGN KEY (admin_user_id)
            REFERENCES users(id)
            ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_admin_audit_created
        ON admin_audit_log(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_admin_audit_action
        ON admin_audit_log(action);

    CREATE INDEX IF NOT EXISTS idx_admin_audit_admin
        ON admin_audit_log(admin_user_id);
`);

console.log(`SQLite database connected: ${databasePath}`);

export default db;

