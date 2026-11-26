"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const elements = {
        currentUser: document.getElementById("current-user"),
        newChatForm: document.getElementById("new-chat-form"),
        usernameSearch: document.getElementById("username-search"),
        searchStatus: document.getElementById("search-status"),
        userResults: document.getElementById("user-results"),
        conversationList: document.getElementById("conversation-list"),
        emptyChat: document.getElementById("empty-chat"),
        activeChat: document.getElementById("active-chat"),
        chatTitle: document.getElementById("chat-title"),
        chatStatus: document.getElementById("chat-status"),
        messageList: document.getElementById("message-list"),
        messageForm: document.getElementById("message-form"),
        messageInput: document.getElementById("message-input"),
        sendButton: document.getElementById("send-button"),
        messageStatus: document.getElementById("message-status")
    };

    let currentUser = null;
    let activeConversationId = null;
    let refreshInProgress = false;
    let isSending = false;

    function setStatus(element, message, type = "") {
        element.textContent = message;
        element.className = "status";
        if (type) element.classList.add(type);
    }

    async function apiRequest(url, options = {}) {
        const headers = new Headers(options.headers || {});

        if (options.body && !headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
        }

        const response = await fetch(url, {
            ...options,
            headers,
            credentials: "same-origin"
        });

        const responseText = await response.text();
        let data = {};

        if (responseText) {
            try {
                data = JSON.parse(responseText);
            } catch {
                throw new Error("The server returned an unreadable response.");
            }
        }

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new Error("Your session has expired or you are not allowed to use chat. Please sign in again.");
            }

            throw new Error(data.error || data.message || `Request failed (${response.status}).`);
        }

        return data;
    }

    function formatDate(value) {
        if (!value) return "";

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";

        return date.toLocaleString([], {
            dateStyle: "short",
            timeStyle: "short"
        });
    }

    function createElement(tag, className, text) {
        const element = document.createElement(tag);

        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;

        return element;
    }

    function showLoginRequired(message) {
        elements.currentUser.textContent = "Not signed in";
        elements.chatStatus.textContent = "Sign in required";
        elements.chatStatus.classList.add("offline");
        setStatus(elements.searchStatus, message, "error");
        setStatus(elements.messageStatus, message, "error");

        elements.newChatForm.querySelector("button[type='submit']").disabled = true;
        elements.usernameSearch.disabled = true;
        elements.messageInput.disabled = true;
        elements.sendButton.disabled = true;
    }

    async function loadCurrentUser() {
        const data = await apiRequest("/api/auth/me");

        if (!data.user) {
            showLoginRequired("Please sign in on the TaskSpace homepage before using chat.");
            return false;
        }

        currentUser = data.user;
        elements.currentUser.textContent = `Signed in as ${currentUser.username}`;
        elements.chatStatus.textContent = "Connected";
        elements.chatStatus.classList.remove("offline");

        return true;
    }

    function renderUserResults(users) {
        elements.userResults.replaceChildren();

        if (!users.length) {
            elements.userResults.append(
                createElement("p", "muted", "No matching users found.")
            );
            return;
        }

        users.forEach((user) => {
            const button = createElement("button", "user-result");
            button.type = "button";

            const name = createElement("span", "user-result-name", user.username);
            const action = createElement("span", "user-result-action", "Message");

            button.append(name, action);
            button.addEventListener("click", () => startConversation(user.username));

            elements.userResults.append(button);
        });
    }

    async function searchUsers(username) {
        setStatus(elements.searchStatus, "Searching…");
        elements.userResults.replaceChildren();

        try {
            const data = await apiRequest(
                `/api/chat/users?q=${encodeURIComponent(username)}`
            );

            const users = Array.isArray(data.users) ? data.users : [];
            renderUserResults(users);

            setStatus(
                elements.searchStatus,
                users.length ? `${users.length} matching user(s) found.` : "No users found."
            );
        } catch (error) {
            setStatus(elements.searchStatus, error.message, "error");
        }
    }

    async function startConversation(username) {
        setStatus(elements.searchStatus, `Opening conversation with ${username}…`);

        try {
            const data = await apiRequest("/api/chat/conversations", {
                method: "POST",
                body: JSON.stringify({ username })
            });

            if (!data.conversation || !data.conversation.id) {
                throw new Error("The server did not return a valid conversation.");
            }

            elements.usernameSearch.value = "";
            elements.userResults.replaceChildren();
            setStatus(elements.searchStatus, "Conversation ready.", "success");

            await loadConversations();
            await openConversation(data.conversation.id, data.conversation.otherUsername || username);
        } catch (error) {
            setStatus(elements.searchStatus, error.message, "error");
        }
    }

    function renderConversations(conversations) {
        elements.conversationList.replaceChildren();

        if (!conversations.length) {
            elements.conversationList.append(
                createElement("p", "muted", "No conversations yet. Search for a username to start one.")
            );
            return;
        }

        conversations.forEach((conversation) => {
            const button = createElement("button", "conversation-item");
            button.type = "button";

            if (String(conversation.id) === String(activeConversationId)) {
                button.classList.add("selected");
            }

            const details = createElement("span", "conversation-details");
            const username = createElement(
                "span",
                "conversation-username",
                conversation.otherUsername || "TaskSpace user"
            );
            const preview = createElement(
                "span",
                "conversation-preview",
                conversation.lastMessage || "No messages yet"
            );

            details.append(username, preview);
            button.append(details);

            if (Number(conversation.unreadCount) > 0) {
                button.append(
                    createElement("span", "unread-count", String(conversation.unreadCount))
                );
            }

            button.addEventListener("click", () => {
                openConversation(conversation.id, conversation.otherUsername || "Conversation");
            });

            elements.conversationList.append(button);
        });
    }

    async function loadConversations() {
        const data = await apiRequest("/api/chat/conversations");
        const conversations = Array.isArray(data.conversations) ? data.conversations : [];

        renderConversations(conversations);
        return conversations;
    }

    function renderMessages(messages) {
        const wasNearBottom =
            elements.messageList.scrollHeight -
            elements.messageList.scrollTop -
            elements.messageList.clientHeight < 100;

        elements.messageList.replaceChildren();

        if (!messages.length) {
            elements.messageList.append(
                createElement("p", "muted message-empty", "No messages yet. Send the first message.")
            );
            return;
        }

        messages.forEach((message) => {
            const isOwnMessage =
                currentUser &&
                String(message.senderId) === String(currentUser.id);

            const wrapper = createElement(
                "article",
                `message ${isOwnMessage ? "message-own" : "message-other"}`
            );

            const metadata = createElement("div", "message-metadata");
            const sender = createElement(
                "span",
                "message-sender",
                isOwnMessage ? "You" : (message.senderUsername || "TaskSpace user")
            );
            const timestamp = createElement(
                "time",
                "message-time",
                formatDate(message.createdAt)
            );

            const body = createElement("p", "message-body", message.body || "");

            metadata.append(sender, timestamp);
            wrapper.append(metadata, body);
            elements.messageList.append(wrapper);
        });

        if (wasNearBottom) {
            elements.messageList.scrollTop = elements.messageList.scrollHeight;
        }
    }

    async function openConversation(conversationId, username) {
        activeConversationId = conversationId;

        elements.emptyChat.hidden = true;
        elements.activeChat.hidden = false;
        elements.chatTitle.textContent = username || "Conversation";
        elements.chatStatus.textContent = "Loading…";
        elements.chatStatus.classList.remove("offline");
        elements.messageList.replaceChildren(
            createElement("p", "muted message-empty", "Loading messages…")
        );

        try {
            const data = await apiRequest(
                `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`
            );

            if (String(activeConversationId) !== String(conversationId)) return;

            const messages = Array.isArray(data.messages) ? data.messages : [];
            renderMessages(messages);

            elements.chatStatus.textContent = "Connected";
            setStatus(elements.messageStatus, "");
            await loadConversations();
        } catch (error) {
            if (String(activeConversationId) !== String(conversationId)) return;

            elements.chatStatus.textContent = "Connection issue";
            elements.chatStatus.classList.add("offline");
            setStatus(elements.messageStatus, error.message, "error");
        }
    }

    async function sendMessage(event) {
        event.preventDefault();

        if (isSending || !activeConversationId) return;

        const body = elements.messageInput.value.trim();

        if (!body) {
            setStatus(elements.messageStatus, "Please enter a message.", "error");
            return;
        }

        if (body.length > 4000) {
            setStatus(elements.messageStatus, "Messages cannot exceed 4,000 characters.", "error");
            return;
        }

        isSending = true;
        elements.sendButton.disabled = true;
        setStatus(elements.messageStatus, "Sending…");

        try {
            await apiRequest(
                `/api/chat/conversations/${encodeURIComponent(activeConversationId)}/messages`,
                {
                    method: "POST",
                    body: JSON.stringify({ body })
                }
            );

            elements.messageInput.value = "";
            await openConversation(activeConversationId, elements.chatTitle.textContent);
            setStatus(elements.messageStatus, "Message sent.", "success");
        } catch (error) {
            setStatus(elements.messageStatus, error.message, "error");
        } finally {
            isSending = false;
            elements.sendButton.disabled = false;
            elements.messageInput.focus();
        }
    }

    async function refreshChat() {
        if (refreshInProgress || document.hidden || !currentUser) return;

        refreshInProgress = true;

        try {
            await loadConversations();

            if (activeConversationId) {
                const conversationId = activeConversationId;
                const data = await apiRequest(
                    `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`
                );

                if (String(activeConversationId) === String(conversationId)) {
                    renderMessages(Array.isArray(data.messages) ? data.messages : []);
                    elements.chatStatus.textContent = "Connected";
                    elements.chatStatus.classList.remove("offline");
                }
            }
        } catch (error) {
            elements.chatStatus.textContent = "Connection issue";
            elements.chatStatus.classList.add("offline");
            setStatus(elements.messageStatus, error.message, "error");
        } finally {
            refreshInProgress = false;
        }
    }

    elements.newChatForm.addEventListener("submit", (event) => {
        event.preventDefault();

        const username = elements.usernameSearch.value.trim();

        if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) {
            setStatus(
                elements.searchStatus,
                "Enter a username containing 3–30 letters, numbers or underscores.",
                "error"
            );
            return;
        }

        searchUsers(username);
    });

    elements.messageForm.addEventListener("submit", sendMessage);

    async function initialize() {
        try {
            const authenticated = await loadCurrentUser();

            if (!authenticated) return;

            await loadConversations();
            elements.chatStatus.textContent = "Connected";

            window.setInterval(refreshChat, 8000);
        } catch (error) {
            showLoginRequired(error.message);
        }
    }

    initialize();
});