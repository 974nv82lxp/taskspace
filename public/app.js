"use strict";

const authSection = document.querySelector("#auth-section");
const dashboardSection = document.querySelector("#dashboard-section");

const authForm = document.querySelector("#auth-form");
const authHeading = document.querySelector("#auth-heading");
const authDescription = document.querySelector("#auth-description");
const authSubmit = document.querySelector("#auth-submit");
const authMessage = document.querySelector("#auth-message");
const passwordInput = document.querySelector("#password");
const passwordHelp = document.querySelector("#password-help");

const loginTab = document.querySelector("#login-tab");
const registerTab = document.querySelector("#register-tab");

const welcomeHeading = document.querySelector("#welcome-heading");
const logoutButton = document.querySelector("#logout-button");

const taskForm = document.querySelector("#task-form");
const taskTitleInput = document.querySelector("#task-title");
const taskCategoryInput = document.querySelector("#task-category");
const taskCategoryFilterInput = document.querySelector("#task-category-filter");
const taskPriorityInput = document.querySelector("#task-priority");
const taskDueDateInput = document.querySelector("#task-due-date");
const taskSearchInput = document.querySelector("#task-search");
const taskFilterInput = document.querySelector("#task-filter");
const taskSortInput = document.querySelector("#task-sort");
const taskMessage = document.querySelector("#task-message");
const taskList = document.querySelector("#task-list");
const emptyState = document.querySelector("#empty-state");

const totalCount = document.querySelector("#total-count");
const completedCount = document.querySelector("#completed-count");
const remainingCount = document.querySelector("#remaining-count");
const taskListCount = document.querySelector("#task-list-count");

const overallPercentage = document.querySelector("#overall-percentage");
const overallProgress = document.querySelector("#overall-progress");
const overallProgressFill = document.querySelector("#overall-progress-fill");
const progressSummary = document.querySelector("#progress-summary");
const categoryProgressGrid = document.querySelector("#category-progress-grid");

const deadlineOverdueCount = document.querySelector("#deadline-overdue-count");
const deadlineTodayCount = document.querySelector("#deadline-today-count");
const deadlineUpcomingCount = document.querySelector("#deadline-upcoming-count");
const upcomingTaskList = document.querySelector("#upcoming-task-list");

// Browser notification controls
const notificationButton = document.querySelector(
    "#enable-notifications-button"
);

// Prevent repeated notifications during the current page session.
const notifiedTaskIds = new Set();

const TASK_CATEGORIES = ["Work", "Personal", "Study", "Shopping"];

const CATEGORY_STYLES = {
    Work: "category-work",
    Personal: "category-personal",
    Study: "category-study",
    Shopping: "category-shopping"
};

let authMode = "login";
let currentUser = null;
let tasks = [];
let loadSequence = 0;
let searchTimer = null;

// --------------------------------------------------
// API helper
// --------------------------------------------------

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...(options.body
                ? { "Content-Type": "application/json" }
                : {}),
            ...options.headers
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "The request failed.");
    }

    return data;
}

function showMessage(element, message = "", type = "") {
    element.textContent = message;
    element.classList.remove("error", "success");

    if (type) {
        element.classList.add(type);
    }
}

function escapeDateLabel(dateValue) {
    if (!dateValue) return "No due date";

    const parts = dateValue.split("-");

    if (parts.length !== 3) return dateValue;

    return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function priorityLabel(priority) {
    const allowed = ["low", "medium", "high"];
    const value = allowed.includes(priority) ? priority : "medium";

    return value.charAt(0).toUpperCase() + value.slice(1);
}

function categoryLabel(category) {
    return TASK_CATEGORIES.includes(category) ? category : "Personal";
}

function isValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

// Uses the computer's local date instead of UTC.
function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function getProgressPercentage(completed, total) {
    if (total === 0) return 0;

    return Math.round((completed / total) * 100);
}

function setProgressBar(bar, fill, percentage) {
    const safePercentage = Math.max(0, Math.min(100, percentage));

    bar.setAttribute("aria-valuenow", String(safePercentage));
    fill.style.width = `${safePercentage}%`;
}

// --------------------------------------------------
// Browser notifications
// --------------------------------------------------

function checkTaskNotifications(currentTasks) {
    if (!("Notification" in window)) {
        return;
    }

    if (Notification.permission !== "granted") {
        return;
    }

    const today = getLocalDateString();

    for (const task of currentTasks) {
        // Ignore completed tasks and tasks without deadlines.
        if (Boolean(task.completed) || !task.due_date) {
            continue;
        }

        // Ignore tasks that are not overdue or due today.
        if (task.due_date > today) {
            continue;
        }

        // A task should only notify once during this page session.
        const notificationKey = `${currentUser?.username}:${task.id}`;

        if (notifiedTaskIds.has(notificationKey)) {
            continue;
        }

        notifiedTaskIds.add(notificationKey);

        const isOverdue = task.due_date < today;

        try {
            new Notification(
                isOverdue ? "Overdue task" : "Task due today",
                {
                    body: task.title,
                    tag: `task-${task.id}`
                }
            );
        } catch (error) {
            console.error("Could not display task notification:", error);
        }
    }
}

if (notificationButton) {
    notificationButton.addEventListener("click", async () => {
        if (!("Notification" in window)) {
            showMessage(
                taskMessage,
                "Your browser does not support notifications.",
                "error"
            );
            return;
        }

        if (Notification.permission === "granted") {
            notificationButton.textContent = "Reminders enabled";
            checkTaskNotifications(tasks);
            return;
        }

        if (Notification.permission === "denied") {
            showMessage(
                taskMessage,
                "Notifications are blocked. Allow them in your browser's site settings.",
                "error"
            );
            return;
        }

        notificationButton.disabled = true;

        try {
            const permission = await Notification.requestPermission();

            if (permission === "granted") {
                notificationButton.textContent = "Reminders enabled";

                showMessage(
                    taskMessage,
                    "Browser reminders enabled.",
                    "success"
                );

                checkTaskNotifications(tasks);
            } else {
                showMessage(
                    taskMessage,
                    "Notifications were not enabled. Check your browser permissions.",
                    "error"
                );
            }
        } catch (error) {
            showMessage(
                taskMessage,
                "Could not enable browser notifications.",
                "error"
            );
        } finally {
            notificationButton.disabled = false;
        }
    });
}

// --------------------------------------------------
// Login and registration
// --------------------------------------------------

function setAuthMode(mode) {
    authMode = mode;

    const isLogin = mode === "login";

    authHeading.textContent = isLogin
        ? "Welcome back"
        : "Create your account";

    authDescription.textContent = isLogin
        ? "Log in to continue to your workspace."
        : "Create an account to start organizing your tasks.";

    authSubmit.textContent = isLogin ? "Log in" : "Create account";

    loginTab.classList.toggle("active", isLogin);
    registerTab.classList.toggle("active", !isLogin);

    passwordInput.autocomplete = isLogin
        ? "current-password"
        : "new-password";

    passwordHelp.classList.toggle("hidden", isLogin);

    showMessage(authMessage);
}

loginTab.addEventListener("click", () => setAuthMode("login"));
registerTab.addEventListener("click", () => setAuthMode("register"));

authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage(authMessage);

    const username = document.querySelector("#username").value.trim();
    const password = passwordInput.value;

    authSubmit.disabled = true;
    authSubmit.textContent = "Please wait...";

    try {
        const endpoint = authMode === "login"
            ? "/api/auth/login"
            : "/api/auth/register";

        const data = await api(endpoint, {
            method: "POST",
            body: JSON.stringify({ username, password })
        });

        currentUser = data.user;
        authForm.reset();

        await showDashboard();
    } catch (error) {
        showMessage(authMessage, error.message, "error");
    } finally {
        authSubmit.disabled = false;
        authSubmit.textContent = authMode === "login"
            ? "Log in"
            : "Create account";
    }
});

// --------------------------------------------------
// Dashboard and session
// --------------------------------------------------

async function showDashboard() {
    if (!currentUser) {
        showAuth();
        return;
    }

    authSection.classList.add("hidden");
    dashboardSection.classList.remove("hidden");

    welcomeHeading.textContent = `Welcome, ${currentUser.username}`;

    if (
        notificationButton &&
        "Notification" in window &&
        Notification.permission === "granted"
    ) {
        notificationButton.textContent = "Reminders enabled";
    }

    await loadTasks();
}

function resetProgressDisplay() {
    totalCount.textContent = "0";
    completedCount.textContent = "0";
    remainingCount.textContent = "0";

    overallPercentage.textContent = "0%";
    setProgressBar(overallProgress, overallProgressFill, 0);
    progressSummary.textContent = "No tasks to measure yet.";

    renderCategoryProgress([]);
    renderDeadlineAnalytics([]);
    renderUpcomingTasks([]);
}

function showAuth() {
    currentUser = null;
    tasks = [];
    loadSequence++;

    dashboardSection.classList.add("hidden");
    authSection.classList.remove("hidden");

    taskList.replaceChildren();

    resetProgressDisplay();

    taskListCount.textContent = "0 tasks";

    showMessage(taskMessage);
    showMessage(authMessage);
}

// --------------------------------------------------
// Load tasks with search, filtering, and sorting
// --------------------------------------------------

async function loadTasks() {
    if (!currentUser) return;

    const thisRequest = ++loadSequence;
    const parameters = new URLSearchParams();

    const search = taskSearchInput.value.trim();
    const filter = taskFilterInput.value;
    const sort = taskSortInput.value;
    const category = taskCategoryFilterInput.value;

    if (search) parameters.set("search", search);
    if (filter !== "all") parameters.set("filter", filter);
    if (sort !== "newest") parameters.set("sort", sort);
    if (category !== "all") parameters.set("category", category);

    const query = parameters.toString();
    const url = query ? `/api/tasks?${query}` : "/api/tasks";

    try {
        const data = await api(url);

        if (thisRequest !== loadSequence) return;

        tasks = Array.isArray(data.tasks) ? data.tasks : [];
        renderTasks();
    } catch (error) {
        if (thisRequest !== loadSequence) return;

        if (error.message === "Please log in first.") {
            showAuth();
        } else {
            showMessage(taskMessage, error.message, "error");
        }
    }
}

// --------------------------------------------------
// Button helper
// --------------------------------------------------

function makeButton(text, className, label) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = className;
    button.textContent = text;
    button.setAttribute("aria-label", label);

    return button;
}

// --------------------------------------------------
// Progress dashboard
// --------------------------------------------------

function renderProgress() {
    const total = tasks.length;

    const completed = tasks.filter(
        (task) => Boolean(task.completed)
    ).length;

    const remaining = total - completed;
    const percentage = getProgressPercentage(completed, total);

    totalCount.textContent = String(total);
    completedCount.textContent = String(completed);
    remainingCount.textContent = String(remaining);

    overallPercentage.textContent = `${percentage}%`;

    setProgressBar(overallProgress, overallProgressFill, percentage);

    if (total === 0) {
        progressSummary.textContent =
            "No tasks match your current filters. Try changing your search or filters.";
    } else if (remaining === 0) {
        progressSummary.textContent =
            `Excellent! All ${total} ${total === 1 ? "task is" : "tasks are"} completed in this view.`;
    } else {
        progressSummary.textContent =
            `${completed} of ${total} ${total === 1 ? "task" : "tasks"} completed · ${remaining} remaining.`;
    }

    renderCategoryProgress(tasks);
    renderDeadlineAnalytics(tasks);
    renderUpcomingTasks(tasks);

    // Check deadlines whenever tasks are rendered.
    checkTaskNotifications(tasks);
}

function renderCategoryProgress(currentTasks) {
    categoryProgressGrid.replaceChildren();

    for (const categoryName of TASK_CATEGORIES) {
        const categoryTasks = currentTasks.filter(
            (task) => categoryLabel(task.category) === categoryName
        );

        const completed = categoryTasks.filter(
            (task) => Boolean(task.completed)
        ).length;

        const total = categoryTasks.length;
        const remaining = total - completed;
        const percentage = getProgressPercentage(completed, total);

        const card = document.createElement("article");
        card.className =
            `category-progress-card ${CATEGORY_STYLES[categoryName]}`;

        const heading = document.createElement("div");
        heading.className = "category-card-heading";

        const title = document.createElement("h3");
        title.textContent = categoryName;

        const categoryCount = document.createElement("span");
        categoryCount.className = "category-total";
        categoryCount.textContent =
            `${total} ${total === 1 ? "task" : "tasks"}`;

        heading.append(title, categoryCount);

        const percentageLabel = document.createElement("p");
        percentageLabel.className = "category-progress-percentage";
        percentageLabel.textContent = `${percentage}%`;

        const track = document.createElement("div");
        track.className = "progress-track category-progress-track";
        track.setAttribute("role", "progressbar");
        track.setAttribute("aria-label", `${categoryName} task completion`);
        track.setAttribute("aria-valuemin", "0");
        track.setAttribute("aria-valuemax", "100");
        track.setAttribute("aria-valuenow", String(percentage));

        const fill = document.createElement("div");
        fill.className = "progress-fill";
        fill.style.width = `${percentage}%`;

        track.append(fill);

        const counts = document.createElement("p");
        counts.className = "category-progress-counts";
        counts.textContent = `${completed} completed · ${remaining} remaining`;

        if (total === 0) {
            counts.textContent = "No matching tasks";
        }

        card.append(heading, percentageLabel, track, counts);
        categoryProgressGrid.append(card);
    }
}

// --------------------------------------------------
// Deadline analytics
// --------------------------------------------------

function renderDeadlineAnalytics(currentTasks) {
    const today = getLocalDateString();

    const nextWeekDate = new Date();
    nextWeekDate.setHours(0, 0, 0, 0);
    nextWeekDate.setDate(nextWeekDate.getDate() + 7);

    const nextWeek = getLocalDateString(nextWeekDate);

    const pendingTasks = currentTasks.filter(
        (task) => !Boolean(task.completed)
    );

    const overdue = pendingTasks.filter(
        (task) => task.due_date && task.due_date < today
    ).length;

    const dueToday = pendingTasks.filter(
        (task) => task.due_date && task.due_date === today
    ).length;

    const upcoming = pendingTasks.filter(
        (task) =>
            task.due_date &&
            task.due_date > today &&
            task.due_date <= nextWeek
    ).length;

    if (deadlineOverdueCount) {
        deadlineOverdueCount.textContent = String(overdue);
    }

    if (deadlineTodayCount) {
        deadlineTodayCount.textContent = String(dueToday);
    }

    if (deadlineUpcomingCount) {
        deadlineUpcomingCount.textContent = String(upcoming);
    }
}

// --------------------------------------------------
// Upcoming Tasks: next seven days, maximum five
// --------------------------------------------------

function renderUpcomingTasks(currentTasks) {
    if (!upcomingTaskList) return;

    upcomingTaskList.replaceChildren();

    const today = getLocalDateString();

    const nextWeekDate = new Date();
    nextWeekDate.setHours(0, 0, 0, 0);
    nextWeekDate.setDate(nextWeekDate.getDate() + 7);

    const nextWeek = getLocalDateString(nextWeekDate);

    const upcomingTasks = currentTasks
        .filter((task) => {
            return (
                !Boolean(task.completed) &&
                task.due_date &&
                task.due_date >= today &&
                task.due_date <= nextWeek
            );
        })
        .sort((a, b) => {
            const dateComparison = a.due_date.localeCompare(b.due_date);

            return dateComparison ||
                String(a.title).localeCompare(String(b.title));
        })
        .slice(0, 5);

    if (upcomingTasks.length === 0) {
        const emptyMessage = document.createElement("p");
        emptyMessage.className = "muted";
        emptyMessage.textContent =
            "No unfinished tasks are due in the next seven days.";

        upcomingTaskList.append(emptyMessage);
        return;
    }

    for (const task of upcomingTasks) {
        const item = document.createElement("article");
        item.className = "upcoming-task-item";

        const details = document.createElement("div");
        details.className = "upcoming-task-details";

        const title = document.createElement("h3");
        title.className = "upcoming-task-title";
        title.textContent = task.title;

        const metadata = document.createElement("p");
        metadata.className = "muted upcoming-task-meta";

        const category = categoryLabel(task.category);
        const priority = priorityLabel(task.priority);

        metadata.textContent = `${category} · ${priority} priority`;

        const deadline = document.createElement("time");
        deadline.className = "upcoming-task-deadline";
        deadline.dateTime = task.due_date;
        deadline.textContent = escapeDateLabel(task.due_date);

        if (task.due_date === today) {
            deadline.classList.add("due-today");
            deadline.textContent = `Today · ${deadline.textContent}`;
        }

        details.append(title, metadata);
        item.append(details, deadline);
        upcomingTaskList.append(item);
    }
}

// --------------------------------------------------
// Edit title, category, priority, and due date
// --------------------------------------------------

async function editTask(task, editButton) {
    const newTitle = window.prompt("Task title:", task.title);

    if (newTitle === null) return;

    const cleanTitle = newTitle.trim();

    if (!cleanTitle) {
        showMessage(taskMessage, "Task title cannot be empty.", "error");
        return;
    }

    if (cleanTitle.length > 200) {
        showMessage(
            taskMessage,
            "Task title cannot exceed 200 characters.",
            "error"
        );
        return;
    }

    const newCategory = window.prompt(
        "Category: enter Work, Personal, Study, or Shopping.",
        categoryLabel(task.category)
    );

    if (newCategory === null) return;

    const cleanCategory = newCategory.trim();

    if (!TASK_CATEGORIES.includes(cleanCategory)) {
        showMessage(
            taskMessage,
            "Category must be Work, Personal, Study, or Shopping.",
            "error"
        );
        return;
    }

    const currentPriority = ["low", "medium", "high"].includes(task.priority)
        ? task.priority
        : "medium";

    const newPriority = window.prompt(
        "Priority: enter low, medium, or high.",
        currentPriority
    );

    if (newPriority === null) return;

    const cleanPriority = newPriority.trim().toLowerCase();

    if (!["low", "medium", "high"].includes(cleanPriority)) {
        showMessage(
            taskMessage,
            "Priority must be low, medium, or high.",
            "error"
        );
        return;
    }

    const newDueDate = window.prompt(
        "Due date in YYYY-MM-DD format. Leave blank to remove the deadline.",
        task.due_date || ""
    );

    if (newDueDate === null) return;

    const cleanDueDate = newDueDate.trim();

    if (cleanDueDate && !isValidDate(cleanDueDate)) {
        showMessage(
            taskMessage,
            "Enter a real date in YYYY-MM-DD format, or leave it blank.",
            "error"
        );
        return;
    }

    editButton.disabled = true;

    try {
        await api(`/api/tasks/${task.id}`, {
            method: "PATCH",
            body: JSON.stringify({
                title: cleanTitle,
                category: cleanCategory,
                priority: cleanPriority,
                due_date: cleanDueDate || null
            })
        });

        showMessage(
            taskMessage,
            "Task details updated successfully.",
            "success"
        );

        await loadTasks();
    } catch (error) {
        showMessage(taskMessage, error.message, "error");
    } finally {
        editButton.disabled = false;
    }
}

// --------------------------------------------------
// Render tasks
// --------------------------------------------------

function renderTasks() {
    taskList.replaceChildren();

    for (const task of tasks) {
        const isCompleted = Boolean(task.completed);

        const item = document.createElement("li");
        item.className = "task-item";

        if (isCompleted) {
            item.classList.add("completed");
        }

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "task-checkbox";
        checkbox.checked = isCompleted;
        checkbox.setAttribute(
            "aria-label",
            `Mark ${task.title} ${isCompleted ? "incomplete" : "complete"}`
        );

        checkbox.addEventListener("change", async () => {
            checkbox.disabled = true;

            try {
                await api(`/api/tasks/${task.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                        completed: checkbox.checked
                    })
                });

                await loadTasks();
            } catch (error) {
                showMessage(taskMessage, error.message, "error");
                await loadTasks();
            }
        });

        const details = document.createElement("div");
        details.className = "task-details";

        const title = document.createElement("span");
        title.className = "task-title";
        title.textContent = task.title;

        const metadata = document.createElement("div");
        metadata.className = "task-metadata";

        const category = document.createElement("span");
        category.className = "priority-badge task-category";
        category.textContent = categoryLabel(task.category);

        const priorityValue = ["low", "medium", "high"].includes(task.priority)
            ? task.priority
            : "medium";

        const priority = document.createElement("span");
        priority.className = `priority-badge priority-${priorityValue}`;
        priority.textContent = `${priorityLabel(priorityValue)} priority`;

        const dueDate = document.createElement("span");
        dueDate.className = "due-date";
        dueDate.textContent = escapeDateLabel(task.due_date);

        const today = getLocalDateString();

        if (task.due_date && !isCompleted && task.due_date < today) {
            dueDate.classList.add("overdue");
            dueDate.textContent =
                `Overdue · ${escapeDateLabel(task.due_date)}`;
        }

        metadata.append(category, priority, dueDate);
        details.append(title, metadata);

        const actions = document.createElement("div");
        actions.className = "task-actions";

        const editButton = makeButton(
            "Edit",
            "edit-button",
            `Edit ${task.title}`
        );

        editButton.addEventListener("click", () => {
            editTask(task, editButton);
        });

        const deleteButton = makeButton(
            "Delete",
            "delete-button",
            `Delete ${task.title}`
        );

        deleteButton.addEventListener("click", async () => {
            if (!window.confirm(`Delete "${task.title}"?`)) return;

            deleteButton.disabled = true;

            try {
                await api(`/api/tasks/${task.id}`, {
                    method: "DELETE"
                });

                showMessage(
                    taskMessage,
                    "Task deleted successfully.",
                    "success"
                );

                await loadTasks();
            } catch (error) {
                showMessage(taskMessage, error.message, "error");
                deleteButton.disabled = false;
            }
        });

        actions.append(editButton, deleteButton);
        item.append(checkbox, details, actions);
        taskList.append(item);
    }

    renderProgress();

    taskListCount.textContent =
        `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;

    emptyState.classList.toggle("hidden", tasks.length > 0);
}

// --------------------------------------------------
// Create a task
// --------------------------------------------------

taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage(taskMessage);

    const title = taskTitleInput.value.trim();
    const category = taskCategoryInput.value;
    const priority = taskPriorityInput.value;
    const due_date = taskDueDateInput.value || null;

    if (!title) {
        showMessage(taskMessage, "Enter a task title.", "error");
        return;
    }

    if (!TASK_CATEGORIES.includes(category)) {
        showMessage(taskMessage, "Choose a valid category.", "error");
        return;
    }

    const submitButton = taskForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    try {
        await api("/api/tasks", {
            method: "POST",
            body: JSON.stringify({
                title,
                category,
                priority,
                due_date
            })
        });

        taskForm.reset();
        taskCategoryInput.value = "Personal";
        taskPriorityInput.value = "medium";

        taskSearchInput.value = "";
        taskCategoryFilterInput.value = "all";
        taskFilterInput.value = "all";
        taskSortInput.value = "newest";

        await loadTasks();

        showMessage(taskMessage, "Task added successfully.", "success");
        taskTitleInput.focus();
    } catch (error) {
        showMessage(taskMessage, error.message, "error");
    } finally {
        submitButton.disabled = false;
    }
});

// --------------------------------------------------
// Search, filter, and sort
// --------------------------------------------------

taskSearchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadTasks, 250);
});

taskCategoryFilterInput.addEventListener("change", loadTasks);
taskFilterInput.addEventListener("change", loadTasks);
taskSortInput.addEventListener("change", loadTasks);

// --------------------------------------------------
// Log out
// --------------------------------------------------

logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;

    try {
        await api("/api/auth/logout", {
            method: "POST"
        });

        showAuth();
        setAuthMode("login");
    } catch (error) {
        showMessage(taskMessage, error.message, "error");
    } finally {
        logoutButton.disabled = false;
    }
});

// --------------------------------------------------
// Restore the login session on page load
// --------------------------------------------------

async function initialize() {
    try {
        const data = await api("/api/auth/me");

        if (data.user) {
            currentUser = data.user;
            await showDashboard();
        } else {
            showAuth();
        }
    } catch {
        showAuth();

        showMessage(
            authMessage,
            "Cannot connect to the server. Make sure TaskSpace is running.",
            "error"
        );
    }
}

initialize();