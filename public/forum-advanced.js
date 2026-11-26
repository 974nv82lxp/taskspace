"use strict";

(() => {
    const API_BASE = "/api/forum";
    const SOCIAL_BASE = "/api/forum-social";
    const $ = (id) => document.getElementById(id);

    const elements = {
        userStatus: $("user-status"),
        status: $("status-message"),
        discussionCount: $("discussion-count"),
        createForm: $("create-post-form"),
        newTitle: $("new-title"),
        newCategory: $("new-category"),
        newBody: $("new-body"),
        bodyCount: $("body-count"),
        searchInput: $("search-input"),
        searchButton: $("search-button"),
        filterCategory: $("filter-category"),
        sortSelect: $("sort-select"),
        clearFilters: $("clear-filters"),
        activeFilterLabel: $("active-filter-label"),
        resultSummary: $("result-summary"),
        postsContainer: $("posts-container"),
        previousPage: $("previous-page"),
        nextPage: $("next-page"),
        pageIndicator: $("page-indicator"),
        showFollowing: $("show-following"),
        showAllPosts: $("show-all-posts"),
        reportDialog: $("report-dialog"),
        reportForm: $("report-form"),
        reportReason: $("report-reason"),
        reportDetails: $("report-details"),
        closeReport: $("close-report"),
        cancelReport: $("cancel-report")
    };

    const state = {
        currentUser: null,
        categories: ["General", "Questions", "Ideas", "Help", "Announcements"],
        posts: [],
        search: "",
        category: "",
        sort: "newest",
        page: 1,
        totalPages: 1,
        total: 0,
        loading: false,
        showFollowedOnly: false,
        followedPosts: [],
        details: new Map(),
        openPosts: new Set(),
        reportTarget: null
    };

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);
    }

    function isOwnRecord(record) {
        return Boolean(
            state.currentUser &&
            Number(record.userId) === Number(state.currentUser.id)
        );
    }

    async function apiRequest(url, options = {}) {
        const headers = new Headers(options.headers || {});
        if (options.body !== undefined && !headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
        }
        headers.set("Accept", "application/json");

        let response;
        try {
            response = await fetch(url, {
                ...options,
                headers,
                credentials: "same-origin"
            });
        } catch {
            const error = new Error("Could not connect to TaskSpace. Check that the server is running.");
            error.status = 0;
            throw error;
        }

        let data = {};
        const text = await response.text();
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                data = { error: text.slice(0, 250) };
            }
        }

        if (!response.ok) {
            const error = new Error(data.error || `Request failed (${response.status}).`);
            error.status = response.status;
            throw error;
        }

        return data;
    }

    function showStatus(message, type = "") {
        elements.status.textContent = message;
        elements.status.dataset.type = type;
        elements.status.hidden = !message;
    }

    function clearStatus() {
        showStatus("");
    }

    function formatDate(value) {
        if (!value) return "Date unavailable";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Date unavailable";
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short"
        }).format(date);
    }

    function initials(username) {
        const text = String(username || "U").trim();
        return escapeHtml((text[0] || "U").toUpperCase());
    }

    async function loadCurrentUser() {
        try {
            const data = await apiRequest("/api/auth/me");
            const user = data.user || data.currentUser || null;
            const id = Number(user?.id ?? user?.userId);
            if (Number.isSafeInteger(id) && id > 0) {
                state.currentUser = {
                    id,
                    username: user.username || "User"
                };
                elements.userStatus.textContent = `Signed in as ${state.currentUser.username}`;
            } else {
                state.currentUser = null;
                elements.userStatus.textContent = "Browsing as guest";
            }
        } catch {
            state.currentUser = null;
            elements.userStatus.textContent = "Browsing as guest";
        }
    }

    async function loadCategories() {
        try {
            const data = await apiRequest(`${API_BASE}/categories`);
            const categories = Array.isArray(data.categories) ? data.categories : [];
            if (categories.length) state.categories = categories;
        } catch {
            // A fallback category list keeps the form usable if this request fails.
        }

        elements.newCategory.replaceChildren();
        elements.filterCategory.replaceChildren();

        const allOption = document.createElement("option");
        allOption.value = "";
        allOption.textContent = "All categories";
        elements.filterCategory.appendChild(allOption);

        for (const category of state.categories) {
            const createOption = document.createElement("option");
            createOption.value = category;
            createOption.textContent = category;
            elements.newCategory.appendChild(createOption);

            const filterOption = document.createElement("option");
            filterOption.value = category;
            filterOption.textContent = category;
            elements.filterCategory.appendChild(filterOption);
        }
    }

    async function loadPosts() {
        if (state.loading) return;

        state.loading = true;
        elements.postsContainer.setAttribute("aria-busy", "true");
        elements.postsContainer.innerHTML = '<div class="loading-card"><span class="loader" aria-hidden="true"></span><p>Loading discussions…</p></div>';

        try {
            if (state.showFollowedOnly) {
                if (!state.currentUser) {
                    throw Object.assign(new Error("Log in to view discussions you follow."), { status: 401 });
                }
                const result = await apiRequest(`${SOCIAL_BASE}/following`);
                state.followedPosts = Array.isArray(result.posts) ? result.posts : [];
                const search = state.search.toLowerCase();
                let filtered = state.followedPosts.filter((post) => {
                    const matchesCategory = !state.category || post.category === state.category;
                    const matchesSearch = !search || `${post.title} ${post.body} ${post.username}`.toLowerCase().includes(search);
                    return matchesCategory && matchesSearch;
                });
                if (state.sort === "oldest") filtered = filtered.reverse();
                if (state.sort === "comments") filtered.sort((a, b) => Number(b.commentCount || 0) - Number(a.commentCount || 0));
                state.total = filtered.length;
                state.totalPages = Math.max(1, Math.ceil(filtered.length / 20));
                state.posts = filtered.slice((state.page - 1) * 20, state.page * 20);
            } else {
                const params = new URLSearchParams({ page: String(state.page), sort: state.sort });
                if (state.search) params.set("q", state.search);
                if (state.category) params.set("category", state.category);
                const data = await apiRequest(`${API_BASE}/posts?${params.toString()}`);
                state.posts = Array.isArray(data.posts) ? data.posts : [];
                state.total = Number(data.pagination?.total ?? state.posts.length);
                state.totalPages = Math.max(1, Number(data.pagination?.pages || 0));
            }

            elements.discussionCount.textContent = String(state.total);
            elements.resultSummary.textContent = `${state.total} ${state.total === 1 ? "discussion" : "discussions"}`;
            elements.pageIndicator.textContent = `Page ${state.page} of ${state.totalPages}`;
            elements.previousPage.disabled = state.page <= 1;
            elements.nextPage.disabled = state.page >= state.totalPages || state.posts.length === 0;
            updateFilterLabel();
            renderPosts();
            clearStatus();
        } catch (error) {
            state.posts = [];
            elements.discussionCount.textContent = "—";
            elements.resultSummary.textContent = "Unable to load";
            elements.postsContainer.innerHTML = `<div class="load-error"><strong>Could not load discussions.</strong><p>${escapeHtml(error.message)}</p><button class="button button-quiet" type="button" data-action="retry">Try again</button></div>`;
            if (error.status === 401) showStatus("Log in on the TaskSpace home page to use followed discussions and community actions.", "error");
            else showStatus(error.message, "error");
        } finally {
            state.loading = false;
            elements.postsContainer.removeAttribute("aria-busy");
        }
    }

    function updateFilterLabel() {
        const parts = [];
        if (state.showFollowedOnly) parts.push("followed discussions");
        else parts.push("all discussions");
        if (state.category) parts.push(state.category);
        if (state.search) parts.push(`search: “${state.search}”`);
        elements.activeFilterLabel.textContent = `Showing ${parts.join(" · ")}`;
    }

    function categoryOptions(selectedCategory) {
        return state.categories.map((category) => `<option value="${escapeHtml(category)}" ${category === selectedCategory ? "selected" : ""}>${escapeHtml(category)}</option>`).join("");
    }

    function renderPosts() {
        elements.postsContainer.replaceChildren();

        if (!state.posts.length) {
            const empty = document.createElement("div");
            empty.className = "empty-state";
            empty.innerHTML = `<strong>${state.showFollowedOnly ? "No followed discussions yet" : "No discussions found"}</strong>${state.showFollowedOnly ? "Follow a discussion to keep it easy to find here." : "Try another search or start a new discussion."}`;
            elements.postsContainer.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const post of state.posts) {
            const id = Number(post.id);
            const isOpen = state.openPosts.has(id);
            const ownsPost = isOwnRecord(post);
            const card = document.createElement("article");
            card.className = "post-card";
            card.dataset.postId = String(id);
            card.innerHTML = `
                <div class="post-topline"><span class="category-badge">${escapeHtml(post.category || "General")}</span><span class="post-date">${escapeHtml(formatDate(post.createdAt))}</span></div>
                <h3>${escapeHtml(post.title)}</h3>
                <div class="post-author"><span class="avatar" aria-hidden="true">${initials(post.username)}</span><span>Posted by <strong>${escapeHtml(post.username || "User")}</strong></span><span aria-hidden="true">·</span><span>${Number(post.commentCount) || 0} comments</span>${post.updatedAt && post.createdAt && post.updatedAt !== post.createdAt ? '<span>· Edited</span>' : ""}</div>
                <div class="post-body">${escapeHtml(post.body).replace(/\r?\n/g, "<br>")}</div>
                <div class="post-actions">
                    <button class="action-button" type="button" data-action="like" data-id="${id}" aria-pressed="false"><span class="action-icon" aria-hidden="true">♡</span><span class="social-count" data-count="likes">Like</span></button>
                    <button class="action-button" type="button" data-action="follow" data-id="${id}" aria-pressed="false"><span class="action-icon" aria-hidden="true">☆</span><span class="social-count" data-count="followers">Follow</span></button>
                    <button class="action-button" type="button" data-action="toggle-discussion" data-id="${id}" aria-expanded="${isOpen}"><span class="action-icon" aria-hidden="true">▤</span>${isOpen ? "Hide discussion" : "Comments and replies"}</button>
                    ${ownsPost ? `<button class="action-button" type="button" data-action="edit-post" data-id="${id}">Edit</button><button class="action-button" type="button" data-action="delete-post" data-id="${id}">Delete</button>` : ""}
                    <button class="action-button report-action" type="button" data-action="report-post" data-id="${id}"><span aria-hidden="true">⚑</span> Report</button>
                </div>
                ${ownsPost ? `<form class="inline-edit" data-form="edit-post" hidden><label>Title<input name="title" maxlength="160" required value="${escapeHtml(post.title)}"></label><label>Category<select name="category" required>${categoryOptions(post.category)}</select></label><label>Message<textarea name="body" maxlength="10000" required>${escapeHtml(post.body)}</textarea></label><div class="inline-edit-actions"><button class="button button-primary" type="submit">Save changes</button><button class="button button-quiet" type="button" data-action="cancel-edit">Cancel</button></div></form>` : ""}
                <section class="discussion-details" ${isOpen ? "" : "hidden"} aria-label="Comments and replies"><div class="comments-list"><p class="post-meta">Loading comments…</p></div><form class="comment-form" data-form="new-comment" data-post-id="${id}"><label for="comment-${id}">Add a comment</label><textarea id="comment-${id}" name="body" maxlength="5000" required placeholder="Add something useful to the conversation…"></textarea><button class="button button-primary" type="submit">Post comment</button></form></section>
            `;
            fragment.appendChild(card);
        }
        elements.postsContainer.appendChild(fragment);

        for (const post of state.posts) {
            loadSocial(Number(post.id));
            if (state.openPosts.has(Number(post.id))) loadComments(Number(post.id));
        }
    }

    async function loadSocial(postId) {
        try {
            const data = await apiRequest(`${SOCIAL_BASE}/posts/${postId}`);
            const card = elements.postsContainer.querySelector(`[data-post-id="${postId}"]`);
            if (!card) return;
            const social = data.social || {};
            const likeButton = card.querySelector('[data-action="like"]');
            const followButton = card.querySelector('[data-action="follow"]');
            if (likeButton) {
                likeButton.setAttribute("aria-pressed", String(Boolean(social.viewerLiked)));
                likeButton.querySelector('[data-count="likes"]').textContent = `${Number(social.likeCount) || 0} ${social.viewerLiked ? "Liked" : "Like"}`;
                likeButton.querySelector(".action-icon").textContent = social.viewerLiked ? "♥" : "♡";
            }
            if (followButton) {
                followButton.setAttribute("aria-pressed", String(Boolean(social.viewerFollowing)));
                followButton.querySelector('[data-count="followers"]').textContent = `${Number(social.followerCount) || 0} ${social.viewerFollowing ? "Following" : "Follow"}`;
                followButton.querySelector(".action-icon").textContent = social.viewerFollowing ? "★" : "☆";
            }
        } catch {
            // The regular discussion still works if social data is unavailable.
        }
    }

    function renderComment(comment, childrenMap, depth = 0) {
        const id = Number(comment.id);
        const ownsComment = isOwnRecord(comment);
        const children = childrenMap.get(id) || [];
        const article = document.createElement("article");
        article.className = "comment-card";
        article.dataset.commentId = String(id);
        const safeDepth = Math.min(depth, 5);
        article.innerHTML = `
            <div class="comment-topline"><div class="comment-author"><span class="avatar" aria-hidden="true">${initials(comment.username)}</span>${escapeHtml(comment.username || "User")}</div><span class="comment-meta">${escapeHtml(formatDate(comment.createdAt))}${comment.updatedAt && comment.createdAt && comment.updatedAt !== comment.createdAt ? " · Edited" : ""}</span></div>
            <div class="comment-body">${escapeHtml(comment.body).replace(/\r?\n/g, "<br>")}</div>
            <div class="comment-actions"><button class="action-button" type="button" data-action="reply-comment" data-id="${id}">↳ Reply</button>${ownsComment ? `<button class="action-button" type="button" data-action="edit-comment" data-id="${id}">Edit</button><button class="action-button" type="button" data-action="delete-comment" data-id="${id}">Delete</button>` : ""}<button class="action-button" type="button" data-action="report-comment" data-id="${id}">⚑ Report</button></div>
            ${ownsComment ? `<form class="inline-edit" data-form="edit-comment" hidden><label>Edit comment<textarea name="body" maxlength="5000" required>${escapeHtml(comment.body)}</textarea></label><div class="inline-edit-actions"><button class="button button-primary" type="submit">Save</button><button class="button button-quiet" type="button" data-action="cancel-edit">Cancel</button></div></form>` : ""}
            <form class="inline-edit reply-form" data-form="reply" data-post-id="${Number(comment.postId)}" data-parent-id="${id}" hidden><label>Write a reply<textarea name="body" maxlength="5000" required placeholder="Reply to this comment…"></textarea></label><div class="inline-edit-actions"><button class="button button-primary" type="submit">Post reply</button><button class="button button-quiet" type="button" data-action="cancel-edit">Cancel</button></div></form>
        `;
        if (safeDepth >= 5 && children.length) {
            const note = document.createElement("p");
            note.className = "post-meta";
            note.textContent = `${children.length} additional repl${children.length === 1 ? "y" : "ies"} at deeper nesting levels.`;
            article.appendChild(note);
        } else if (children.length) {
            const replies = document.createElement("div");
            replies.className = "comment-replies";
            for (const child of children) replies.appendChild(renderComment(child, childrenMap, depth + 1));
            article.appendChild(replies);
        }
        return article;
    }

    async function loadComments(postId) {
        const card = elements.postsContainer.querySelector(`[data-post-id="${postId}"]`);
        const container = card?.querySelector(".comments-list");
        if (!container) return;

        try {
            let details = state.details.get(postId);
            if (!details) {
                details = await apiRequest(`${API_BASE}/posts/${postId}`);
                state.details.set(postId, details);
            }
            if (!state.openPosts.has(postId)) return;

            const comments = Array.isArray(details.comments) ? details.comments : [];
            container.replaceChildren();
            const heading = document.createElement("h4");
            heading.className = "comments-heading";
            heading.textContent = `Comments and replies (${comments.length})`;
            container.appendChild(heading);

            if (!comments.length) {
                const empty = document.createElement("p");
                empty.className = "post-meta";
                empty.textContent = "No comments yet. Be the first to contribute.";
                container.appendChild(empty);
                return;
            }

            const childrenMap = new Map();
            const knownIds = new Set(comments.map((comment) => Number(comment.id)));
            const roots = [];
            for (const comment of comments) {
                const parentId = comment.parentCommentId == null ? null : Number(comment.parentCommentId);
                if (parentId && parentId !== Number(comment.id) && knownIds.has(parentId)) {
                    if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
                    childrenMap.get(parentId).push(comment);
                } else {
                    roots.push(comment);
                }
            }
            for (const comment of roots) container.appendChild(renderComment(comment, childrenMap));
        } catch (error) {
            container.textContent = `Could not load comments: ${error.message}`;
        }
    }

    function openReport(targetType, targetId) {
        if (!state.currentUser) {
            showStatus("Please log in on the TaskSpace home page to report content.", "error");
            return;
        }
        state.reportTarget = { targetType, targetId: Number(targetId) };
        elements.reportForm.reset();
        if (typeof elements.reportDialog.showModal === "function") elements.reportDialog.showModal();
        else showStatus("Your browser does not support the report dialog. Please update your browser.", "error");
    }

    async function applyFilters() {
        state.search = elements.searchInput.value.trim().slice(0, 100);
        state.category = elements.filterCategory.value;
        state.sort = elements.sortSelect.value;
        state.page = 1;
        state.details.clear();
        state.openPosts.clear();
        await loadPosts();
    }

    elements.createForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearStatus();
        if (!state.currentUser) {
            showStatus("Please log in on the TaskSpace home page before publishing a discussion.", "error");
            return;
        }

        const title = elements.newTitle.value.trim();
        const body = elements.newBody.value.trim();
        const category = elements.newCategory.value;
        try {
            await apiRequest(`${API_BASE}/posts`, {
                method: "POST",
                body: JSON.stringify({ title, body, category })
            });
            elements.createForm.reset();
            elements.bodyCount.textContent = "0 / 10,000";
            state.page = 1;
            state.showFollowedOnly = false;
            state.details.clear();
            showStatus("Your discussion has been published.", "success");
            await loadPosts();
        } catch (error) {
            showStatus(error.status === 401 ? "Please log in to publish a discussion." : error.message, "error");
        }
    });

    elements.newBody.addEventListener("input", () => {
        elements.bodyCount.textContent = `${elements.newBody.value.length.toLocaleString()} / 10,000`;
    });

    elements.searchButton.addEventListener("click", applyFilters);
    elements.searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            applyFilters();
        }
    });
    elements.filterCategory.addEventListener("change", applyFilters);
    elements.sortSelect.addEventListener("change", applyFilters);

    elements.clearFilters.addEventListener("click", () => {
        elements.searchInput.value = "";
        elements.filterCategory.value = "";
        elements.sortSelect.value = "newest";
        state.showFollowedOnly = false;
        state.search = "";
        state.category = "";
        state.sort = "newest";
        state.page = 1;
        state.details.clear();
        state.openPosts.clear();
        loadPosts();
    });

    elements.previousPage.addEventListener("click", () => {
        if (state.page > 1 && !state.loading) {
            state.page -= 1;
            loadPosts();
        }
    });
    elements.nextPage.addEventListener("click", () => {
        if (state.page < state.totalPages && !state.loading) {
            state.page += 1;
            loadPosts();
        }
    });

    elements.showFollowing.addEventListener("click", () => {
        if (!state.currentUser) {
            showStatus("Please log in to view discussions you follow.", "error");
            return;
        }
        state.showFollowedOnly = true;
        state.page = 1;
        state.details.clear();
        state.openPosts.clear();
        loadPosts();
    });
    elements.showAllPosts.addEventListener("click", () => {
        state.showFollowedOnly = false;
        state.page = 1;
        state.details.clear();
        state.openPosts.clear();
        loadPosts();
    });

    elements.postsContainer.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button) return;

        const action = button.dataset.action;
        const id = Number(button.dataset.id);
        const card = button.closest(".post-card");
        const commentElement = button.closest(".comment-card");
        const postId = Number(card?.dataset.postId || commentElement?.querySelector('form[data-post-id]')?.dataset.postId || commentElement?.closest(".post-card")?.dataset.postId);

        try {
            if (action === "retry") {
                loadPosts();
                return;
            }
            if (action === "like" || action === "follow") {
                if (!state.currentUser) {
                    showStatus(`Please log in to ${action === "like" ? "like" : "follow"} a discussion.`, "error");
                    return;
                }
                button.disabled = true;
                const result = await apiRequest(`${SOCIAL_BASE}/posts/${id}/${action}`, { method: "POST" });
                const social = result.social || {};
                const countNode = button.querySelector(".social-count");
                if (action === "like") {
                    button.setAttribute("aria-pressed", String(Boolean(social.viewerLiked)));
                    button.querySelector(".action-icon").textContent = social.viewerLiked ? "♥" : "♡";
                    countNode.textContent = `${Number(social.likeCount) || 0} ${social.viewerLiked ? "Liked" : "Like"}`;
                } else {
                    button.setAttribute("aria-pressed", String(Boolean(social.viewerFollowing)));
                    button.querySelector(".action-icon").textContent = social.viewerFollowing ? "★" : "☆";
                    countNode.textContent = `${Number(social.followerCount) || 0} ${social.viewerFollowing ? "Following" : "Follow"}`;
                }
                showStatus(result.message || "Updated.", "success");
                return;
            }
            if (action === "report-post") {
                openReport("post", id);
                return;
            }
            if (action === "report-comment") {
                openReport("comment", id);
                return;
            }
            if (action === "toggle-discussion") {
                if (state.openPosts.has(id)) state.openPosts.delete(id);
                else state.openPosts.add(id);
                renderPosts();
                return;
            }
            if (action === "reply-comment") {
                if (!state.currentUser) {
                    showStatus("Please log in to reply to a comment.", "error");
                    return;
                }
                const replyForm = commentElement?.querySelector('[data-form="reply"]');
                if (replyForm) {
                    replyForm.hidden = false;
                    replyForm.querySelector("textarea")?.focus();
                }
                return;
            }
            if (action === "edit-post") {
                const editForm = card?.querySelector('[data-form="edit-post"]');
                if (editForm) {
                    editForm.hidden = false;
                    editForm.querySelector('input[name="title"]')?.focus();
                }
                return;
            }
            if (action === "edit-comment") {
                const editForm = commentElement?.querySelector('[data-form="edit-comment"]');
                if (editForm) {
                    editForm.hidden = false;
                    editForm.querySelector("textarea")?.focus();
                }
                return;
            }
            if (action === "cancel-edit") {
                const form = button.closest("form");
                if (form) form.hidden = true;
                return;
            }
            if (action === "delete-post") {
                if (!window.confirm("Delete this discussion and all its comments? This cannot be undone.")) return;
                await apiRequest(`${API_BASE}/posts/${id}`, { method: "DELETE" });
                state.details.delete(id);
                state.openPosts.delete(id);
                showStatus("Discussion deleted.", "success");
                await loadPosts();
                return;
            }
            if (action === "delete-comment") {
                if (!window.confirm("Delete this comment? Replies may also be deleted.")) return;
                await apiRequest(`${API_BASE}/comments/${id}`, { method: "DELETE" });
                state.details.delete(postId);
                await loadPosts();
                showStatus("Comment deleted.", "success");
            }
        } catch (error) {
            showStatus(error.status === 401 ? "Please log in to perform this action." : error.message, "error");
        } finally {
            button.disabled = false;
        }
    });

    elements.postsContainer.addEventListener("submit", async (event) => {
        const form = event.target.closest("form[data-form]");
        if (!form) return;
        event.preventDefault();
        if (!state.currentUser) {
            showStatus("Please log in to perform this action.", "error");
            return;
        }

        const type = form.dataset.form;
        const card = form.closest(".post-card");
        const postId = Number(form.dataset.postId || card?.dataset.postId);
        try {
            if (type === "edit-post") {
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

            if (type === "new-comment" || type === "reply") {
                const body = form.elements.body.value.trim();
                const commentPayload = { body };
                if (type === "reply") commentPayload.parentCommentId = Number(form.dataset.parentId);
                await apiRequest(`${API_BASE}/posts/${postId}/comments`, {
                    method: "POST",
                    body: JSON.stringify(commentPayload)
                });
                state.details.delete(postId);
                state.openPosts.add(postId);
                showStatus(type === "reply" ? "Reply published." : "Comment published.", "success");
                await loadPosts();
                return;
            }

            if (type === "edit-comment") {
                const commentId = Number(form.closest(".comment-card")?.dataset.commentId);
                const body = form.elements.body.value.trim();
                await apiRequest(`${API_BASE}/comments/${commentId}`, {
                    method: "PATCH",
                    body: JSON.stringify({ body })
                });
                state.details.delete(postId);
                state.openPosts.add(postId);
                showStatus("Comment updated.", "success");
                await loadPosts();
            }
        } catch (error) {
            showStatus(error.status === 401 ? "Please log in to perform this action." : error.message, "error");
        }
    });

    elements.reportForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!state.currentUser || !state.reportTarget) {
            showStatus("Please log in before submitting a report.", "error");
            return;
        }
        const submitButton = elements.reportForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        try {
            const result = await apiRequest(`${SOCIAL_BASE}/reports`, {
                method: "POST",
                body: JSON.stringify({
                    ...state.reportTarget,
                    reason: elements.reportReason.value,
                    details: elements.reportDetails.value.trim()
                })
            });
            elements.reportDialog.close();
            showStatus(result.message || "Report submitted for review.", "success");
        } catch (error) {
            showStatus(error.message, "error");
        } finally {
            submitButton.disabled = false;
        }
    });

    function closeReportDialog() {
        if (typeof elements.reportDialog.close === "function" && elements.reportDialog.open) {
            elements.reportDialog.close();
        }
    }
    elements.closeReport.addEventListener("click", closeReportDialog);
    elements.cancelReport.addEventListener("click", closeReportDialog);
    elements.reportDialog.addEventListener("click", (event) => {
        if (event.target === elements.reportDialog) closeReportDialog();
    });

    async function initialize() {
        await loadCurrentUser();
        await loadCategories();
        await loadPosts();
    }

    initialize();
})();
