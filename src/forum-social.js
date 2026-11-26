import express from "express";
import db from "./db.js";

const router = express.Router();

const REPORT_REASONS = new Set([
    "spam",
    "harassment",
    "hate",
    "misinformation",
    "inappropriate",
    "other"
]);

// Additive tables only. Existing forum posts, comments, and users are not replaced.
db.exec(`
    CREATE TABLE IF NOT EXISTS forum_post_likes (
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        PRIMARY KEY (post_id, user_id),
        FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS forum_post_follows (
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        PRIMARY KEY (post_id, user_id),
        FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS forum_content_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_user_id INTEGER NOT NULL,
        target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment')),
        post_id INTEGER,
        comment_id INTEGER,
        reason TEXT NOT NULL CHECK (
            reason IN ('spam', 'harassment', 'hate', 'misinformation', 'inappropriate', 'other')
        ),
        details TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (
            status IN ('pending', 'reviewed', 'dismissed', 'actioned')
        ),
        created_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
        FOREIGN KEY (comment_id) REFERENCES forum_comments(id) ON DELETE CASCADE,
        CHECK (
            (target_type = 'post' AND post_id IS NOT NULL AND comment_id IS NULL)
            OR
            (target_type = 'comment' AND comment_id IS NOT NULL AND post_id IS NULL)
        )
    );

    CREATE INDEX IF NOT EXISTS idx_forum_post_likes_post
        ON forum_post_likes(post_id);
    CREATE INDEX IF NOT EXISTS idx_forum_post_follows_user
        ON forum_post_follows(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_forum_reports_status
        ON forum_content_reports(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_forum_reports_user
        ON forum_content_reports(reporter_user_id, created_at DESC);
`);

function requireAuth(req, res, next) {
    if (!req.session?.userId) {
        return res.status(401).json({
            error: "Please log in to use this forum feature."
        });
    }

    next();
}

function parseId(value) {
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
        return null;
    }

    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function postExists(id) {
    return Boolean(db.prepare("SELECT id FROM forum_posts WHERE id = ?").get(id));
}

function commentExists(id) {
    return db.prepare(`
        SELECT id, post_id AS postId
        FROM forum_comments
        WHERE id = ?
    `).get(id);
}

function getSocialState(postId, userId = null) {
    const likeCount = db.prepare(`
        SELECT COUNT(*) AS count FROM forum_post_likes WHERE post_id = ?
    `).get(postId).count;

    const followerCount = db.prepare(`
        SELECT COUNT(*) AS count FROM forum_post_follows WHERE post_id = ?
    `).get(postId).count;

    const viewerLiked = userId
        ? Boolean(db.prepare(`
            SELECT 1 FROM forum_post_likes WHERE post_id = ? AND user_id = ?
        `).get(postId, userId))
        : false;

    const viewerFollowing = userId
        ? Boolean(db.prepare(`
            SELECT 1 FROM forum_post_follows WHERE post_id = ? AND user_id = ?
        `).get(postId, userId))
        : false;

    return { postId, likeCount, followerCount, viewerLiked, viewerFollowing };
}

// Public counts; viewer-specific flags are set only when a session exists.
router.get("/posts/:id", (req, res) => {
    const postId = parseId(req.params.id);

    if (!postId) {
        return res.status(400).json({ error: "Invalid post ID." });
    }

    if (!postExists(postId)) {
        return res.status(404).json({ error: "Discussion not found." });
    }

    const userId = Number.isSafeInteger(req.session?.userId)
        ? req.session.userId
        : null;

    res.json({ social: getSocialState(postId, userId) });
});

// Toggle like for the signed-in user.
router.post("/posts/:id/like", requireAuth, (req, res) => {
    const postId = parseId(req.params.id);

    if (!postId) {
        return res.status(400).json({ error: "Invalid post ID." });
    }

    if (!postExists(postId)) {
        return res.status(404).json({ error: "Discussion not found." });
    }

    const userId = req.session.userId;
    const existing = db.prepare(`
        SELECT 1 FROM forum_post_likes WHERE post_id = ? AND user_id = ?
    `).get(postId, userId);

    if (existing) {
        db.prepare(`
            DELETE FROM forum_post_likes WHERE post_id = ? AND user_id = ?
        `).run(postId, userId);
    } else {
        db.prepare(`
            INSERT OR IGNORE INTO forum_post_likes (post_id, user_id)
            VALUES (?, ?)
        `).run(postId, userId);
    }

    const social = getSocialState(postId, userId);
    res.json({ message: social.viewerLiked ? "Discussion liked." : "Like removed.", social });
});

// Follow or unfollow a discussion.
router.post("/posts/:id/follow", requireAuth, (req, res) => {
    const postId = parseId(req.params.id);

    if (!postId) {
        return res.status(400).json({ error: "Invalid post ID." });
    }

    if (!postExists(postId)) {
        return res.status(404).json({ error: "Discussion not found." });
    }

    const userId = req.session.userId;
    const existing = db.prepare(`
        SELECT 1 FROM forum_post_follows WHERE post_id = ? AND user_id = ?
    `).get(postId, userId);

    if (existing) {
        db.prepare(`
            DELETE FROM forum_post_follows WHERE post_id = ? AND user_id = ?
        `).run(postId, userId);
    } else {
        db.prepare(`
            INSERT OR IGNORE INTO forum_post_follows (post_id, user_id)
            VALUES (?, ?)
        `).run(postId, userId);
    }

    const social = getSocialState(postId, userId);
    res.json({ message: social.viewerFollowing ? "Discussion followed." : "Discussion unfollowed.", social });
});

// List discussions followed by the current user.
router.get("/following", requireAuth, (req, res) => {
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
            (SELECT COUNT(*) FROM forum_comments c WHERE c.post_id = p.id) AS commentCount,
            f.created_at AS followedAt
        FROM forum_post_follows f
        JOIN forum_posts p ON p.id = f.post_id
        JOIN users u ON u.id = p.user_id
        WHERE f.user_id = ?
        ORDER BY f.created_at DESC
        LIMIT 200
    `).all(req.session.userId);

    res.json({ posts });
});

// Report a post or comment for review. This records a report; it does not
// automatically hide content or make a moderation decision.
router.post("/reports", requireAuth, (req, res) => {
    const body = req.body ?? {};
    const targetType = body.targetType;
    const targetId = typeof body.targetId === "number"
        ? (Number.isSafeInteger(body.targetId) && body.targetId > 0 ? body.targetId : null)
        : parseId(body.targetId);
    const reason = body.reason;
    const details = typeof body.details === "string" ? body.details.trim() : "";

    if (!['post', 'comment'].includes(targetType) || !targetId) {
        return res.status(400).json({
            error: "Choose a valid post or comment to report."
        });
    }

    if (!REPORT_REASONS.has(reason)) {
        return res.status(400).json({ error: "Choose a valid report reason." });
    }

    if (details.length > 1000) {
        return res.status(400).json({ error: "Report details must be 1,000 characters or fewer." });
    }

    let postId = null;
    let commentId = null;

    if (targetType === "post") {
        if (!postExists(targetId)) {
            return res.status(404).json({ error: "Discussion not found." });
        }
        postId = targetId;
    } else {
        const comment = commentExists(targetId);
        if (!comment) {
            return res.status(404).json({ error: "Comment not found." });
        }
        commentId = targetId;
    }

    const duplicate = targetType === "post"
        ? db.prepare(`
            SELECT id FROM forum_content_reports
            WHERE reporter_user_id = ? AND post_id = ? AND status = 'pending'
        `).get(req.session.userId, postId)
        : db.prepare(`
            SELECT id FROM forum_content_reports
            WHERE reporter_user_id = ? AND comment_id = ? AND status = 'pending'
        `).get(req.session.userId, commentId);

    if (duplicate) {
        return res.status(409).json({
            error: "You have already reported this content and it is awaiting review."
        });
    }

    const result = db.prepare(`
        INSERT INTO forum_content_reports (
            reporter_user_id, target_type, post_id, comment_id, reason, details
        ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.session.userId, targetType, postId, commentId, reason, details);

    res.status(201).json({
        message: "Your report has been submitted for review.",
        reportId: Number(result.lastInsertRowid)
    });
});

export default router;
