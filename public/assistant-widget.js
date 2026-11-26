"use strict";

(() => {
    const widget = document.querySelector("#taskspace-assistant");
    const panel = document.querySelector("#assistant-panel");
    const toggle = document.querySelector("#assistant-toggle");
    const closeButton = document.querySelector("#assistant-close");

    const dashboard = document.querySelector("#dashboard-section");

    if (!widget || !panel || !toggle || !closeButton || !dashboard) {
        console.warn("TaskSpace assistant widget could not initialize.");
        return;
    }

    function updateVisibility() {
        const loggedIn = !dashboard.classList.contains("hidden");

        widget.classList.toggle("hidden", !loggedIn);

        if (!loggedIn) {
            closePanel();
        }
    }

    function openPanel() {
        panel.classList.remove("hidden");
        toggle.setAttribute("aria-expanded", "true");
    }

    function closePanel() {
        panel.classList.add("hidden");
        toggle.setAttribute("aria-expanded", "false");
    }

    toggle.addEventListener("click", () => {
        const isOpen = !panel.classList.contains("hidden");

        if (isOpen) {
            closePanel();
        } else {
            openPanel();
        }
    });

    closeButton.addEventListener("click", closePanel);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !panel.classList.contains("hidden")) {
            closePanel();
            toggle.focus();
        }
    });

    // Track login/logout state without modifying the existing app.js.
    const observer = new MutationObserver(updateVisibility);

    observer.observe(dashboard, {
        attributes: true,
        attributeFilter: ["class"]
    });

    updateVisibility();
})();
