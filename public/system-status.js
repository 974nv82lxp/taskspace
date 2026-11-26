"use strict";

const refreshButton = document.getElementById("refresh-status");
const overallIndicator = document.getElementById("overall-indicator");
const overallTitle = document.getElementById("overall-title");
const overallMessage = document.getElementById("overall-message");
const applicationStatus = document.getElementById("application-status");
const databaseStatus = document.getElementById("database-status");
const sessionStatus = document.getElementById("session-status");
const uptimeStatus = document.getElementById("uptime-status");
const lastChecked = document.getElementById("last-checked");
const loginNotice = document.getElementById("login-notice");
const errorNotice = document.getElementById("error-notice");

function setValue(element, value, state) {
    element.textContent = value;
    element.classList.remove("status-ok", "status-error", "status-unknown");

    if (state === "ok") {
        element.classList.add("status-ok");
    } else if (state === "error") {
        element.classList.add("status-error");
    } else {
        element.classList.add("status-unknown");
    }
}

function formatUptime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return "Unavailable";
    }

    const total = Math.floor(seconds);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainingSeconds = total % 60;

    return `${days}d ${hours}h ${minutes}m ${remainingSeconds}s`;
}

async function refreshStatus() {
    refreshButton.disabled = true;
    refreshButton.textContent = "Checking…";
    loginNotice.hidden = true;
    errorNotice.hidden = true;

    overallIndicator.className = "status-indicator status-unknown";
    overallTitle.textContent = "Checking TaskSpace…";
    overallMessage.textContent = "Requesting current server status.";

    setValue(applicationStatus, "Checking…", "unknown");
    setValue(databaseStatus, "Checking…", "unknown");
    setValue(sessionStatus, "Checking…", "unknown");
    uptimeStatus.textContent = "—";

    try {
        const response = await fetch("/api/system-status", {
            method: "GET",
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            cache: "no-store"
        });

        const data = await response.json().catch(() => ({}));
        lastChecked.textContent = `Checked at ${new Date().toLocaleString()}`;

        if (response.status === 401) {
            overallIndicator.className = "status-indicator status-unknown";
            overallTitle.textContent = "Sign-in required";
            overallMessage.textContent =
                "The status endpoint is protected to keep system diagnostics private.";
            applicationStatus.textContent = "Authentication required";
            databaseStatus.textContent = "Not checked";
            sessionStatus.textContent = "Not checked";
            loginNotice.hidden = false;
            return;
        }

        if (!response.ok && !data.checks) {
            throw new Error(data.error || `Server returned HTTP ${response.status}.`);
        }

        const databaseOk = data.checks?.database === "ok";
        const sessionOk = data.checks?.sessionConfiguration === "ok";
        const appOk = response.ok && data.status === "ok";

        setValue(applicationStatus, appOk ? "Operational" : "Degraded", appOk ? "ok" : "error");
        setValue(databaseStatus, databaseOk ? "Connected" : "Error", databaseOk ? "ok" : "error");
        setValue(sessionStatus, sessionOk ? "Configured" : "Error", sessionOk ? "ok" : "error");
        uptimeStatus.textContent = formatUptime(data.uptimeSeconds);

        if (appOk && databaseOk && sessionOk) {
            overallIndicator.className = "status-indicator status-ok";
            overallTitle.textContent = "All checks passed";
            overallMessage.textContent = "TaskSpace and its database are responding normally.";
        } else {
            overallIndicator.className = "status-indicator status-error";
            overallTitle.textContent = "Attention required";
            overallMessage.textContent = "At least one system check reported a problem.";
            errorNotice.textContent = "The server reported a degraded status. Check the TaskSpace terminal for diagnostic details.";
            errorNotice.hidden = false;
        }
    } catch (error) {
        overallIndicator.className = "status-indicator status-error";
        overallTitle.textContent = "Status check failed";
        overallMessage.textContent = "TaskSpace could not return a valid status response.";
        setValue(applicationStatus, "Unavailable", "error");
        setValue(databaseStatus, "Unknown", "unknown");
        setValue(sessionStatus, "Unknown", "unknown");
        uptimeStatus.textContent = "Unavailable";
        lastChecked.textContent = `Checked at ${new Date().toLocaleString()}`;
        errorNotice.textContent =
            error instanceof Error ? error.message : "An unexpected error occurred.";
        errorNotice.hidden = false;
    } finally {
        refreshButton.disabled = false;
        refreshButton.textContent = "↻ Refresh status";
    }
}

refreshButton.addEventListener("click", refreshStatus);
refreshStatus();