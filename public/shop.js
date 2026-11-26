
"use strict";

const productGrid = document.querySelector("#product-grid");
const cartItemsElement = document.querySelector("#cart-items");
const cartCountElement = document.querySelector("#cart-count");
const cartTotalElement = document.querySelector("#cart-total");
const checkoutButton = document.querySelector("#checkout-button");
const shopStatus = document.querySelector("#shop-status");
const loginNotice = document.querySelector("#login-notice");
const orderList = document.querySelector("#order-list");

let currentUser = null;
let products = [];
let cart = {
    items: [],
    itemCount: 0,
    totalOre: 0,
    currency: "NOK"
};

const productSymbols = {
    "TS-PLANNER-001": "📒",
    "TS-DESK-002": "🗂️",
    "TS-TIMER-003": "⏱️",
    "TS-NOTEBOOK-004": "📓"
};

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return entities[character];
    });
}

function formatMoney(ore) {
    return new Intl.NumberFormat("nb-NO", {
        style: "currency",
        currency: "NOK"
    }).format(ore / 100);
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {})
        }
    });

    let data = {};

    try {
        data = await response.json();
    } catch {
        // An empty response is handled by the status check below.
    }

    if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status}).`);
    }

    return data;
}

function setStatus(message, isError = false) {
    shopStatus.textContent = message;
    shopStatus.style.color = isError ? "#ff929c" : "#72dfb0";
}

function renderProducts() {
    if (!products.length) {
        productGrid.innerHTML = "<p>No products are available right now.</p>";
        return;
    }

    productGrid.innerHTML = products.map((product) => {
        const symbol = productSymbols[product.sku] || "🛍️";

        return `
            <article class="product-card">
                <div class="product-symbol" aria-hidden="true">${symbol}</div>
                <h3>${escapeHtml(product.name)}</h3>
                <p class="description">${escapeHtml(product.description)}</p>
                <div class="product-bottom">
                    <span class="price">${formatMoney(product.priceOre)}</span>
                    <button
                        class="primary-button add-to-cart"
                        type="button"
                        data-product-id="${product.id}"
                        ${currentUser ? "" : "disabled"}
                        aria-label="Add ${escapeHtml(product.name)} to cart"
                    >+ Add</button>
                </div>
            </article>
        `;
    }).join("");
}

function renderCart() {
    cartCountElement.textContent = String(cart.itemCount);
    cartTotalElement.textContent = formatMoney(cart.totalOre);

    checkoutButton.disabled = !currentUser || cart.items.length === 0;

    if (!currentUser) {
        cartItemsElement.innerHTML = `
            <p class="muted">Log in to add items and save your cart.</p>
        `;
        return;
    }

    if (!cart.items.length) {
        cartItemsElement.innerHTML = `
            <p class="muted">Your cart is empty. Add a product above to get started.</p>
        `;
        return;
    }

    cartItemsElement.innerHTML = cart.items.map((item) => `
        <article class="cart-item">
            <div>
                <h3>${escapeHtml(item.name)}</h3>
                <p>${formatMoney(item.priceOre)} each</p>
                <p>Subtotal: ${formatMoney(item.lineTotalOre)}</p>
            </div>

            <div class="quantity-controls" aria-label="Quantity controls for ${escapeHtml(item.name)}">
                <button
                    class="quantity-button change-quantity"
                    type="button"
                    data-product-id="${item.productId}"
                    data-quantity="${item.quantity - 1}"
                    ${item.quantity <= 1 ? "disabled" : ""}
                    aria-label="Decrease quantity"
                >−</button>
                <span class="quantity-number">${item.quantity}</span>
                <button
                    class="quantity-button change-quantity"
                    type="button"
                    data-product-id="${item.productId}"
                    data-quantity="${item.quantity + 1}"
                    ${item.quantity >= 99 ? "disabled" : ""}
                    aria-label="Increase quantity"
                >+</button>
            </div>

            <button
                class="remove-button remove-from-cart"
                type="button"
                data-product-id="${item.productId}"
            >Remove</button>
        </article>
    `).join("");
}

function renderOrders(orders) {
    if (!orders.length) {
        orderList.innerHTML = '<p class="muted">You have no orders yet.</p>';
        return;
    }

    orderList.innerHTML = orders.map((order) => {
        const date = new Date(order.createdAt);
        const dateLabel = Number.isNaN(date.getTime())
            ? "Date unavailable"
            : date.toLocaleString("nb-NO");

        return `
            <article class="order-card">
                <div>
                    <h3>Order #${order.id}</h3>
                    <p>${escapeHtml(dateLabel)}</p>
                    <p class="order-status">Demo order · No payment taken</p>
                </div>
                <strong>${formatMoney(order.totalOre)}</strong>
            </article>
        `;
    }).join("");
}

async function loadProducts() {
    try {
        const data = await api("/api/shop/products");
        products = data.products || [];
        renderProducts();
    } catch (error) {
        productGrid.innerHTML = `
            <p>Could not load products. ${escapeHtml(error.message)}</p>
        `;
    }
}

async function loadCart() {
    if (!currentUser) {
        cart = { items: [], itemCount: 0, totalOre: 0, currency: "NOK" };
        renderCart();
        return;
    }

    try {
        const data = await api("/api/shop/cart");
        cart = data.cart;
        renderCart();
    } catch (error) {
        setStatus(error.message, true);
    }
}

async function loadOrders() {
    if (!currentUser) {
        orderList.innerHTML = `
            <p class="muted">Log in to view your orders.</p>
        `;
        return;
    }

    try {
        const data = await api("/api/shop/orders");
        renderOrders(data.orders || []);
    } catch (error) {
        orderList.innerHTML = `
            <p class="muted">${escapeHtml(error.message)}</p>
        `;
    }
}

async function addToCart(productId) {
    try {
        const data = await api("/api/shop/cart", {
            method: "POST",
            body: JSON.stringify({
                productId,
                quantity: 1
            })
        });

        cart = data.cart;
        renderCart();
        setStatus("Product added to your cart.");
    } catch (error) {
        setStatus(error.message, true);
    }
}

async function changeQuantity(productId, quantity) {
    try {
        const data = await api(
            `/api/shop/cart/${encodeURIComponent(productId)}`,
            {
                method: "PATCH",
                body: JSON.stringify({ quantity })
            }
        );

        cart = data.cart;
        renderCart();
        setStatus("Cart quantity updated.");
    } catch (error) {
        setStatus(error.message, true);
    }
}

async function removeFromCart(productId) {
    try {
        const data = await api(
            `/api/shop/cart/${encodeURIComponent(productId)}`,
            { method: "DELETE" }
        );

        cart = data.cart;
        renderCart();
        setStatus("Product removed from your cart.");
    } catch (error) {
        setStatus(error.message, true);
    }
}

async function checkout() {
    if (!currentUser || cart.items.length === 0) {
        return;
    }

    const confirmed = window.confirm(
        `Save this demo order for ${formatMoney(cart.totalOre)}?\n\n` +
        "This does not take payment or arrange delivery."
    );

    if (!confirmed) {
        return;
    }

    checkoutButton.disabled = true;

    try {
        const data = await api("/api/shop/checkout", {
            method: "POST",
            body: JSON.stringify({})
        });

        cart = data.cart;
        renderCart();

        setStatus(data.message || "Demo order saved.");
        await loadOrders();
    } catch (error) {
        setStatus(error.message, true);
    } finally {
        checkoutButton.disabled = cart.items.length === 0;
    }
}

productGrid.addEventListener("click", (event) => {
    const button = event.target.closest(".add-to-cart");

    if (!button || button.disabled) {
        return;
    }

    addToCart(Number(button.dataset.productId));
});

cartItemsElement.addEventListener("click", (event) => {
    const quantityButton = event.target.closest(".change-quantity");

    if (quantityButton && !quantityButton.disabled) {
        const productId = Number(quantityButton.dataset.productId);
        const quantity = Number(quantityButton.dataset.quantity);

        if (quantity >= 1 && quantity <= 99) {
            changeQuantity(productId, quantity);
        }

        return;
    }

    const removeButton = event.target.closest(".remove-from-cart");

    if (removeButton) {
        removeFromCart(Number(removeButton.dataset.productId));
    }
});

document.querySelector("#refresh-cart-button").addEventListener("click", loadCart);
document.querySelector("#refresh-orders-button").addEventListener("click", loadOrders);
checkoutButton.addEventListener("click", checkout);

async function initialiseShop() {
    await loadProducts();

    try {
        const data = await api("/api/auth/me");
        currentUser = data.user || null;
    } catch {
        currentUser = null;
    }

    if (currentUser) {
        loginNotice.classList.add("hidden");
        setStatus(`Welcome, ${currentUser.username}.`);
    } else {
        loginNotice.classList.remove("hidden");
        setStatus("Log in to save your cart.");
    }

    renderProducts();
    await Promise.all([loadCart(), loadOrders()]);
}

initialiseShop();
