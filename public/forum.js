
"use strict";

const API_BASE = "/api/forum";
const PAGE_SIZE = 20;

const state = {
    page: 1,
    totalPages: 0,
    search: "",
    category: "",
    sort: "newest",
    posts: [],
    openPosts: new Set(),
    details: new Map(),
    currentUser: null,
    loading: false
};

const elements = {
    postForm: document.querySelector("#post-form"),
    postTitle: document.querySelector("#post-title"),
    postBody: document.querySelector("#post-body"),
    postCategory: document.querySelector("#post-category"),
    filterCategory: document.querySelector("#filter-category"),
    searchInput: document.querySelector("#search-input"),
    searchButton: document.querySelector("#search-button"),
    sortSelect: document.querySelector("#sort-select"),
    postsContainer: document.querySelector("#posts-container"),
    postCount: document.querySelector("#post-count"),
    status: document.querySelector("#status-message"),
    previousPage: document.querySelector("#previous-page"),
    nextPage: document.querySelector("#next-page"),
    pageIndicator: document.querySelector("#page-indicator")
};

// ------------------------------------------------------------
// API HELPER
// ------------------------------------------------------------

async function apiRequest(path, options = {}) {
    const requestOptions = {
        credentials: "same-origin",
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {})
        }
    };

    const response = await fetch(path, requestOptions);

    const contentType = response.headers.get("content-type") || "";
    let data = {};

    if (contentType.includes("application/json")) {
        data = await response.json();
    } else {
        const text = await response.text();

        if (text) {
            data = { error: text };
        }
    }

    if (!response.ok) {
        const error = new Error(
            data.error || `Request failed (${response.status}).`
        );

        error.status = response.status;
        throw error;
    }

    return data;
}

function showStatus(message, type = "") {
    elements.status.textContent = message;
    elements.status.className = "status-message";

    if (type) {
        elements.status.classList.add(type);
    }
}

function clearStatus() {
    showStatus("");
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => {
        const replacements = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return replacements[character];
    });
}

function formatDate(value) {
    if (!value) {
        return "Date unavailable";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Date unavailable";
    }

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(date);
}

function isOwnRecord(record) {
    return (
        state.currentUser &&
        Number(record.userId) === Number(state.currentUser.id)
    );
}

// ------------------------------------------------------------
// CURRENT USER
// ------------------------------------------------------------

async function loadCurrentUser() {
    try {
        const data = await apiRequest("/api/auth/me");

        const user = data.user || data.currentUser || data;

        const id = Number(user.id ?? user.userId);

        if (Number.isSafeInteger(id) && id > 0) {
            state.currentUser = {
                id,
                username: user.username || "User"
            };
        }
    } catch {
        // Public forum browsing still works without logging in.
        state.currentUser = null;
    }
}

// ------------------------------------------------------------
// CATEGORIES
// ------------------------------------------------------------

async function loadCategories() {
    const data = await apiRequest(`${API_BASE}/categories`);
    const categories = Array.isArray(data.categories)
        ? data.categories
        : [];

    elements.postCategory.replaceChildren();
    elements.filterCategory.replaceChildren();

    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All categories";
    elements.filterCategory.appendChild(allOption);

    for (const category of categories) {
        const postOption = document.createElement("option");
        postOption.value = category;
        postOption.textContent = category;
        elements.postCategory.appendChild(postOption);

        const filterOption = document.createElement("option");
        filterOption.value = category;
        filterOption.textContent = category;
        elements.filterCategory.appendChild(filterOption);
    }
}

// ------------------------------------------------------------
// LOAD DISCUSSIONS
// ------------------------------------------------------------

async function loadPosts() {
    if (state.loading) {
        return;
    }

    state.loading = true;
    elements.postsContainer.setAttribute("aria-busy", "true");
    elements.postsContainer.innerHTML =
        '<div class="empty-state">Loading discussions…</div>';

    const params = new URLSearchParams({
        page: String(state.page),
        sort: state.sort
    });

    if (state.search) {
        params.set("q", state.search);
    }

    if (state.category) {
        params.set("category", state.category);
    }

    try {
        const data = await apiRequest(
            `${API_BASE}/posts?${params.toString()}`
        );

        state.posts = Array.isArray(data.posts) ? data.posts : [];
        state.totalPages = data.pagination?.pages || 0;

        elements.postCount.textContent =
            `${data.pagination?.total ?? state.posts.length} discussions`;

        renderPosts();

        elements.pageIndicator.textContent =
            `Page ${state.page} of ${Math.max(1, state.totalPages)}`;

        elements.previousPage.disabled = state.page <= 1;
        elements.nextPage.disabled =
            state.totalPages === 0 || state.page >= state.totalPages;

        clearStatus();
    } catch (error) {
        elements.postsContainer.innerHTML = "";

        showStatus(
            `Could not load discussions: ${error.message}`,
            "error"
        );

        elements.postCount.textContent = "Unavailable";
    } finally {
        state.loading = false;
        elements.postsContainer.removeAttribute("aria-busy");
    }
}

// ------------------------------------------------------------
// RENDER DISCUSSION CARDS
// ------------------------------------------------------------

function renderPosts() {
    elements.postsContainer.innerHTML = "";

    if (state.posts.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent =
            "No discussions found. Be the first to start one!";
        elements.postsContainer.appendChild(empty);
        return;
    }

    for (const post of state.posts) {
        const card = document.createElement("article");
        card.className = "post-card";
        card.dataset.postId = String(post.id);

        const ownsPost = isOwnRecord(post);
        const isOpen = state.openPosts.has(Number(post.id));

        card.innerHTML = `
            <div class="post-topline">
                <span class="category-tag">${escapeHtml(post.category)}</span>
                <span class="post-meta">${escapeHtml(formatDate(post.createdAt))}</span>
            </div>

            <h3>${escapeHtml(post.title)}</h3>

            <div class="post-meta">
                Posted by <strong>${escapeHtml(post.username)}</strong>
                · ${Number(post.commentCount) || 0} comments
                ${post.updatedAt !== post.createdAt ? " · Edited" : ""}
            </div>

            <div class="post-body">${escapeHtml(post.body)}</div>

            <div class="post-actions">
                <button
                    class="button secondary"
                    type="button"
                    data-action="toggle-discussion"
                    data-id="${Number(post.id)}"
                    aria-expanded="${isOpen}"
                >${isOpen ? "Hide discussion" : "View comments and replies"}</button>

                ${
                    ownsPost
                        ? `
                            <button
                                class="button secondary"
                                type="button"
                                data-action="edit-post"
                                data-id="${Number(post.id)}"
                            >Edit</button>
                            <button
                                class="button danger"
                                type="button"
                                data-action="delete-post"
                                data-id="${Number(post.id)}"
                            >Delete</button>
                        `
                        : ""
                }
            </div>

            ${
                ownsPost
                    ? `
                        <form class="inline-edit" data-form="edit-post" hidden>
                            <label>
                                Title
                                <input
                                    name="title"
                                    maxlength="160"
                                    required
                                    value="${escapeHtml(post.title)}"
                                >
                            </label>
                            <label>
                                Category
                                <select name="category" required>
                                    ${buildCategoryOptions(post.category)}
                                </select>
                            </label>
                            <label>
                                Message
                                <textarea name="body" maxlength="10000" required>${escapeHtml(post.body)}</textarea>
                            </label>
                            <div class="edit-actions">
                                <button class="button primary" type="submit">Save changes</button>
                                <button class="button secondary" type="button" data-action="cancel-edit">Cancel</button>
                            </div>
                        </form>
                    `
                    : ""
            }

            <div class="discussion-details" ${isOpen ? "" : "hidden"}>
                <div class="comments-list">
                    <p class="muted">Loading comments…</p>
                </div>

                <form class="comment-form" data-form="new-comment">
                    <label for="comment-${Number(post.id)}">Add a comment or reply</label>
                    <textarea
                        id="comment-${Number(post.id)}"
                        name="body"
                        maxlength="5000"
                        required
                        placeholder="Write your comment..."
                    ></textarea>
                    <button class="button primary" type="submit">Post comment</button>
                </form>
            </div>
        `;

        elements.postsContainer.appendChild(card);

        if (isOpen) {
            renderComments(card, post.id);
        }
    }
}

function buildCategoryOptions(selectedCategory) {
    const options = Array.from(elements.postCategory.options);

    return options.map((option) => `
        <option
            value="${escapeHtml(option.value)}"
            ${option.value === selectedCategory ? "selected" : ""}
        >${escapeHtml(option.textContent)}</option>
    `).join("");
}

// ------------------------------------------------------------
// LOAD AND DISPLAY COMMENTS
// ------------------------------------------------------------

async function renderComments(card, postId) {
    const container = card.querySelector(".comments-list");

    if (!container) {
        return;
    }

    try {
        let details = state.details.get(Number(postId));

        if (!details) {
            details = await apiRequest(`${API_BASE}/posts/${postId}`);
            state.details.set(Number(postId), details);
        }

        if (!state.openPosts.has(Number(postId))) {
            return;
        }

        const comments = Array.isArray(details.comments)
            ? details.comments
            : [];

        container.innerHTML = "";

        const heading = document.createElement("h4");
        heading.className = "comments-heading";
        heading.textContent = `Comments (${comments.length})`;
        container.appendChild(heading);

        if (comments.length === 0) {
            const empty = document.createElement("p");
            empty.className = "muted";
            empty.textContent = "No comments yet. Start the conversation.";
            container.appendChild(empty);
            return;
        }

        for (const comment of comments) {
            const commentElement = document.createElement("article");
            commentElement.className = "comment";

            const parentId = comment.parentCommentId;

            if (parentId !== null && parentId !== undefined) {
                commentElement.classList.add("reply");
            }

            const ownsComment = isOwnRecord(comment);

            commentElement.innerHTML = `
                <div class="comment-meta">
                    <strong>${escapeHtml(comment.username)}</strong>
                    · ${escapeHtml(formatDate(comment.createdAt))}
                    ${comment.updatedAt !== comment.createdAt ? " · Edited" : ""}
                </div>

                <p>${escapeHtml(comment.body)}</p>

                <div class="comment-actions">
                    <button
                        class="button secondary small"
                        type="button"
                        data-action="reply-comment"
                        data-id="${Number(comment.id)}"
                    >Reply</button>

                    ${
                        ownsComment
                            ? `
                                <button
                                    class="button secondary small"
                                    type="button"
                                    data-action="edit-comment"
                                    data-id="${Number(comment.id)}"
                                >Edit</button>
                                <button
                                    class="button danger small"
                                    type="button"
                                    data-action="delete-comment"
                                    data-id="${Number(comment.id)}"
                                >Delete</button>
                            `
                            : ""
                    }
                </div>

                ${
                    ownsComment
                        ? `
                            <form class="inline-edit" data-form="edit-comment" hidden>
                                <label>
                                    Edit comment
                                    <textarea name="body" maxlength="5000" required>${escapeHtml(comment.body)}</textarea>
                                </label>
                                <div class="edit-actions">
                                    <button class="button primary small" type="submit">Save</button>
                                    <button class="button secondary small" type="button" data-action="cancel-edit">Cancel</button>
                                </div>
                            </form>
                        `
                        : ""
                }

                <form class="inline-edit" data-form="reply" hidden>
                    <label>
                        Write a reply
                        <textarea name="body" maxlength="5000" required></textarea>
                    </label>
                    <div class="edit-actions">
                        <button class="button primary small" type="submit">Post reply</button>
                        <button class="button secondary small" type="button" data-action="cancel-edit">Cancel</button>
                    </div>
                </form>
            `;

            commentElement.dataset.commentId = String(comment.id);
            container.appendChild(commentElement);
        }
    } catch (error) {
        container.textContent = `Could not load comments: ${error.message}`;
    }
}

// ------------------------------------------------------------
// CREATE DISCUSSION
// ------------------------------------------------------------

elements.postForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();

    const title = elements.postTitle.value.trim();
    const body = elements.postBody.value.trim();
    const category = elements.postCategory.value;

    try {
        await apiRequest(`${API_BASE}/posts`, {
            method: "POST",
            body: JSON.stringify({ title, body, category })
        });

        elements.postForm.reset();
        state.page = 1;
        state.details.clear();

        showStatus("Your discussion was published.", "success");
        await loadPosts();
    } catch (error) {
        showStatus(
            error.status === 401
                ? "Please log in on the TaskSpace home page before publishing."
                : `Could not publish discussion: ${error.message}`,
            "error"
        );
    }
});

// ------------------------------------------------------------
// POST AND COMMENT ACTIONS
// ------------------------------------------------------------

elements.postsContainer.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");

    if (!button) {
        return;
    }

    const action = button.dataset.action;
    const id = Number(button.dataset.id);
    const card = button.closest(".post-card");
    const commentElement = button.closest(".comment");

    try {
        if (action === "toggle-discussion") {
            if (state.openPosts.has(id)) {
                state.openPosts.delete(id);
            } else {
                state.openPosts.add(id);
            }

            renderPosts();
            return;
        }

        if (action === "edit-post") {
            const form = card.querySelector('[data-form="edit-post"]');
            form.hidden = false;
            form.querySelector('input[name="title"]').focus();
            return;
        }

        if (action === "edit-comment") {
            const form = commentElement.querySelector(
                '[data-form="edit-comment"]'
            );

            form.hidden = false;
            form.querySelector("textarea").focus();
            return;
        }

        if (action === "reply-comment") {
            const form = commentElement.querySelector('[data-form="reply"]');

            form.hidden = false;
            form.querySelector("textarea").focus();
            return;
        }

        if (action === "cancel-edit") {
            const form = button.closest("form");

            if (form) {
                form.hidden = true;
            }

            return;
        }

        if (action === "delete-post") {
            if (!window.confirm("Delete this discussion and all its comments?")) {
                return;
            }

            await apiRequest(`${API_BASE}/posts/${id}`, {
                method: "DELETE"
            });

            state.details.delete(id);
            state.openPosts.delete(id);

            showStatus("Discussion deleted.", "success");
            await loadPosts();
            return;
        }

        if (action === "delete-comment") {
            if (!window.confirm("Delete this comment? Replies to it may also be deleted.")) {
                return;
            }

            await apiRequest(`${API_BASE}/comments/${id}`, {
                method: "DELETE"
            });

            const postCard = button.closest(".post-card");
            const postId = Number(postCard.dataset.postId);

            state.details.delete(postId);

            const details = await apiRequest(`${API_BASE}/posts/${postId}`);
            state.details.set(postId, details);

            renderComments(postCard, postId);
            await loadPosts();

            showStatus("Comment deleted.", "success");
        }
    } catch (error) {
        showStatus(
            error.status === 401
                ? "Please log in to perform this action."
                : `Action failed: ${error.message}`,
            "error"
        );
    }
});

// ------------------------------------------------------------
// SAVE EDITS AND CREATE COMMENTS / REPLIES
// ------------------------------------------------------------

elements.postsContainer.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-form]");

    if (!form) {
        return;
    }

    event.preventDefault();
    clearStatus();

    const card = form.closest(".post-card");
    const postId = Number(card.dataset.postId);
    const formType = form.dataset.form;

    try {
        if (formType === "edit-post") {
            const title = form.elements.title.value.trim();
            const body = form.elements.body.value.trim();
            const category = form.elements.category.value;

            await apiRequest(`${API_BASE}/posts/${postId}`, {
                method: "PATCH",
                body: JSON.stringify({ title, body, category })
            });

            state.details.delete(postId);
            showStatus("Discussion updated.", "success");
            await loadPosts();
            return;
        }

        if (formType === "new-comment") {
            const body = form.elements.body.value.trim();

            await apiRequest(`${API_BASE}/posts/${postId}/comments`, {
                method: "POST",
                body: JSON.stringify({ body })
            });

            state.details.delete(postId);
            state.openPosts.add(postId);

            const details = await apiRequest(
                `${API_BASE}/posts/${postId}`
            );

            state.details.set(postId, details);

            renderPosts();
            showStatus("Comment published.", "success");
            await loadPosts();
            return;
        }

        if (formType === "reply") {
            const commentElement = form.closest(".comment");
            const parentCommentId = Number(
                commentElement.dataset.commentId
            );
            const body = form.elements.body.value.trim();

            await apiRequest(`${API_BASE}/posts/${postId}/comments`, {
                method: "POST",
                body: JSON.stringify({ body, parentCommentId })
            });

            state.details.delete(postId);

            const details = await apiRequest(
                `${API_BASE}/posts/${postId}`
            );

            state.details.set(postId, details);
            state.openPosts.add(postId);

            renderPosts();
            showStatus("Reply published.", "success");
            await loadPosts();
            return;
        }

        if (formType === "edit-comment") {
            const commentElement = form.closest(".comment");
            const commentId = Number(commentElement.dataset.commentId);
            const body = form.elements.body.value.trim();

            await apiRequest(`${API_BASE}/comments/${commentId}`, {
                method: "PATCH",
                body: JSON.stringify({ body })
            });

            state.details.delete(postId);

            const details = await apiRequest(
                `${API_BASE}/posts/${postId}`
            );

            state.details.set(postId, details);

            renderPosts();
            showStatus("Comment updated.", "success");
            await loadPosts();
        }
    } catch (error) {
        showStatus(
            error.status === 401
                ? "Please log in to perform this action."
                : `Could not save changes: ${error.message}`,
            "error"
        );
    }
});

// ------------------------------------------------------------
// SEARCH, FILTERING, AND PAGINATION
// ------------------------------------------------------------

function applyFilters() {
    state.search = elements.searchInput.value.trim();
    state.category = elements.filterCategory.value;
    state.sort = elements.sortSelect.value;
    state.page = 1;
    state.details.clear();
    state.openPosts.clear();

    loadPosts();
}

elements.searchButton.addEventListener("click", applyFilters);

elements.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        applyFilters();
    }
});

elements.filterCategory.addEventListener("change", applyFilters);
elements.sortSelect.addEventListener("change", applyFilters);

elements.previousPage.addEventListener("click", () => {
    if (state.page > 1) {
        state.page -= 1;
        loadPosts();
    }
});

elements.nextPage.addEventListener("click", () => {
    if (state.page < state.totalPages) {
        state.page += 1;
        loadPosts();
    }
});

// ------------------------------------------------------------
// STARTUP
// ------------------------------------------------------------

async function initializeForum() {
    try {
        await loadCurrentUser();
        await loadCategories();
        await loadPosts();
    } catch (error) {
        showStatus(
            `The forum could not initialize: ${error.message}`,
            "error"
        );
    }
}

initializeForum();


