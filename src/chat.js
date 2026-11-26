
import express from "express";
import db from "./db.js";

const router = express.Router();

const MAX_MESSAGE_LENGTH = 4000;
const MAX_MESSAGES_PER_REQUEST = 100;
const USER_SEARCH_LIMIT = 30;

function getAuthenticatedUser(req) {
    if (!req.session?.userId) {
        return null;
    }

    return db.prepare(`
        SELECT id, username, is_suspended
        FROM users
        WHERE id = ?
    `).get(req.session.userId);
}

function requireChatAuth(req, res, next) {
    const user = getAuthenticatedUser(req);

    if (!user) {
        return res.status(401).json({
            error: "Please log in to use chat."
        });
    }

    if (user.is_suspended) {
        return res.status(403).json({
            error: "Your account is suspended."
        });
    }

    req.chatUser = user;
    next();
}

function validId(value) {
    const id = Number(value);

    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function getConversationForUser(conversationId, userId) {
    return db.prepare(`
        SELECT id, user_one_id, user_two_id
        FROM chat_conversations
        WHERE id = ?
          AND (user_one_id = ? OR user_two_id = ?)
    `).get(conversationId, userId, userId);
}

// Create chat tables in the existing TaskSpace SQLite database.
// Existing users, tasks, posts, and other application data are preserved.
db.exec(`
    CREATE TABLE IF NOT EXISTS chat_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_one_id INTEGER NOT NULL,
        user_two_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (user_one_id)
            REFERENCES users(id) ON DELETE CASCADE,

        FOREIGN KEY (user_two_id)
            REFERENCES users(id) ON DELETE CASCADE,

        CHECK (user_one_id < user_two_id),
        UNIQUE (user_one_id, user_two_id)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (conversation_id)
            REFERENCES chat_conversations(id) ON DELETE CASCADE,

        FOREIGN KEY (sender_id)
            REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_read_state (
        conversation_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        last_read_message_id INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        PRIMARY KEY (conversation_id, user_id),

        FOREIGN KEY (conversation_id)
            REFERENCES chat_conversations(id) ON DELETE CASCADE,

        FOREIGN KEY (user_id)
            REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
        ON chat_messages(conversation_id, id);

    CREATE INDEX IF NOT EXISTS idx_chat_messages_sender
        ON chat_messages(sender_id, conversation_id);

    CREATE INDEX IF NOT EXISTS idx_chat_conversations_users
        ON chat_conversations(user_one_id, user_two_id);
`);

router.use(requireChatAuth);

// Search registered users to start a private conversation.
router.get("/users", (req, res) => {
    const search = typeof req.query.q === "string"
        ? req.query.q.trim().slice(0, 30)
        : "";

    const users = db.prepare(`
        SELECT id, username
        FROM users
        WHERE id != ?
          AND COALESCE(is_suspended, 0) = 0
          AND username LIKE ? ESCAPE '\\'
        ORDER BY username COLLATE NOCASE
        LIMIT ?
    `).all(
        req.chatUser.id,
        `%${search.replace(/[\\%_]/g, "\\$&")}%`,
        USER_SEARCH_LIMIT
    );

    res.json({ users });
});

// Return all private conversations for the logged-in user.
router.get("/conversations", (req, res) => {
    const userId = req.chatUser.id;

    // Ensure both participants have read-state rows, including
    // conversations created before a read-state row was added.
    db.prepare(`
        INSERT OR IGNORE INTO chat_read_state
            (conversation_id, user_id)
        SELECT id, user_one_id FROM chat_conversations
        WHERE user_one_id = ? OR user_two_id = ?

        UNION

        SELECT id, user_two_id FROM chat_conversations
        WHERE user_one_id = ? OR user_two_id = ?
    `).run(userId, userId, userId, userId);

    const conversations = db.prepare(`
        SELECT
            c.id,
            c.created_at AS createdAt,
            c.updated_at AS updatedAt,
            CASE
                WHEN c.user_one_id = ? THEN u2.id
                ELSE u1.id
            END AS otherUserId,
            CASE
                WHEN c.user_one_id = ? THEN u2.username
                ELSE u1.username
            END AS otherUsername,
            (
                SELECT m.body
                FROM chat_messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.id DESC
                LIMIT 1
            ) AS lastMessage,
            (
                SELECT m.created_at
                FROM chat_messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.id DESC
                LIMIT 1
            ) AS lastMessageAt,
            (
                SELECT COUNT(*)
                FROM chat_messages m
                WHERE m.conversation_id = c.id
                  AND m.sender_id != ?
                  AND m.id > COALESCE(
                      (
                          SELECT rs.last_read_message_id
                          FROM chat_read_state rs
                          WHERE rs.conversation_id = c.id
                            AND rs.user_id = ?
                      ),
                      0
                  )
            ) AS unreadCount
        FROM chat_conversations c
        JOIN users u1 ON u1.id = c.user_one_id
        JOIN users u2 ON u2.id = c.user_two_id
        WHERE c.user_one_id = ? OR c.user_two_id = ?
        ORDER BY COALESCE(c.updated_at, c.created_at) DESC, c.id DESC
    `).all(
        userId,
        userId,
        userId,
        userId,
        userId,
        userId
    );

    res.json({ conversations });
});

// Start a conversation or return the existing conversation with that user.
router.post("/conversations", (req, res) => {
    const username = typeof req.body?.username === "string"
        ? req.body.username.trim()
        : "";

    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
        return res.status(400).json({
            error: "Enter a valid username (3–30 letters, numbers, or underscores)."
        });
    }

    const recipient = db.prepare(`
        SELECT id, username, is_suspended
        FROM users
        WHERE username = ? COLLATE NOCASE
    `).get(username);

    if (!recipient || recipient.is_suspended) {
        return res.status(404).json({
            error: "That user could not be found."
        });
    }

    if (recipient.id === req.chatUser.id) {
        return res.status(400).json({
            error: "You cannot start a conversation with yourself."
        });
    }

    const userOneId = Math.min(req.chatUser.id, recipient.id);
    const userTwoId = Math.max(req.chatUser.id, recipient.id);

    const createConversation = db.transaction(() => {
        db.prepare(`
            INSERT OR IGNORE INTO chat_conversations
                (user_one_id, user_two_id)
            VALUES (?, ?)
        `).run(userOneId, userTwoId);

        const conversation = db.prepare(`
            SELECT id, user_one_id, user_two_id, created_at, updated_at
            FROM chat_conversations
            WHERE user_one_id = ? AND user_two_id = ?
        `).get(userOneId, userTwoId);

        db.prepare(`
            INSERT OR IGNORE INTO chat_read_state
                (conversation_id, user_id)
            VALUES (?, ?), (?, ?)
        `).run(
            conversation.id,
            userOneId,
            conversation.id,
            userTwoId
        );

        return conversation;
    });

    const conversation = createConversation();

    res.status(200).json({
        conversation: {
            id: conversation.id,
            otherUserId: recipient.id,
            otherUsername: recipient.username,
            createdAt: conversation.created_at
        }
    });
});

// Retrieve a conversation's messages. Only its participants may access it.
router.get("/conversations/:id/messages", (req, res) => {
    const conversationId = validId(req.params.id);

    if (!conversationId) {
        return res.status(400).json({
            error: "Invalid conversation ID."
        });
    }

    const conversation = getConversationForUser(
        conversationId,
        req.chatUser.id
    );

    if (!conversation) {
        return res.status(404).json({
            error: "Conversation not found."
        });
    }

    const messages = db.prepare(`
        SELECT
            m.id,
            m.sender_id AS senderId,
            u.username AS senderUsername,
            m.body,
            m.created_at AS createdAt
        FROM chat_messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ?
        ORDER BY m.id DESC
        LIMIT ?
    `).all(conversationId, MAX_MESSAGES_PER_REQUEST).reverse();

    const latestMessageId = messages.length
        ? messages[messages.length - 1].id
        : 0;

    if (latestMessageId > 0) {
        db.prepare(`
            INSERT INTO chat_read_state
                (conversation_id, user_id, last_read_message_id, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(conversation_id, user_id)
            DO UPDATE SET
                last_read_message_id = MAX(
                    chat_read_state.last_read_message_id,
                    excluded.last_read_message_id
                ),
                updated_at = CURRENT_TIMESTAMP
        `).run(conversationId, req.chatUser.id, latestMessageId);
    }

    res.json({ messages });
});

// Send a message to a conversation.
router.post("/conversations/:id/messages", (req, res) => {
    const conversationId = validId(req.params.id);

    if (!conversationId) {
        return res.status(400).json({
            error: "Invalid conversation ID."
        });
    }

    const conversation = getConversationForUser(
        conversationId,
        req.chatUser.id
    );

    if (!conversation) {
        return res.status(404).json({
            error: "Conversation not found."
        });
    }

    const body = typeof req.body?.body === "string"
        ? req.body.body.trim()
        : "";

    if (!body || body.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({
            error: "Messages must contain between 1 and 4000 characters."
        });
    }

    const createMessage = db.transaction(() => {
        const result = db.prepare(`
            INSERT INTO chat_messages (conversation_id, sender_id, body)
            VALUES (?, ?, ?)
        `).run(conversationId, req.chatUser.id, body);

        db.prepare(`
            UPDATE chat_conversations
            SET updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(conversationId);

        // The sender has already seen their own new message.
        db.prepare(`
            INSERT INTO chat_read_state
                (conversation_id, user_id, last_read_message_id, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(conversation_id, user_id)
            DO UPDATE SET
                last_read_message_id = MAX(
                    chat_read_state.last_read_message_id,
                    excluded.last_read_message_id
                ),
                updated_at = CURRENT_TIMESTAMP
        `).run(conversationId, req.chatUser.id, result.lastInsertRowid);

        return db.prepare(`
            SELECT
                m.id,
                m.sender_id AS senderId,
                u.username AS senderUsername,
                m.body,
                m.created_at AS createdAt
            FROM chat_messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.id = ?
        `).get(result.lastInsertRowid);
    });

    const message = createMessage();

    res.status(201).json({ message });
});

export default router;
