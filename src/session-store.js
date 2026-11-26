
import session from "express-session";
import db from "./db.js";

const SESSION_LIFETIME = 24 * 60 * 60 * 1000;

// Create a dedicated table for Express sessions.
// Existing TaskSpace tables are not modified.
db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expire INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expire
        ON sessions(expire);
`);

const statements = {
    get: db.prepare(`
        SELECT sess
        FROM sessions
        WHERE sid = ? AND expire > ?
    `),

    set: db.prepare(`
        INSERT INTO sessions (sid, sess, expire)
        VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET
            sess = excluded.sess,
            expire = excluded.expire
    `),

    destroy: db.prepare(`
        DELETE FROM sessions WHERE sid = ?
    `),

    touch: db.prepare(`
        UPDATE sessions
        SET sess = ?, expire = ?
        WHERE sid = ?
    `),

    removeExpired: db.prepare(`
        DELETE FROM sessions WHERE expire <= ?
    `)
};

class SQLiteSessionStore extends session.Store {
    get(sid, callback) {
        try {
            const now = Date.now();
            const row = statements.get.get(sid, now);

            if (!row) {
                callback(null, null);
                return;
            }

            callback(null, JSON.parse(row.sess));
        } catch (error) {
            callback(error);
        }
    }

    set(sid, sessionData, callback = () => {}) {
        try {
            const expires = sessionData.cookie?.expires
                ? new Date(sessionData.cookie.expires).getTime()
                : Date.now() + SESSION_LIFETIME;

            if (!Number.isFinite(expires)) {
                throw new Error("Invalid session expiration.");
            }

            statements.set.run(
                sid,
                JSON.stringify(sessionData),
                expires
            );

            statements.removeExpired.run(Date.now());

            callback(null);
        } catch (error) {
            callback(error);
        }
    }

    destroy(sid, callback = () => {}) {
        try {
            statements.destroy.run(sid);
            callback(null);
        } catch (error) {
            callback(error);
        }
    }

    touch(sid, sessionData, callback = () => {}) {
        try {
            const expires = sessionData.cookie?.expires
                ? new Date(sessionData.cookie.expires).getTime()
                : Date.now() + SESSION_LIFETIME;

            if (!Number.isFinite(expires)) {
                throw new Error("Invalid session expiration.");
            }

            statements.touch.run(
                JSON.stringify(sessionData),
                expires,
                sid
            );

            callback(null);
        } catch (error) {
            callback(error);
        }
    }
}

const sessionStore = new SQLiteSessionStore();

export default sessionStore;
