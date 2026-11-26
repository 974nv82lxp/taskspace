
"use strict";

(() => {
    const MAX_FILE_SIZE = 25 * 1024 * 1024;

    const allowedTypes = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".avif": "image/avif",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".markdown": "text/markdown",
        ".csv": "text/csv"
    };

    let panel;
    let fileInput;
    let taskSelect;
    let filterSelect;
    let uploadButton;
    let message;
    let mediaList;
    let emptyState;
    let isLoading = false;

    function element(tag, className, text) {
        const node = document.createElement(tag);

        if (className) {
            node.className = className;
        }

        if (text !== undefined) {
            node.textContent = text;
        }

        return node;
    }

    function button(text, className, handler) {
        const node = element("button", className, text);
        node.type = "button";
        node.addEventListener("click", handler);
        return node;
    }

    function setMessage(text, isError = false) {
        message.textContent = text;
        message.style.color = isError ? "#ff9696" : "inherit";
    }

    async function request(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options
        });

        const contentType = response.headers.get("content-type") || "";
        let result = null;

        if (contentType.includes("application/json")) {
            result = await response.json();
        } else {
            result = await response.text();
        }

        if (!response.ok) {
            const errorMessage =
                result && typeof result === "object"
                    ? result.error || result.message
                    : result;

            throw new Error(
                errorMessage || `Request failed (${response.status}).`
            );
        }

        return result;
    }

    function getItems(result, keys) {
        if (Array.isArray(result)) {
            return result;
        }

        for (const key of keys) {
            if (result && Array.isArray(result[key])) {
                return result[key];
            }
        }

        return [];
    }

    function formatSize(bytes) {
        if (!Number.isFinite(Number(bytes))) {
            return "Unknown size";
        }

        const size = Number(bytes);

        if (size < 1024) {
            return `${size} B`;
        }

        if (size < 1024 * 1024) {
            return `${(size / 1024).toFixed(1)} KB`;
        }

        return `${(size / (1024 * 1024)).toFixed(2)} MB`;
    }

    function getExtension(filename) {
        const index = filename.lastIndexOf(".");
        return index >= 0 ? filename.slice(index).toLowerCase() : "";
    }

    function createPanel() {
        if (document.getElementById("taskspace-media-panel")) {
            panel = document.getElementById("taskspace-media-panel");
            return;
        }

        const dashboard = document.getElementById("dashboard-section");

        if (!dashboard) {
            console.error(
                "TaskSpace media: #dashboard-section was not found."
            );
            return;
        }

        const style = element("style");
        style.textContent = `
            #taskspace-media-panel {
                margin-top: 28px;
                padding: 24px;
                border: 1px solid rgba(139, 124, 255, .3);
                border-radius: 16px;
                background: rgba(20, 28, 48, .72);
                color: inherit;
            }

            #taskspace-media-panel * {
                box-sizing: border-box;
            }

            #taskspace-media-panel .media-heading {
                margin: 0 0 8px;
                font-size: 1.45rem;
            }

            #taskspace-media-panel .media-description {
                opacity: .8;
                margin: 0 0 20px;
                line-height: 1.5;
            }

            #taskspace-media-panel .media-form {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 14px;
                margin-bottom: 16px;
            }

            #taskspace-media-panel .media-field {
                display: flex;
                flex-direction: column;
                gap: 7px;
                min-width: 0;
            }

            #taskspace-media-panel .media-field-wide {
                grid-column: 1 / -1;
            }

            #taskspace-media-panel input,
            #taskspace-media-panel select,
            #taskspace-media-panel button {
                font: inherit;
            }

            #taskspace-media-panel input[type="file"],
            #taskspace-media-panel select {
                width: 100%;
                padding: 10px;
                border: 1px solid rgba(160, 170, 200, .35);
                border-radius: 8px;
                background: #111a2d;
                color: inherit;
            }

            #taskspace-media-panel .media-button {
                padding: 10px 14px;
                border: 1px solid rgba(139, 124, 255, .5);
                border-radius: 8px;
                cursor: pointer;
                background: #6655d9;
                color: white;
            }

            #taskspace-media-panel .media-button:disabled {
                opacity: .55;
                cursor: wait;
            }

            #taskspace-media-panel .media-secondary {
                background: transparent;
                color: inherit;
            }

            #taskspace-media-panel .media-message {
                min-height: 1.5em;
                margin: 12px 0;
                overflow-wrap: anywhere;
            }

            #taskspace-media-panel .media-toolbar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                margin: 22px 0 14px;
                flex-wrap: wrap;
            }

            #taskspace-media-panel .media-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
                gap: 16px;
            }

            #taskspace-media-panel .media-card {
                min-width: 0;
                padding: 12px;
                border: 1px solid rgba(160, 170, 200, .22);
                border-radius: 12px;
                background: rgba(5, 10, 22, .35);
            }

            #taskspace-media-panel .media-preview {
                display: block;
                width: 100%;
                max-height: 240px;
                margin-bottom: 12px;
                object-fit: contain;
                border-radius: 8px;
                background: #080d18;
            }

            #taskspace-media-panel video.media-preview {
                aspect-ratio: 16 / 9;
            }

            #taskspace-media-panel .media-file-icon {
                display: grid;
                place-items: center;
                min-height: 110px;
                margin-bottom: 12px;
                border-radius: 8px;
                background: rgba(139, 124, 255, .12);
                font-size: 2.3rem;
            }

            #taskspace-media-panel .media-name {
                margin: 0 0 7px;
                overflow-wrap: anywhere;
                font-weight: 600;
            }

            #taskspace-media-panel .media-meta {
                margin: 0 0 12px;
                opacity: .75;
                font-size: .85rem;
                line-height: 1.5;
                overflow-wrap: anywhere;
            }

            #taskspace-media-panel .media-actions {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }

            #taskspace-media-panel .media-actions a {
                display: inline-block;
                padding: 8px 10px;
                border: 1px solid rgba(160, 170, 200, .35);
                border-radius: 7px;
                color: inherit;
                text-decoration: none;
                font-size: .9rem;
            }

            #taskspace-media-panel .media-text-preview {
                max-height: 180px;
                overflow: auto;
                white-space: pre-wrap;
                overflow-wrap: anywhere;
                padding: 10px;
                margin: 0 0 12px;
                border-radius: 8px;
                background: #080d18;
                font-size: .8rem;
            }

            #taskspace-media-panel .media-hidden {
                display: none !important;
            }

            @media (max-width: 600px) {
                #taskspace-media-panel {
                    padding: 15px;
                }

                #taskspace-media-panel .media-form {
                    grid-template-columns: 1fr;
                }

                #taskspace-media-panel .media-field-wide {
                    grid-column: auto;
                }
            }
        `;

        document.head.appendChild(style);

        panel = element("section");
        panel.id = "taskspace-media-panel";

        const heading = element("h2", "media-heading", "Media library");
        const description = element(
            "p",
            "media-description",
            "Upload pictures, videos, and text files. Each file can be up to 25 MB. Files are stored in your TaskSpace SQLite database."
        );

        const form = element("form", "media-form");
        form.id = "taskspace-media-form";

        const fileField = element("label", "media-field media-field-wide");
        fileField.appendChild(element("span", "", "Choose files"));

        fileInput = element("input");
        fileInput.type = "file";
        fileInput.multiple = true;
        fileInput.accept = Object.keys(allowedTypes).join(",");
        fileInput.required = true;
        fileInput.id = "taskspace-media-files";
        fileField.appendChild(fileInput);

        const taskField = element("label", "media-field");
        taskField.appendChild(element("span", "", "Attach to a task (optional)"));

        taskSelect = element("select");
        taskSelect.id = "taskspace-media-task";
        taskSelect.appendChild(
            new Option("Media library only", "")
        );
        taskField.appendChild(taskSelect);

        const filterField = element("label", "media-field");
        filterField.appendChild(element("span", "", "Filter library"));

        filterSelect = element("select");
        filterSelect.id = "taskspace-media-filter";
        filterSelect.appendChild(new Option("All files", "all"));
        filterSelect.appendChild(new Option("Pictures", "image"));
        filterSelect.appendChild(new Option("Videos", "video"));
        filterSelect.appendChild(new Option("Text files", "text"));
        filterField.appendChild(filterSelect);

        const uploadField = element("div", "media-field media-field-wide");
        uploadButton = button(
            "Upload selected files",
            "media-button",
            () => form.requestSubmit()
        );
        uploadButton.type = "submit";
        uploadField.appendChild(uploadButton);

        form.append(fileField, taskField, filterField, uploadField);

        message = element("p", "media-message");
        message.setAttribute("role", "status");
        message.setAttribute("aria-live", "polite");

        const toolbar = element("div", "media-toolbar");
        toolbar.appendChild(element("strong", "", "Your files"));

        toolbar.appendChild(
            button(
                "Refresh",
                "media-button media-secondary",
                () => {
                    loadTasks();
                    loadMedia();
                }
            )
        );

        mediaList = element("div", "media-grid");
        mediaList.id = "taskspace-media-list";

        emptyState = element(
            "p",
            "",
            "No files found. Upload a picture, video, or text file to get started."
        );

        panel.append(
            heading,
            description,
            form,
            message,
            toolbar,
            emptyState,
            mediaList
        );

        dashboard.appendChild(panel);

        form.addEventListener("submit", handleUpload);
        filterSelect.addEventListener("change", loadMedia);
    }

    async function loadTasks() {
        if (!taskSelect) {
            return;
        }

        try {
            const result = await request("/api/tasks");
            const tasks = getItems(result, ["tasks", "items"]);
            const previousValue = taskSelect.value;

            taskSelect.replaceChildren(
                new Option("Media library only", "")
            );

            for (const task of tasks) {
                if (!task || task.id === undefined || task.id === null) {
                    continue;
                }

                const title = task.title || `Task ${task.id}`;
                const option = new Option(title, String(task.id));
                taskSelect.appendChild(option);
            }

            if (
                [...taskSelect.options].some(
                    option => option.value === previousValue
                )
            ) {
                taskSelect.value = previousValue;
            }
        } catch (error) {
            console.error("TaskSpace media: could not load tasks.", error);
        }
    }

    function classifyMedia(media) {
        const mime = String(media.mime_type || media.mimeType || "").toLowerCase();

        if (mime.startsWith("image/")) {
            return "image";
        }

        if (mime.startsWith("video/")) {
            return "video";
        }

        return "text";
    }

    function mediaContentUrl(id) {
        return `/api/media/${encodeURIComponent(id)}/content`;
    }

    function mediaDownloadUrl(id) {
        return `/api/media/${encodeURIComponent(id)}/download`;
    }

    function createMediaCard(media) {
        const id = media.id;
        const name = media.original_name || media.originalName || "Unnamed file";
        const mime = media.mime_type || media.mimeType || "";
        const kind = classifyMedia(media);
        const card = element("article", "media-card");

        if (kind === "image") {
            const preview = element("img", "media-preview");
            preview.src = mediaContentUrl(id);
            preview.alt = name;
            preview.loading = "lazy";
            preview.onerror = () => {
                preview.removeAttribute("src");
                preview.alt = "Preview unavailable";
            };
            card.appendChild(preview);
        } else if (kind === "video") {
            const preview = element("video", "media-preview");
            preview.src = mediaContentUrl(id);
            preview.controls = true;
            preview.preload = "metadata";
            preview.setAttribute("aria-label", name);
            card.appendChild(preview);
        } else {
            card.appendChild(element("div", "media-file-icon", "TXT"));
        }

        card.appendChild(element("p", "media-name", name));

        const size = media.size_bytes ?? media.sizeBytes ?? 0;
        const created = media.created_at || media.createdAt || "";
        const taskName =
            media.task_title ||
            media.taskTitle ||
            (media.task_id ? `Task ID ${media.task_id}` : "Media library only");

        card.appendChild(
            element(
                "p",
                "media-meta",
                `${mime || kind} · ${formatSize(size)}\n${taskName}${created ? `\nAdded: ${created}` : ""}`
            )
        );

        if (kind === "text") {
            const previewButton = button(
                "Preview text",
                "media-button media-secondary",
                async () => {
                    const existing = card.querySelector(".media-text-preview");

                    if (existing) {
                        existing.remove();
                        previewButton.textContent = "Preview text";
                        return;
                    }

                    previewButton.disabled = true;

                    try {
                        const response = await fetch(mediaContentUrl(id), {
                            credentials: "same-origin"
                        });

                        if (!response.ok) {
                            throw new Error("Could not load the text preview.");
                        }

                        const text = await response.text();
                        const preview = element(
                            "pre",
                            "media-text-preview",
                            text.slice(0, 20000) +
                                (text.length > 20000
                                    ? "\n\n[Preview shortened]"
                                    : "")
                        );

                        card.insertBefore(preview, actions);
                        previewButton.textContent = "Hide preview";
                    } catch (error) {
                        setMessage(error.message, true);
                    } finally {
                        previewButton.disabled = false;
                    }
                }
            );

            card.appendChild(previewButton);
        }

        const actions = element("div", "media-actions");

        const download = element("a", "", "Download");
        download.href = mediaDownloadUrl(id);
        download.setAttribute("download", "");
        actions.appendChild(download);

        actions.appendChild(
            button("Delete", "media-button media-secondary", async () => {
                if (!window.confirm(`Delete "${name}" permanently?`)) {
                    return;
                }

                try {
                    await request(`/api/media/${encodeURIComponent(id)}`, {
                        method: "DELETE"
                    });

                    setMessage(`Deleted ${name}.`);
                    await loadMedia();
                } catch (error) {
                    setMessage(error.message, true);
                }
            })
        );

        card.appendChild(actions);
        return card;
    }

    async function loadMedia() {
        if (!mediaList || isLoading) {
            return;
        }

        isLoading = true;
        mediaList.replaceChildren();
        emptyState.classList.remove("media-hidden");
        emptyState.textContent = "Loading files…";

        try {
            const result = await request("/api/media");
            let items = getItems(result, ["media", "files", "items"]);

            const filter = filterSelect.value;

            if (filter !== "all") {
                items = items.filter(item => classifyMedia(item) === filter);
            }

            for (const item of items) {
                mediaList.appendChild(createMediaCard(item));
            }

            emptyState.classList.toggle("media-hidden", items.length > 0);

            if (items.length === 0) {
                emptyState.textContent =
                    filter === "all"
                        ? "No files yet. Upload your first file above."
                        : `No ${filter} files found.`;
            }
        } catch (error) {
            emptyState.classList.remove("media-hidden");
            emptyState.textContent = "Could not load the media library.";
            setMessage(error.message, true);
        } finally {
            isLoading = false;
        }
    }

    async function handleUpload(event) {
        event.preventDefault();

        const files = [...fileInput.files];

        if (files.length === 0) {
            setMessage("Choose at least one file.", true);
            return;
        }

        for (const file of files) {
            const extension = getExtension(file.name);

            if (!Object.hasOwn(allowedTypes, extension)) {
                setMessage(`Unsupported file type: ${file.name}`, true);
                return;
            }

            if (file.size > MAX_FILE_SIZE) {
                setMessage(`${file.name} exceeds the 25 MB limit.`, true);
                return;
            }

            if (file.size === 0) {
                setMessage(`${file.name} is empty.`, true);
                return;
            }
        }

        uploadButton.disabled = true;
        fileInput.disabled = true;

        let uploaded = 0;
        const failures = [];

        try {
            for (const file of files) {
                setMessage(
                    `Uploading ${uploaded + 1} of ${files.length}: ${file.name}`
                );

                const headers = {
                    "Content-Type": "application/octet-stream",
                    "X-File-Name": encodeURIComponent(file.name),
                    "X-File-Type": allowedTypes[getExtension(file.name)]
                };

                if (taskSelect.value) {
                    headers["X-Task-Id"] = taskSelect.value;
                }

                try {
                    await request("/api/media", {
                        method: "POST",
                        headers,
                        body: file
                    });

                    uploaded++;
                } catch (error) {
                    failures.push(`${file.name}: ${error.message}`);
                }
            }

            fileInput.value = "";

            if (uploaded > 0) {
                await loadMedia();
            }

            if (failures.length > 0) {
                setMessage(
                    `Uploaded ${uploaded} of ${files.length} file(s). ${failures.join(" | ")}`,
                    true
                );
            } else {
                setMessage(`Successfully uploaded ${uploaded} file(s).`);
            }
        } catch (error) {
            setMessage(error.message, true);
        } finally {
            uploadButton.disabled = false;
            fileInput.disabled = false;
        }
    }

    function isDashboardVisible() {
        const dashboard = document.getElementById("dashboard-section");
        return dashboard && !dashboard.classList.contains("hidden");
    }

    function onDashboardShown() {
        if (!isDashboardVisible()) {
            return;
        }

        createPanel();
        loadTasks();
        loadMedia();
    }

    function initialize() {
        createPanel();

        const dashboard = document.getElementById("dashboard-section");

        if (!dashboard) {
            console.error(
                "TaskSpace media: dashboard section not found. Check public/index.html."
            );
            return;
        }

        const observer = new MutationObserver(onDashboardShown);

        observer.observe(dashboard, {
            attributes: true,
            attributeFilter: ["class"]
        });

        onDashboardShown();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
