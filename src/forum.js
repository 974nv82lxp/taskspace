
import express from "express";
import db from "./db.js";

const router = express.Router();

const CATEGORIES = [
    "General",
    "Questions",
    "Ideas",
    "Help",
    "Announcements"
];

const MAX_TITLE_LENGTH = 160;
const MAX_POST_LENGTH = 10000;
const MAX_COMMENT_LENGTH = 5000;

// ------------------------------------------------------------
// DATABASE TABLES
// Uses the existing TaskSpace SQLite database.
// ------------------------------------------------------------

const createForumTables = db.transaction(() => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS forum_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'General',
            created_at TEXT NOT NULL DEFAULT (
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            ),
            updated_at TEXT NOT NULL DEFAULT (
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            ),
            FOREIGN KEY (user_id)
                REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS forum_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            parent_comment_id INTEGER DEFAULT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            ),
            updated_at TEXT NOT NULL DEFAULT (
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            ),
            FOREIGN KEY (post_id)
                REFERENCES forum_posts(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id)
                REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_comment_id)
                REFERENCES forum_comments(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_forum_posts_created
            ON forum_posts(created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_forum_posts_user
            ON forum_posts(user_id);

        CREATE INDEX IF NOT EXISTS idx_forum_posts_category
            ON forum_posts(category);

        CREATE INDEX IF NOT EXISTS idx_forum_comments_post
            ON forum_comments(post_id, created_at ASC);

        CREATE INDEX IF NOT EXISTS idx_forum_comments_parent
            ON forum_comments(parent_comment_id);

        CREATE INDEX IF NOT EXISTS idx_forum_comments_user
            ON forum_comments(user_id);
    `);
});

createForumTables();

// ------------------------------------------------------------
// AUTHENTICATION AND VALIDATION
// ------------------------------------------------------------

function requireAuth(req, res, next) {
    if (!req.session?.userId) {
        return res.status(401).json({
            error: "Please log in to perform this action."
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

function validText(value, maxLength) {
    return (
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.trim().length <= maxLength
    );
}

function validUserId(value) {
    return (
        Number.isSafeInteger(value) &&
        value > 0
    );
}

// ------------------------------------------------------------
// DATABASE HELPERS
// ------------------------------------------------------------

function getPost(id) {
    return db.prepare(`
        SELECT
            p.id,
            p.user_id AS userId,
            p.title,
            p.body,
            p.category,
            p.created_at AS createdAt,
            p.updated_at AS updatedAt,
            u.username,
            (
                SELECT COUNT(*)
                FROM forum_comments c
                WHERE c.post_id = p.id
            ) AS commentCount
        FROM forum_posts p
        JOIN users u ON u.id = p.user_id
        WHERE p.id = ?
    `).get(id);
}

function getComment(id) {
    return db.prepare(`
        SELECT
            c.id,
            c.post_id AS postId,
            c.user_id AS userId,
            c.parent_comment_id AS parentCommentId,
            c.body,
            c.created_at AS createdAt,
            c.updated_at AS updatedAt,
            u.username
        FROM forum_comments c
        JOIN users u ON u.id = c.user_id
        WHERE c.id = ?
    `).get(id);
}

// ------------------------------------------------------------
// GET /api/forum/categories
// ------------------------------------------------------------

router.get("/categories", (req, res) => {
    res.json({
        categories: CATEGORIES
    });
});

// ------------------------------------------------------------
// GET /api/forum/posts
// Search:   ?q=example
// Category: ?category=Questions
// Sort:     ?sort=newest|oldest|comments
// Page:     ?page=1
// ------------------------------------------------------------

router.get("/posts", (req, res) => {
    const search =
        typeof req.query.q === "string"
            ? req.query.q.trim().slice(0, 100)
            : "";

    const category =
        typeof req.query.category === "string"
            ? req.query.category
            : "";

    const requestedSort =
        typeof req.query.sort === "string"
            ? req.query.sort
            : "newest";

    const sort = [
        "newest",
        "oldest",
        "comments"
    ].includes(requestedSort)
        ? requestedSort
        : "newest";

    const requestedPage = Number(req.query.page);

    const page =
        Number.isSafeInteger(requestedPage) &&
        requestedPage > 0
            ? Math.min(requestedPage, 100000)
            : 1;

    const limit = 20;
    const offset = (page - 1) * limit;

    const conditions = [];
    const parameters = [];

    if (search) {
        conditions.push(
            "(p.title LIKE ? OR p.body LIKE ?)"
        );

        const searchPattern = `%${search}%`;

        parameters.push(
            searchPattern,
            searchPattern
        );
    }

    if (CATEGORIES.includes(category)) {
        conditions.push("p.category = ?");
        parameters.push(category);
    }

    const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const orderBy = {
        newest: "p.created_at DESC, p.id DESC",
        oldest: "p.created_at ASC, p.id ASC",
        comments: "commentCount DESC, p.created_at DESC"
    }[sort];

    const total = db.prepare(`
        SELECT COUNT(*) AS count
        FROM forum_posts p
        ${where}
    `).get(...parameters).count;

    const posts = db.prepare(`
        SELECT
            p.id,
            p.user_id AS userId,
            p.title,
            p.body,
            p.category,
            p.created_at AS createdAt,
            p.updated_at AS updatedAt,
            u.username,
            (
                SELECT COUNT(*)
                FROM forum_comments c
                WHERE c.post_id = p.id
            ) AS commentCount
        FROM forum_posts p
        JOIN users u ON u.id = p.user_id
        ${where}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset);

    res.json({
        posts,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
        }
    });
});

// ------------------------------------------------------------
// GET /api/forum/posts/:id
// Returns one discussion and its comments.
// ------------------------------------------------------------

router.get("/posts/:id", (req, res) => {
    const id = validId(req.params.id);

    if (!id) {
        return res.status(400).json({
            error: "Invalid post ID."
        });
    }

    const post = getPost(id);

    if (!post) {
        return res.status(404).json({
            error: "Discussion not found."
        });
    }

    const comments = db.prepare(`
        SELECT
            c.id,
            c.post_id AS postId,
            c.user_id AS userId,
            c.parent_comment_id AS parentCommentId,
            c.body,
            c.created_at AS createdAt,
            c.updated_at AS updatedAt,
            u.username
        FROM forum_comments c
        JOIN users u ON u.id = c.user_id
        WHERE c.post_id = ?
        ORDER BY c.created_at ASC, c.id ASC
    `).all(id);

    res.json({
        post,
        comments
    });
});

// ------------------------------------------------------------
// POST /api/forum/posts
// Creates a discussion. Login required.
// ------------------------------------------------------------

router.post("/posts", requireAuth, (req, res) => {
    const {
        title,
        body,
        category = "General"
    } = req.body ?? {};

    if (!validText(title, MAX_TITLE_LENGTH)) {
        return res.status(400).json({
            error:
                `Title must contain 1–${MAX_TITLE_LENGTH} characters.`
        });
    }

    if (!validText(body, MAX_POST_LENGTH)) {
        return res.status(400).json({
            error:
                `Post must contain 1–${MAX_POST_LENGTH} characters.`
        });
    }

    if (!CATEGORIES.includes(category)) {
        return res.status(400).json({
            error: "Choose a valid forum category."
        });
    }

    const userId = req.session.userId;

    if (!validUserId(userId)) {
        return res.status(401).json({
            error: "Invalid login session."
        });
    }

    const result = db.prepare(`
        INSERT INTO forum_posts (
            user_id,
            title,
            body,
            category
        )
        VALUES (?, ?, ?, ?)
    `).run(
        userId,
        title.trim(),
        body.trim(),
        category
    );

    const post = getPost(Number(result.lastInsertRowid));

    res.status(201).json({
        post
    });
});

// ------------------------------------------------------------
// PATCH /api/forum/posts/:id
// Edits the signed-in user's own discussion.
// ------------------------------------------------------------

router.patch("/posts/:id", requireAuth, (req, res) => {
    const id = validId(req.params.id);

    if (!id) {
        return res.status(400).json({
            error: "Invalid post ID."
        });
    }

    const existing = getPost(id);

    if (!existing) {
        return res.status(404).json({
            error: "Discussion not found."
        });
    }

    if (existing.userId !== req.session.userId) {
        return res.status(403).json({
            error: "You can only edit your own discussions."
        });
    }

    const {
        title,
        body,
        category
    } = req.body ?? {};

    if (!validText(title, MAX_TITLE_LENGTH)) {
        return res.status(400).json({
            error:
                `Title must contain 1–${MAX_TITLE_LENGTH} characters.`
        });
    }

    if (!validText(body, MAX_POST_LENGTH)) {
        return res.status(400).json({
            error:
                `Post must contain 1–${MAX_POST_LENGTH} characters.`
        });
    }

    if (!CATEGORIES.includes(category)) {
        return res.status(400).json({
            error: "Choose a valid forum category."
        });
    }

    db.prepare(`
        UPDATE forum_posts
        SET
            title = ?,
            body = ?,
            category = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND user_id = ?
    `).run(
        title.trim(),
        body.trim(),
        category,
        id,
        req.session.userId
    );

    res.json({
        post: getPost(id)
    });
});

// ------------------------------------------------------------
// DELETE /api/forum/posts/:id
// Deletes the signed-in user's own discussion.
// Its comments are deleted through the foreign key.
// ------------------------------------------------------------

router.delete("/posts/:id", requireAuth, (req, res) => {
    const id = validId(req.params.id);

    if (!id) {
        return res.status(400).json({
            error: "Invalid post ID."
        });
    }

    const result = db.prepare(`
        DELETE FROM forum_posts
        WHERE id = ? AND user_id = ?
    `).run(
        id,
        req.session.userId
    );

    if (result.changes === 0) {
        return res.status(404).json({
            error: "Discussion not found or not owned by you."
        });
    }

    res.json({
        message: "Discussion deleted."
    });
});

// ------------------------------------------------------------
// POST /api/forum/posts/:id/comments
// Adds a comment or a reply.
// Optional JSON property: parentCommentId
// ------------------------------------------------------------

router.post(
    "/posts/:id/comments",
    requireAuth,
    (req, res) => {
        const postId = validId(req.params.id);

        if (!postId) {
            return res.status(400).json({
                error: "Invalid post ID."
            });
        }

        if (!getPost(postId)) {
            return res.status(404).json({
                error: "Discussion not found."
            });
        }

        const {
            body,
            parentCommentId = null
        } = req.body ?? {};

        if (!validText(body, MAX_COMMENT_LENGTH)) {
            return res.status(400).json({
                error:
                    `Comment must contain 1–${MAX_COMMENT_LENGTH} characters.`
            });
        }

        let parentId = null;

        if (parentCommentId !== null) {
            const isValidParentId =
                (
                    typeof parentCommentId === "number" &&
                    Number.isSafeInteger(parentCommentId) &&
                    parentCommentId > 0
                ) ||
                (
                    typeof parentCommentId === "string" &&
                    validId(parentCommentId) !== null
                );

            if (!isValidParentId) {
                return res.status(400).json({
                    error: "Invalid parent comment."
                });
            }

            parentId = Number(parentCommentId);

            const parent = getComment(parentId);

            if (!parent || parent.postId !== postId) {
                return res.status(400).json({
                    error:
                        "Replies must belong to the same discussion."
                });
            }
        }

        const userId = req.session.userId;

        if (!validUserId(userId)) {
            return res.status(401).json({
                error: "Invalid login session."
            });
        }

        const result = db.prepare(`
            INSERT INTO forum_comments (
                post_id,
                user_id,
                parent_comment_id,
                body
            )
            VALUES (?, ?, ?, ?)
        `).run(
            postId,
            userId,
            parentId,
            body.trim()
        );

        const comment = getComment(
            Number(result.lastInsertRowid)
        );

        res.status(201).json({
            comment
        });
    }
);

// ------------------------------------------------------------
// PATCH /api/forum/comments/:id
// Edits the signed-in user's own comment.
// ------------------------------------------------------------

router.patch(
    "/comments/:id",
    requireAuth,
    (req, res) => {
        const id = validId(req.params.id);

        if (!id) {
            return res.status(400).json({
                error: "Invalid comment ID."
            });
        }

        const comment = getComment(id);

        if (!comment) {
            return res.status(404).json({
                error: "Comment not found."
            });
        }

        if (comment.userId !== req.session.userId) {
            return res.status(403).json({
                error: "You can only edit your own comments."
            });
        }

        const { body } = req.body ?? {};

        if (!validText(body, MAX_COMMENT_LENGTH)) {
            return res.status(400).json({
                error:
                    `Comment must contain 1–${MAX_COMMENT_LENGTH} characters.`
            });
        }

        db.prepare(`
            UPDATE forum_comments
            SET
                body = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ? AND user_id = ?
        `).run(
            body.trim(),
            id,
            req.session.userId
        );

        res.json({
            comment: getComment(id)
        });
    }
);

// ------------------------------------------------------------
// DELETE /api/forum/comments/:id
// Deletes the signed-in user's own comment.
// ------------------------------------------------------------

router.delete(
    "/comments/:id",
    requireAuth,
    (req, res) => {
        const id = validId(req.params.id);

        if (!id) {
            return res.status(400).json({
                error: "Invalid comment ID."
            });
        }

        const result = db.prepare(`
            DELETE FROM forum_comments
            WHERE id = ? AND user_id = ?
        `).run(
            id,
            req.session.userId
        );

        if (result.changes === 0) {
            return res.status(404).json({
                error: "Comment not found or not owned by you."
            });
        }

        res.json({
            message: "Comment deleted."
        });
    }
);

// ------------------------------------------------------------
// EXPORT ROUTER
// Required by: import forumRouter from "./forum.js";
// ------------------------------------------------------------

export default router;
