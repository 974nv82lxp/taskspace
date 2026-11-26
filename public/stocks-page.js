
"use strict";

function calculateAdvancedFundamentalScore(stock) {
    const f = stock.fundamentals || {};
    const metricScores = [];

    function addMetric(category, label, rawValue, scorer) {
        if (rawValue === null || rawValue === undefined || rawValue === "") {
            return;
        }

        const value = Number(rawValue);
        if (!Number.isFinite(value)) return;

        const score = scorer(value);
        if (score === null || !Number.isFinite(score)) return;

        metricScores.push({
            category,
            label,
            score: Math.max(0, Math.min(100, score))
        });
    }

    addMetric("Valuation", "Trailing P/E", f.peTTM, value => {
        if (value <= 0) return null;
        if (value < 15) return 85;
        if (value <= 25) return 70;
        if (value <= 35) return 50;
        return 30;
    });

    addMetric("Valuation", "Price-to-book", f.priceToBook, value => {
        if (value <= 0) return null;
        if (value < 1) return 80;
        if (value <= 3) return 70;
        if (value <= 6) return 50;
        return 30;
    });

    addMetric("Profitability", "Net profit margin", f.netProfitMarginTTM, value => {
        if (value < 0) return 15;
        if (value <= 5) return 40;
        if (value <= 15) return 65;
        return 85;
    });

    addMetric("Profitability", "Gross margin", f.grossMarginTTM, value => {
        if (value < 0) return 15;
        if (value < 20) return 40;
        if (value < 40) return 60;
        return 80;
    });

    addMetric("Profitability", "Return on equity", f.roeTTM, value => {
        if (value < 0) return 15;
        if (value < 5) return 35;
        if (value < 12) return 60;
        if (value < 20) return 80;
        return 90;
    });

    addMetric("Profitability", "Return on assets", f.roaTTM, value => {
        if (value < 0) return 15;
        if (value < 3) return 35;
        if (value < 8) return 65;
        return 85;
    });

    addMetric("Growth", "Revenue growth", f.revenueGrowthTTMYoy, value => {
        if (value < 0) return 20;
        if (value < 3) return 40;
        if (value <= 10) return 65;
        return 85;
    });

    addMetric("Growth", "EPS growth", f.epsGrowthTTMYoy, value => {
        if (value < 0) return 20;
        if (value < 3) return 40;
        if (value <= 10) return 65;
        return 85;
    });

    addMetric("Financial strength", "Current ratio", f.currentRatio, value => {
        if (value < 0) return 15;
        if (value < 1) return 25;
        if (value < 1.5) return 50;
        if (value <= 3) return 80;
        return 65;
    });

    addMetric("Financial strength", "Debt-to-equity", f.debtToEquity, value => {
        if (value < 0) return 20;
        if (value < 0.5) return 85;
        if (value <= 1) return 70;
        if (value <= 2) return 45;
        return 25;
    });

    addMetric("Dividends", "Indicated dividend yield",
        f.dividendYieldIndicatedAnnual, value => {
            if (value < 0) return null;
            if (value === 0) return 50;
            if (value <= 4) return 75;
            return 60;
        }
    );

    const categories = [
        "Valuation",
        "Profitability",
        "Growth",
        "Financial strength",
        "Dividends"
    ].map(name => {
        const entries = metricScores.filter(item => item.category === name);
        const score = entries.length
            ? Math.round(
                entries.reduce((sum, item) => sum + item.score, 0) /
                entries.length
            )
            : null;

        return { name, entries, score };
    });

    const scoredCategories = categories.filter(
        category => category.score !== null
    );

    const overallScore = scoredCategories.length
        ? Math.round(
            scoredCategories.reduce(
                (sum, category) => sum + category.score, 0
            ) / scoredCategories.length
        )
        : null;

    let interpretation = "Insufficient data to calculate a score.";

    if (overallScore !== null) {
        if (overallScore >= 80) {
            interpretation = "Stronger results across the available screening metrics.";
        } else if (overallScore >= 60) {
            interpretation = "Mixed-to-positive results across the available metrics.";
        } else if (overallScore >= 40) {
            interpretation = "Mixed results. Investigate weaker areas and company-specific risks.";
        } else {
            interpretation = "Several screening metrics indicate potential fundamental risks.";
        }
    }

    // Calculate business health separately from valuation.
    const healthCategories = categories.filter(category =>
        ["Profitability", "Growth", "Financial strength"].includes(category.name) &&
        category.score !== null
    );

    // Cash-flow periods are expected newest first.
    const cashFlowPeriods = Array.isArray(stock.cashFlow?.periods)
        ? stock.cashFlow.periods.slice(0, 4)
        : [];

    const cashFlowChecks = [];

    for (const period of cashFlowPeriods) {
        const periodScores = [];
        const operatingCashFlow = period.operatingCashFlow;
        const freeCashFlow = period.freeCashFlow;
        const netIncome = period.netIncome;

        if (
            typeof operatingCashFlow === "number" &&
            Number.isFinite(operatingCashFlow)
        ) {
            periodScores.push(operatingCashFlow > 0 ? 80 : 20);
        }

        if (
            typeof freeCashFlow === "number" &&
            Number.isFinite(freeCashFlow)
        ) {
            periodScores.push(freeCashFlow > 0 ? 80 : 20);
        }

        if (
            typeof operatingCashFlow === "number" &&
            Number.isFinite(operatingCashFlow) &&
            typeof netIncome === "number" &&
            Number.isFinite(netIncome) &&
            netIncome > 0
        ) {
            const cashConversion = operatingCashFlow / netIncome;

            periodScores.push(
                cashConversion >= 1 ? 90
                    : cashConversion >= 0.75 ? 70
                    : cashConversion >= 0.5 ? 50
                    : 25
            );
        }

        if (periodScores.length > 0) {
            cashFlowChecks.push(
                periodScores.reduce((sum, score) => sum + score, 0) /
                periodScores.length
            );
        }
    }

    const cashFlowScore = cashFlowChecks.length > 0
        ? Math.round(
            cashFlowChecks.reduce((sum, score) => sum + score, 0) /
            cashFlowChecks.length
        )
        : null;

    const healthComponents = healthCategories.map(
        category => category.score
    );

    if (cashFlowScore !== null) {
        healthComponents.push(cashFlowScore);
    }

    const financialHealthScore = healthComponents.length > 0
        ? Math.round(
            healthComponents.reduce((sum, score) => sum + score, 0) /
            healthComponents.length
        )
        : null;

    const healthCoverage = [
        ...healthCategories.map(category => category.name),
        ...(cashFlowScore !== null ? ["Cash flow"] : [])
    ];
    const expectedMetrics = 11;
    const coverageCount = metricScores.length;
    const coveragePercent = Math.round(
        (coverageCount / expectedMetrics) * 100
    );

    let coverageLevel = "Limited coverage";
    if (coverageCount >= 9) {
        coverageLevel = "High coverage";
    } else if (coverageCount >= 6) {
        coverageLevel = "Moderate coverage";
    }

    const coverageDescription =
        `${coverageLevel}: ${coverageCount}/${expectedMetrics} metrics scored ` +
        `(${coveragePercent}%). This measures data availability, not investment certainty.`;

    return {
        metricScores,
        categories,
        scoredCategories,
        overallScore,
        interpretation,
        financialHealthScore,
        cashFlowScore,
        healthCoverage,
        expectedMetrics,
        coverageCount,
        coveragePercent,
        coverageLevel,
        coverageDescription
    };
}
document.addEventListener("DOMContentLoaded", () => {
    const byId = (id) => document.getElementById(id);
// ---------------------------------------------------------
// WACC CALCULATOR - CAPM
// ---------------------------------------------------------

const waccForm = byId("wacc-form");
const waccStatus = byId("wacc-status");
const waccCostEquityResult = byId("wacc-cost-equity-result");
const waccResult = byId("wacc-result");
const waccMarketPremiumResult = byId("wacc-market-premium-result");
const waccAfterTaxDebtResult = byId("wacc-after-tax-debt-result");
const waccEquityWeightResult = byId("wacc-equity-weight-result");
const waccDebtWeightResult = byId("wacc-debt-weight-result");
const waccUseButton = byId("wacc-use-button");
const waccAutoFillButton = byId("wacc-auto-fill-button");
const waccSaveButton = byId("wacc-save-button");
const waccLoadButton = byId("wacc-load-button");
const waccResetButton = byId("wacc-reset-button");
const waccStorageKey = "taskspace.wacc.assumptions.v1";
const waccFieldIds = [
    "wacc-risk-free",
    "wacc-beta",
    "wacc-market-return",
    "wacc-cost-debt",
    "wacc-tax-rate",
    "wacc-equity",
    "wacc-debt"
];

const waccHistoryList = byId("wacc-history-list");
const waccHistoryClearButton = byId("wacc-history-clear-button");
const waccComparisonExportButton = byId("wacc-comparison-export-button");
const waccHistoryStorageKey = "taskspace.wacc.history.v1";
const waccHistoryLimit = 20;

function readWaccHistory() {
    try {
        const saved = localStorage.getItem(waccHistoryStorageKey);

        if (!saved) {
            return [];
        }

        const parsed = JSON.parse(saved);

        if (
            parsed.version !== 1 ||
            !Array.isArray(parsed.entries)
        ) {
            return [];
        }

        return parsed.entries.filter((entry) =>
            entry &&
            typeof entry.id === "string" &&
            typeof entry.symbol === "string" &&
            typeof entry.createdAt === "string" &&
            Number.isFinite(entry.wacc) &&
            entry.values &&
            typeof entry.values === "object"
        ).slice(0, waccHistoryLimit);
    } catch {
        return [];
    }
}

function writeWaccHistory(entries) {
    localStorage.setItem(
        waccHistoryStorageKey,
        JSON.stringify({
            version: 1,
            entries: entries.slice(0, waccHistoryLimit)
        })
    );
}

const selectedWaccHistoryIds = new Set();

function renderWaccComparison() {
    const container = byId("wacc-comparison-results");

    if (!container) {
        return;
    }

    container.replaceChildren();

    const entries = readWaccHistory().filter((entry) =>
        selectedWaccHistoryIds.has(entry.id)
    );

    if (entries.length === 0) {
        const message = document.createElement("p");
        message.className = "wacc-history-empty";
        message.textContent =
            "Select up to three calculations above to compare them.";

        container.appendChild(message);
        return;
    }

    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "dcf-calculate-button wacc-comparison-export";
    exportButton.textContent = "Export comparison CSV";

    exportButton.addEventListener("click", () => {
        const headers = [
            "Metric",
            ...stocks.map(stock =>
                `${stock.company?.name || stock.symbol} (${stock.symbol})`
            )
        ];

        const csvRows = [headers];

        function csvCell(value) {
            const text = String(value ?? "");
            return `"${text.replace(/"/g, '""')}"`;
        }

        // Export the same metrics displayed in the comparison table.
        for (const item of rows) {
            csvRows.push([
                item.label,
                ...stocks.map(stock => item.get(stock))
            ]);
        }

        const csvContent = "\uFEFF" + csvRows
            .map(row => row.map(csvCell).join(","))
            .join("\r\n");

        const blob = new Blob(
            [csvContent],
            { type: "text/csv;charset=utf-8;" }
        );

        const url = URL.createObjectURL(blob);
        const downloadLink = document.createElement("a");

        downloadLink.href = url;
        downloadLink.download =
            `taskspace-stock-comparison-${new Date().toISOString().slice(0, 10)}.csv`;

        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();

        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const table = document.createElement("table");
    table.className = "wacc-comparison-table";

    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");

    const firstHeader = document.createElement("th");
    firstHeader.textContent = "Metric";
    headerRow.appendChild(firstHeader);

    entries.forEach((entry) => {
        const header = document.createElement("th");
        header.textContent = entry.symbol;
        headerRow.appendChild(header);
    });

    head.appendChild(headerRow);
    table.appendChild(head);

    const body = document.createElement("tbody");

    function getMetrics(entry) {
        const values = entry.values || {};

        const riskFree = Number(values["wacc-risk-free"]);
        const beta = Number(values["wacc-beta"]);
        const marketReturn = Number(values["wacc-market-return"]);
        const costDebt = Number(values["wacc-cost-debt"]);
        const taxRate = Number(values["wacc-tax-rate"]);
        const equity = Number(values["wacc-equity"]);
        const debt = Number(values["wacc-debt"]);

        const inputs = [
            riskFree, beta, marketReturn,
            costDebt, taxRate, equity, debt
        ];

        if (
            !inputs.every(Number.isFinite) ||
            equity < 0 ||
            debt < 0 ||
            equity + debt <= 0
        ) {
            return null;
        }

        const totalCapital = equity + debt;

        return {
            wacc: entry.wacc,
            costOfEquity: riskFree + beta * (marketReturn - riskFree),
            afterTaxDebt: costDebt * (1 - taxRate / 100),
            equityWeight: equity / totalCapital * 100,
            debtWeight: debt / totalCapital * 100,
            riskFree,
            beta,
            marketReturn
        };
    }

    const metricRows = [
        ["WACC", "wacc", "%"],
        ["CAPM cost of equity", "costOfEquity", "%"],
        ["After-tax cost of debt", "afterTaxDebt", "%"],
        ["Equity weighting", "equityWeight", "%"],
        ["Debt weighting", "debtWeight", "%"],
        ["Risk-free rate", "riskFree", "%"],
        ["Beta", "beta", ""],
        ["Expected market return", "marketReturn", "%"]
    ];

    metricRows.forEach(([label, key, suffix]) => {
        const row = document.createElement("tr");

        const heading = document.createElement("th");
        heading.scope = "row";
        heading.textContent = label;
        row.appendChild(heading);

        entries.forEach((entry) => {
            const cell = document.createElement("td");
            const metrics = getMetrics(entry);
            const value = metrics?.[key];

            cell.textContent =
                Number.isFinite(value)
                    ? `${value.toFixed(2)}${suffix}`
                    : "Unavailable";

            row.appendChild(cell);
        });

        body.appendChild(row);
    });

    table.appendChild(body);
    container.appendChild(table);
}
function renderWaccHistory() {
    if (!waccHistoryList) {
        return;
    }

    waccHistoryList.replaceChildren();

    const entries = readWaccHistory();

    if (entries.length === 0) {
        const emptyMessage = document.createElement("p");
        emptyMessage.className = "wacc-history-empty";
        emptyMessage.textContent =
            "No WACC calculations saved yet. Calculate WACC to create your first history entry.";

        waccHistoryList.appendChild(emptyMessage);
        renderWaccComparison();
        return;
    }

    entries.forEach((entry) => {
        const item = document.createElement("article");
        item.className = "wacc-history-item";

        const heading = document.createElement("h5");
        heading.textContent = entry.symbol;

        const details = document.createElement("p");

        const date = new Date(entry.createdAt);
        const dateText = Number.isNaN(date.getTime())
            ? "Unknown date"
            : date.toLocaleString();

        details.textContent =
            `WACC: ${entry.wacc.toFixed(2)}% | ${dateText}`;

        const selectionLabel = document.createElement("label");
        selectionLabel.className = "wacc-history-select";

        const selectionCheckbox = document.createElement("input");
        selectionCheckbox.type = "checkbox";
        selectionCheckbox.checked =
            selectedWaccHistoryIds.has(entry.id);
        selectionCheckbox.dataset.historySelect = "true";
        selectionCheckbox.dataset.historyId = entry.id;

        selectionLabel.append(
            selectionCheckbox,
            document.createTextNode(" Compare")
        );
        const actions = document.createElement("div");
        actions.className = "wacc-history-actions";

        const loadButton = document.createElement("button");
        loadButton.type = "button";
        loadButton.className = "dcf-calculate-button";
        loadButton.textContent = "Load";
        loadButton.dataset.historyAction = "load";
        loadButton.dataset.historyId = entry.id;

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "dcf-calculate-button";
        deleteButton.textContent = "Delete";
        deleteButton.dataset.historyAction = "delete";
        deleteButton.dataset.historyId = entry.id;

        actions.append(loadButton, deleteButton);
        item.append(heading, details, selectionLabel, actions);
        waccHistoryList.appendChild(item);
    });
    renderWaccComparison();
}

function saveWaccHistory() {
    const values = {};

    for (const id of waccFieldIds) {
        values[id] = byId(id).value;
    }

    const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        symbol: currentStock?.symbol || "Manual calculation",
        createdAt: new Date().toISOString(),
        wacc: calculatedWacc,
        values
    };

    const entries = readWaccHistory();
    entries.unshift(entry);

    writeWaccHistory(entries);
    renderWaccHistory();
}

if (waccHistoryList) {
    waccHistoryList.addEventListener("change", (event) => {
        const checkbox = event.target.closest(
            'input[data-history-select]'
        );

        if (!checkbox) {
            return;
        }

        const id = checkbox.dataset.historyId;

        if (checkbox.checked) {
            if (selectedWaccHistoryIds.size >= 3) {
                checkbox.checked = false;

                if (waccStatus) {
                    waccStatus.textContent =
                        "You can compare a maximum of three calculations at a time.";
                }

                return;
            }

            selectedWaccHistoryIds.add(id);
        } else {
            selectedWaccHistoryIds.delete(id);
        }

        renderWaccComparison();
    });

    waccHistoryList.addEventListener("click", (event) => {
        const button = event.target.closest(
            "button[data-history-action]"
        );

        if (!button) {
            return;
        }

        const action = button.dataset.historyAction;
        const id = button.dataset.historyId;
        const entries = readWaccHistory();
        const entry = entries.find((item) => item.id === id);

        if (action === "delete") {
            selectedWaccHistoryIds.delete(id);
            writeWaccHistory(
                entries.filter((item) => item.id !== id)
            );

            renderWaccHistory();
            return;
        }

        if (action === "load" && entry) {
            for (const fieldId of waccFieldIds) {
                const field = byId(fieldId);
                const value = entry.values[fieldId];

                if (
                    field &&
                    typeof value === "string" &&
                    value.trim() !== "" &&
                    Number.isFinite(Number(value))
                ) {
                    field.value = value;
                }
            }

            clearWaccResult();

            waccStatus.textContent =
                `Loaded WACC assumptions from ${entry.symbol}. Calculate again to verify the result.`;

            renderWaccHistory();
        }
    });
}

if (waccHistoryClearButton) {
    waccHistoryClearButton.addEventListener("click", () => {
        const confirmed = window.confirm(
            "Are you sure you want to clear all WACC calculation history?"
        );

        if (!confirmed) {
            return;
        }

        selectedWaccHistoryIds.clear();
        writeWaccHistory([]);
        renderWaccHistory();
    });
}

if (waccComparisonExportButton) {
    waccComparisonExportButton.addEventListener("click", () => {
        const entries = readWaccHistory().filter((entry) =>
            selectedWaccHistoryIds.has(entry.id)
        );

        if (entries.length === 0) {
            if (waccStatus) {
                waccStatus.textContent =
                    "Select at least one WACC calculation before exporting.";
            }
            return;
        }

        const headers = [
            "Symbol",
            "Calculation date",
            "WACC (%)",
            "CAPM cost of equity (%)",
            "After-tax cost of debt (%)",
            "Equity weighting (%)",
            "Debt weighting (%)",
            "Risk-free rate (%)",
            "Beta",
            "Expected market return (%)",
            "Cost of debt (%)",
            "Tax rate (%)",
            "Equity",
            "Debt"
        ];

        function readNumber(values, id) {
            const raw = values[id];

            if (raw === undefined || String(raw).trim() === "") {
                return null;
            }

            const number = Number(raw);
            return Number.isFinite(number) ? number : null;
        }

        function csvCell(value, protectFormula = false) {
            let text = String(value ?? "");

            if (protectFormula && /^[=+\-@]/.test(text)) {
                text = "'" + text;
            }

            return '"' + text.replace(/"/g, '""') + '"';
        }

        const rows = entries.map((entry) => {
            const values = entry.values || {};

            const riskFree = readNumber(values, "wacc-risk-free");
            const beta = readNumber(values, "wacc-beta");
            const marketReturn = readNumber(values, "wacc-market-return");
            const costDebt = readNumber(values, "wacc-cost-debt");
            const taxRate = readNumber(values, "wacc-tax-rate");
            const equity = readNumber(values, "wacc-equity");
            const debt = readNumber(values, "wacc-debt");

            const inputs = [
                riskFree, beta, marketReturn, costDebt,
                taxRate, equity, debt
            ];

            let metrics = null;

            if (
                inputs.every((value) => value !== null) &&
                equity >= 0 &&
                debt >= 0 &&
                equity + debt > 0
            ) {
                const totalCapital = equity + debt;

                metrics = {
                    costOfEquity:
                        riskFree + beta * (marketReturn - riskFree),
                    afterTaxDebt:
                        costDebt * (1 - taxRate / 100),
                    equityWeight:
                        equity / totalCapital * 100,
                    debtWeight:
                        debt / totalCapital * 100
                };
            }

            return [
                entry.symbol,
                entry.createdAt,
                Number.isFinite(entry.wacc) ? entry.wacc : "",
                metrics?.costOfEquity ?? "",
                metrics?.afterTaxDebt ?? "",
                metrics?.equityWeight ?? "",
                metrics?.debtWeight ?? "",
                riskFree ?? "",
                beta ?? "",
                marketReturn ?? "",
                costDebt ?? "",
                taxRate ?? "",
                equity ?? "",
                debt ?? ""
            ];
        });

        const csvRows = [headers, ...rows];

        const csvContent =
            "\uFEFF" +
            csvRows.map((row) =>
                row.map((value, index) =>
                    csvCell(value, index < 2 && row !== headers)
                ).join(",")
            ).join("\r\n");

        const blob = new Blob(
            [csvContent],
            { type: "text/csv;charset=utf-8;" }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download =
            `taskspace-wacc-comparison-${new Date().toISOString().slice(0, 10)}.csv`;

        document.body.appendChild(link);
        link.click();
        link.remove();

        window.setTimeout(() => URL.revokeObjectURL(url), 1000);

        if (waccStatus) {
            waccStatus.textContent =
                `Exported ${entries.length} WACC calculation(s) to CSV.`;
        }
    });
}
renderWaccHistory();
let calculatedWacc = null;

if (
    waccForm &&
    waccStatus &&
    waccCostEquityResult &&
    waccResult &&
    waccUseButton
) {
    function clearWaccResult() {
        calculatedWacc = null;
        waccCostEquityResult.textContent = "—";
        waccResult.textContent = "—";
        waccMarketPremiumResult.textContent = "—";
        waccAfterTaxDebtResult.textContent = "—";
        waccEquityWeightResult.textContent = "—";
        waccDebtWeightResult.textContent = "—";
        waccUseButton.disabled = true;
        waccStatus.textContent =
            "Inputs changed. Calculate WACC again before transferring it.";
        waccStatus.classList.remove("error");
    }

    if (waccAutoFillButton) {
        waccAutoFillButton.addEventListener("click", () => {
            const stock = currentStock;

            if (!stock) {
                waccStatus.textContent =
                    "Load a stock before using automatic WACC population.";
                waccStatus.classList.add("error");
                return;
            }

            const marketCapMillions =
                Number(stock.company?.marketCapitalization);

            const beta = Number(stock.fundamentals?.beta);

            const grossDebt =
                Number(stock.balanceSheet?.totalDebt);

            const filledFields = [];

            if (
                stock.company?.marketCapitalization !== null &&
                stock.company?.marketCapitalization !== undefined &&
                Number.isFinite(marketCapMillions) &&
                marketCapMillions > 0
            ) {
                byId("wacc-equity").value =
                    marketCapMillions.toFixed(2);

                filledFields.push("market capitalization");
            }

            if (
                stock.fundamentals?.beta !== null &&
                stock.fundamentals?.beta !== undefined &&
                Number.isFinite(beta)
            ) {
                byId("wacc-beta").value = beta.toFixed(2);

                filledFields.push("beta");
            }

            if (
                stock.balanceSheet?.totalDebt !== null &&
                stock.balanceSheet?.totalDebt !== undefined &&
                Number.isFinite(grossDebt) &&
                grossDebt >= 0
            ) {
                // Yahoo balance-sheet debt is in currency units.
                // Convert it to millions to match Finnhub market cap.
                byId("wacc-debt").value =
                    (grossDebt / 1000000).toFixed(2);

                filledFields.push("gross book debt estimate");
            }

            clearWaccResult();

            if (filledFields.length === 0) {
                waccStatus.textContent =
                    `No usable market capitalization, beta or gross debt data was available for ${stock.symbol}. You can still enter the values manually.`;

                waccStatus.classList.add("error");
                return;
            }

            const reportingCurrency =
                stock.company?.currency || "the reported currency";

            const balanceSheetDate =
                stock.balanceSheet?.date || "an unavailable reporting date";

            waccStatus.textContent =
                `Auto-filled ${filledFields.join(", ")} for ${stock.symbol}. ` +
                `Finnhub company currency: ${reportingCurrency}. ` +
                "Yahoo Finance balance-sheet currency is not independently confirmed. " +
                "Verify that it matches before using debt with equity. " +
                `Balance-sheet date: ${balanceSheetDate}. ` +
                `Debt is a gross book-value estimate, not market-value debt. ` +
                `Check the figures and currency before calculating WACC.`;

            waccStatus.classList.remove("error");
        });
    }
    if (waccSaveButton) {
        waccSaveButton.addEventListener("click", () => {
            try {
                const values = {};

                for (const id of waccFieldIds) {
                    values[id] = byId(id).value;
                }

                localStorage.setItem(
                    waccStorageKey,
                    JSON.stringify({
                        version: 1,
                        values
                    })
                );

                clearWaccResult();
                waccStatus.textContent =
                    "WACC assumptions saved in this browser.";
                waccStatus.classList.remove("error");
            } catch {
                waccStatus.textContent =
                    "Could not save WACC assumptions. Check your browser storage settings.";
                waccStatus.classList.add("error");
            }
        });
    }

    if (waccLoadButton) {
        waccLoadButton.addEventListener("click", () => {
            try {
                const saved = localStorage.getItem(waccStorageKey);

                if (!saved) {
                    waccStatus.textContent =
                        "No saved WACC assumptions were found in this browser.";
                    waccStatus.classList.remove("error");
                    return;
                }

                const parsed = JSON.parse(saved);

                if (
                    parsed?.version !== 1 ||
                    !parsed.values ||
                    typeof parsed.values !== "object"
                ) {
                    throw new Error("Invalid saved assumptions.");
                }

                for (const id of waccFieldIds) {
                    const value = parsed.values[id];

                    if (
                        typeof value !== "string" ||
                        (value !== "" && !Number.isFinite(Number(value)))
                    ) {
                        throw new Error("Invalid saved input.");
                    }
                }

                for (const id of waccFieldIds) {
                    byId(id).value = parsed.values[id];
                }

                clearWaccResult();
                waccStatus.textContent =
                    "Saved WACC assumptions loaded. Review them before calculating.";
                waccStatus.classList.remove("error");
            } catch {
                waccStatus.textContent =
                    "Could not load saved WACC assumptions. The saved data may be invalid.";
                waccStatus.classList.add("error");
            }
        });
    }

    if (waccResetButton) {
        waccResetButton.addEventListener("click", () => {
            const defaults = {
                "wacc-risk-free": "4",
                "wacc-beta": "1",
                "wacc-market-return": "9",
                "wacc-cost-debt": "5",
                "wacc-tax-rate": "25",
                "wacc-equity": "",
                "wacc-debt": ""
            };

            for (const id of waccFieldIds) {
                byId(id).value = defaults[id];
            }

            clearWaccResult();
            waccStatus.textContent =
                "WACC assumptions reset to their default values.";
            waccStatus.classList.remove("error");
        });
    }
    waccForm.addEventListener("input", clearWaccResult);

    waccForm.addEventListener("submit", (event) => {
        event.preventDefault();

        if (!waccForm.reportValidity()) {
            return;
        }

        const riskFree = Number(byId("wacc-risk-free").value);
        const beta = Number(byId("wacc-beta").value);
        const marketReturn = Number(byId("wacc-market-return").value);
        const costOfDebt = Number(byId("wacc-cost-debt").value);
        const taxRate = Number(byId("wacc-tax-rate").value);
        const equity = Number(byId("wacc-equity").value);
        const debt = Number(byId("wacc-debt").value);

        const values = [
            riskFree,
            beta,
            marketReturn,
            costOfDebt,
            taxRate,
            equity,
            debt
        ];

        if (!values.every(Number.isFinite)) {
            waccStatus.textContent =
                "Please enter valid numbers in every WACC field.";
            waccStatus.classList.add("error");
            return;
        }

        if (equity < 0 || debt < 0 || equity + debt <= 0) {
            waccStatus.textContent =
                "Equity and debt cannot be negative, and their combined value must be greater than zero.";
            waccStatus.classList.add("error");
            return;
        }

        // CAPM: risk-free rate + beta * market risk premium.
        const costOfEquity =
            riskFree + beta * (marketReturn - riskFree);

        // Debt cost after the corporate tax benefit.
        const afterTaxCostOfDebt =
            costOfDebt * (1 - taxRate / 100);

        const totalCapital = equity + debt;
        const equityWeight = equity / totalCapital;
        const debtWeight = debt / totalCapital;

        // Weighted Average Cost of Capital.
        const wacc =
            equityWeight * costOfEquity +
            debtWeight * afterTaxCostOfDebt;

        if (
            !Number.isFinite(costOfEquity) ||
            !Number.isFinite(wacc)
        ) {
            waccStatus.textContent =
                "The calculation produced an invalid result. Check your inputs.";
            waccStatus.classList.add("error");
            return;
        }

        if (costOfEquity < 0 || wacc < 0) {
            waccStatus.textContent =
                "The calculated cost of equity or WACC is negative. Review the risk-free rate, beta and market return assumptions.";
            waccStatus.classList.add("error");
            return;
        }
        calculatedWacc = wacc;
        saveWaccHistory();

        waccCostEquityResult.textContent =
            `${costOfEquity.toFixed(2)}%`;

        waccResult.textContent =
            `${wacc.toFixed(2)}%`;

        waccUseButton.disabled = false;
        waccStatus.classList.remove("error");

        waccStatus.textContent =
            `Calculation complete. Equity weight: ${(equityWeight * 100).toFixed(2)}%; debt weight: ${(debtWeight * 100).toFixed(2)}%.`;
    });

    waccUseButton.addEventListener("click", () => {
        if (calculatedWacc === null) {
            waccStatus.textContent =
                "Calculate WACC before transferring the result.";
            waccStatus.classList.add("error");
            return;
        }

        const discountInput = byId("dcf-discount");
        const terminalInput = byId("dcf-terminal-growth");

        if (!discountInput || !terminalInput) {
            waccStatus.textContent =
                "Could not find the DCF discount-rate fields.";
            waccStatus.classList.add("error");
            return;
        }

        if (calculatedWacc < 0.1 || calculatedWacc > 50) {
            waccStatus.textContent =
                "This WACC is outside the DCF discount-rate limits (0.1% to 50%). Adjust your assumptions first.";
            waccStatus.classList.add("error");
            return;
        }

        const terminalGrowth = Number(terminalInput.value);

        if (!Number.isFinite(terminalGrowth)) {
            waccStatus.textContent =
                "Enter a valid DCF terminal growth rate first.";
            waccStatus.classList.add("error");
            return;
        }

        if (calculatedWacc - 1 <= terminalGrowth) {
            waccStatus.textContent =
                "WACC must be more than 1 percentage point above terminal growth to satisfy the existing DCF validation. Adjust the terminal growth or WACC assumptions.";
            waccStatus.classList.add("error");
            return;
        }

        discountInput.value = calculatedWacc.toFixed(2);

        waccStatus.classList.remove("error");
        waccStatus.textContent =
            `WACC of ${calculatedWacc.toFixed(2)}% transferred to the DCF discount-rate field. Your existing DCF calculation has not been run; submit the DCF form when ready.`;
    });
}

    const searchForm = byId("stock-search-form");
    const symbolInput = byId("stock-symbol");
    const searchButton = byId("stock-search-button");
    const stockMessage = byId("stock-message");
    const chartMessage = byId("stock-chart-message");
    const chartCanvas = byId("stock-price-chart");

    const fundamentalMenuButton = byId(
        "fundamental-analysis-menu-button"
    );
    const fundamentalsSection = byId("fundamentals-section");

    const watchlistForm = byId("watchlist-form");
    const watchlistInput = byId("watchlist-symbol");
    const watchlistButton = byId("watchlist-add-button");
    const watchlistMessage = byId("watchlist-message");
    const watchlistList = byId("watchlist-list");
    const watchlistEmpty = byId("watchlist-empty");

    let currentStock = null;
    let watchlist = [];
    let chartResizeHandler = null;

    // ---------------------------------------------------------
    // Formatting helpers
    // ---------------------------------------------------------

    function setText(id, value) {
        const element = byId(id);

        if (element) {
            element.textContent = value == null ? "—" : String(value);
        }
    }

    function showMessage(element, message, isError = false) {
        if (!element) return;

        element.textContent = message;
        element.classList.toggle("error", isError);
        element.classList.toggle(
            "success",
            !isError && message !== ""
        );
    }

    function numeric(value) {
        if (value === null || value === undefined || value === "") {
            return null;
        }

        const result = Number(value);
        return Number.isFinite(result) ? result : null;
    }

    function formatNumber(value, digits = 2) {
        const number = numeric(value);

        if (number === null) return "—";

        return number.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: digits
        });
    }

    function formatCurrency(value, currency = "USD") {
        const number = numeric(value);

        if (number === null) return "Unavailable";

        try {
            return new Intl.NumberFormat(undefined, {
                style: "currency",
                currency: /^[A-Z]{3}$/.test(currency)
                    ? currency
                    : "USD",
                maximumFractionDigits: 2
            }).format(number);
        } catch {
            return `${formatNumber(number)} ${currency}`;
        }
    }

    function formatPercent(value) {
        const number = numeric(value);

        return number === null
            ? "Unavailable"
            : `${formatNumber(number)}%`;
    }

    function formatRatio(value) {
        const number = numeric(value);

        return number === null
            ? "Unavailable"
            : formatNumber(number, 3);
    }

    function normalizeSymbol(value) {
        const symbol = String(value || "").trim().toUpperCase();

        if (!/^[A-Z0-9.^_-]{1,20}$/.test(symbol)) {
            return null;
        }

        return symbol;
    }

    async function api(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: {
                ...(options.body
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...(options.headers || {})
            }
        });

        let data;

        try {
            data = await response.json();
        } catch {
            data = {};
        }

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error(
                    "Please log in to TaskSpace before analyzing stocks."
                );
            }

            throw new Error(
                data.error || `Request failed (HTTP ${response.status}).`
            );
        }

        return data;
    }

    // ---------------------------------------------------------
    // Company and quote
    // ---------------------------------------------------------

    function renderCompany(stock) {
        const company = stock.company || {};
        const quote = stock.quote || {};
        const currency = company.currency || "USD";

        setText(
            "stock-company-name",
            company.name || stock.symbol
        );

        setText(
            "stock-company-symbol",
            company.ticker || stock.symbol
        );

        const companyContainer = byId("stock-company");

        if (companyContainer) {
            let details = byId("stock-company-details");

            if (!details) {
                details = document.createElement("p");
                details.id = "stock-company-details";
                companyContainer.appendChild(details);
            }

            details.textContent = [
                company.exchange,
                company.industry,
                company.country
            ].filter(Boolean).join(" · ") || "Company details unavailable";
        }

        setText(
            "stock-current-price",
            formatCurrency(quote.current, currency)
        );

        const change = numeric(quote.change);
        const changePercent = numeric(quote.changePercent);

        let changeText = "Unavailable";

        if (change !== null) {
            const sign = change > 0 ? "+" : "";

            changeText =
                `${sign}${formatCurrency(change, currency)}` +
                (changePercent === null
                    ? ""
                    : ` (${sign}${formatNumber(changePercent)}%)`);
        }

        setText("stock-price-change", changeText);

        const changeElement = byId("stock-price-change");

        if (changeElement) {
            changeElement.classList.toggle(
                "positive",
                change !== null && change > 0
            );

            changeElement.classList.toggle(
                "negative",
                change !== null && change < 0
            );
        }

        setText(
            "stock-previous-close",
            formatCurrency(quote.previousClose, currency)
        );
    }

    // ---------------------------------------------------------
    // Company fundamentals
    // ---------------------------------------------------------

function renderCashFlowTrendChart(periods, currency) {
    const host = document.getElementById("cash-flow-trend-chart");
    if (!host) return;

    host.replaceChildren();

    const series = [
        { key: "operatingCashFlow", label: "Operating cash flow", color: "#16a34a" },
        { key: "capitalExpenditure", label: "Capital expenditure", color: "#d97706" },
        { key: "freeCashFlow", label: "Free cash flow", color: "#2563eb" }
    ];

    const validPeriods = periods
        .filter(period => period && period.date)
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date));

    const hasValues = validPeriods.some(period =>
        series.some(item =>
            typeof period[item.key] === "number" &&
            Number.isFinite(period[item.key])
        )
    );

    if (validPeriods.length < 2 || !hasValues) {
        const message = document.createElement("p");
        message.className = "cash-flow-chart-empty";
        message.textContent = validPeriods.length < 2
            ? "At least two historical reporting periods are needed to draw a trend."
            : "No usable cash-flow figures are available for the chart.";
        host.append(message);
        return;
    }

    const width = 900;
    const height = 320;
    const margin = { top: 20, right: 24, bottom: 54, left: 82 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const values = validPeriods.flatMap(period =>
        series.map(item => period[item.key])
            .filter(value => typeof value === "number" && Number.isFinite(value))
    );

    let min = Math.min(0, ...values);
    let max = Math.max(0, ...values);

    if (min === max) {
        min -= 1;
        max += 1;
    }

    const padding = (max - min) * 0.08;
    min -= padding;
    max += padding;

    const x = index => margin.left +
        (index / (validPeriods.length - 1)) * plotWidth;
    const y = value => margin.top +
        ((max - value) / (max - min)) * plotHeight;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute(
        "aria-label",
        "Historical operating cash flow, capital expenditure, and free cash flow"
    );
    svg.classList.add("cash-flow-chart-svg");

    const addSvg = (tag, attrs, textContent) => {
        const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const [key, value] of Object.entries(attrs || {})) {
            element.setAttribute(key, String(value));
        }
        if (textContent !== undefined) element.textContent = textContent;
        svg.append(element);
        return element;
    };

    const formatAxisValue = value => {
        const absolute = Math.abs(value);
        if (absolute >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
        if (absolute >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
        if (absolute >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
        return value.toFixed(0);
    };

    for (let tick = 0; tick <= 4; tick++) {
        const value = max - ((max - min) * tick / 4);
        const yy = y(value);

        addSvg("line", {
            x1: margin.left,
            y1: yy,
            x2: width - margin.right,
            y2: yy,
            stroke: "currentColor",
            "stroke-opacity": 0.14
        });

        addSvg("text", {
            x: margin.left - 10,
            y: yy + 4,
            "text-anchor": "end",
            fill: "currentColor",
            "font-size": 12
        }, formatAxisValue(value));
    }

    const zeroY = y(0);
    if (zeroY >= margin.top && zeroY <= margin.top + plotHeight) {
        addSvg("line", {
            x1: margin.left,
            y1: zeroY,
            x2: width - margin.right,
            y2: zeroY,
            stroke: "currentColor",
            "stroke-opacity": 0.5,
            "stroke-dasharray": "4 4"
        });
    }

    validPeriods.forEach((period, index) => {
        if (
            index === 0 ||
            index === validPeriods.length - 1 ||
            index === Math.floor((validPeriods.length - 1) / 2)
        ) {
            addSvg("text", {
                x: x(index),
                y: height - 22,
                "text-anchor": "middle",
                fill: "currentColor",
                "font-size": 12
            }, period.date);
        }
    });

    for (const item of series) {
        let segment = [];

        const drawSegment = () => {
            if (segment.length < 2) {
                segment = [];
                return;
            }

            const path = segment.map((point, index) =>
                `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
            ).join(" ");

            addSvg("path", {
                d: path,
                fill: "none",
                stroke: item.color,
                "stroke-width": 3,
                "stroke-linejoin": "round",
                "stroke-linecap": "round"
            });

            segment = [];
        };

        validPeriods.forEach((period, index) => {
            const value = period[item.key];

            if (typeof value !== "number" || !Number.isFinite(value)) {
                drawSegment();
                return;
            }

            segment.push({ x: x(index), y: y(value) });
        });

        drawSegment();
    }

    host.append(svg);

    const legend = document.createElement("div");
    legend.className = "cash-flow-chart-legend";

    for (const item of series) {
        const entry = document.createElement("span");
        entry.className = "cash-flow-chart-legend-item";

        const swatch = document.createElement("span");
        swatch.className = "cash-flow-chart-swatch";
        swatch.style.backgroundColor = item.color;

        const label = document.createElement("span");
        label.textContent = item.label;

        entry.append(swatch, label);
        legend.append(entry);
    }

    host.append(legend);

    const note = document.createElement("p");
    note.className = "cash-flow-chart-empty";
    note.textContent =
        `Values shown in ${currency || "the reported currency"}. ` +
        "Missing values are left out of the corresponding line.";
    host.append(note);
}
    function renderCashFlowAnalysis(stock) {
    const panel = document.getElementById("cash-flow-analysis");
    if (!panel) return;

    const data = stock.cashFlow || {};
    const periods = Array.isArray(data.periods) ? data.periods : [];
    const latest = periods[0] || {};
    const currency = stock.company?.currency || "USD";
    renderCashFlowTrendChart(periods, currency);
    const numericValue = (value) =>
        typeof value === "number" && Number.isFinite(value) ? value : null;

    const money = (value) => {
        const amount = numericValue(value);
        if (amount === null) return "Unavailable";
        return formatCurrency(amount, currency);
    };

    const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    };

    setText("cash-flow-operating", money(latest.operatingCashFlow));

    const capex = numericValue(latest.capitalExpenditure);
    setText(
        "cash-flow-capex",
        capex === null ? "Unavailable" : money(Math.abs(capex))
    );

    setText("cash-flow-free", money(latest.freeCashFlow));

    const marketCapMillions = numericValue(stock.company?.marketCapitalization);
    const freeCashFlow = numericValue(latest.freeCashFlow);
    const marketCap = marketCapMillions !== null && marketCapMillions > 0
        ? marketCapMillions * 1000000
        : null;

    setText(
        "cash-flow-yield",
        freeCashFlow !== null && marketCap !== null
            ? `${(freeCashFlow / marketCap * 100).toFixed(2)}%`
            : "Unavailable"
    );

    const operatingCashFlow = numericValue(latest.operatingCashFlow);
    const netIncome = numericValue(latest.netIncome);

    setText(
        "cash-flow-quality",
        operatingCashFlow !== null && netIncome !== null && netIncome > 0
            ? `${(operatingCashFlow / netIncome).toFixed(2)}x`
            : "Unavailable"
    );

    setText(
        "cash-flow-report-date",
        `Latest reporting date: ${latest.date || "unavailable"}`
    );

    const history = document.getElementById("cash-flow-history");

    if (history) {
        history.replaceChildren();

        if (!periods.length) {
            const message = document.createElement("p");
            message.textContent = "No historical cash-flow periods are available.";
            history.append(message);
        } else {
            const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "dcf-calculate-button wacc-comparison-export";
    exportButton.textContent = "Export comparison CSV";

    exportButton.addEventListener("click", () => {
        const headers = [
            "Symbol",
            "Calculation date",
            "WACC (%)",
            "CAPM cost of equity (%)",
            "After-tax cost of debt (%)",
            "Equity weighting (%)",
            "Debt weighting (%)",
            "Risk-free rate (%)",
            "Beta",
            "Expected market return (%)",
            "Pre-tax cost of debt (%)",
            "Tax rate (%)",
            "Equity (input units)",
            "Debt (input units)"
        ];

        const csvRows = [headers];

        function csvCell(value) {
            const text = String(value ?? "");
            return `"${text.replace(/"/g, '""')}"`;
        }

        function formatMetric(value) {
            return Number.isFinite(value)
                ? value.toFixed(4)
                : "Unavailable";
        }

        entries.forEach((entry) => {
            const values = entry.values || {};

            const riskFree = Number(values["wacc-risk-free"]);
            const beta = Number(values["wacc-beta"]);
            const marketReturn = Number(values["wacc-market-return"]);
            const costDebt = Number(values["wacc-cost-debt"]);
            const taxRate = Number(values["wacc-tax-rate"]);
            const equity = Number(values["wacc-equity"]);
            const debt = Number(values["wacc-debt"]);

            const inputs = [
                riskFree, beta, marketReturn,
                costDebt, taxRate, equity, debt
            ];

            let costOfEquity = NaN;
            let afterTaxDebt = NaN;
            let equityWeight = NaN;
            let debtWeight = NaN;

            if (
                inputs.every(Number.isFinite) &&
                equity >= 0 &&
                debt >= 0 &&
                equity + debt > 0
            ) {
                const totalCapital = equity + debt;

                costOfEquity =
                    riskFree + beta * (marketReturn - riskFree);

                afterTaxDebt =
                    costDebt * (1 - taxRate / 100);

                equityWeight = equity / totalCapital * 100;
                debtWeight = debt / totalCapital * 100;
            }

            csvRows.push([
                entry.symbol,
                entry.createdAt,
                formatMetric(Number(entry.wacc)),
                formatMetric(costOfEquity),
                formatMetric(afterTaxDebt),
                formatMetric(equityWeight),
                formatMetric(debtWeight),
                formatMetric(riskFree),
                formatMetric(beta),
                formatMetric(marketReturn),
                formatMetric(costDebt),
                formatMetric(taxRate),
                values["wacc-equity"] ?? "",
                values["wacc-debt"] ?? ""
            ]);
        });

        const csvContent = "\uFEFF" + csvRows
            .map((row) => row.map(csvCell).join(","))
            .join("\r\n");

        const blob = new Blob(
            [csvContent],
            { type: "text/csv;charset=utf-8;" }
        );

        const url = URL.createObjectURL(blob);
        const downloadLink = document.createElement("a");

        downloadLink.href = url;
        downloadLink.download =
            `wacc-comparison-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;

        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();

        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    container.appendChild(exportButton);
    const table = document.createElement("table");
            table.className = "cash-flow-history-table";

            const thead = document.createElement("thead");
            const header = document.createElement("tr");

            for (const label of [
                "Reporting date",
                "Operating cash flow",
                "Capital expenditure",
                "Free cash flow"
            ]) {
                const th = document.createElement("th");
                th.textContent = label;
                header.append(th);
            }

            thead.append(header);
            table.append(thead);

            const tbody = document.createElement("tbody");

            for (const period of periods) {
                const row = document.createElement("tr");
                const values = [
                    period.date || "Unavailable",
                    money(period.operatingCashFlow),
                    numericValue(period.capitalExpenditure) === null
                        ? "Unavailable"
                        : money(Math.abs(period.capitalExpenditure)),
                    money(period.freeCashFlow)
                ];

                for (const value of values) {
                    const td = document.createElement("td");
                    td.textContent = value;
                    row.append(td);
                }

                tbody.append(row);
            }

            table.append(tbody);
            history.append(table);
        }
    }

    setText(
        "cash-flow-message",
        data.available
            ? `Source: ${data.source || "Yahoo Finance"}. Capital expenditure is shown as a positive spending amount.`
            : data.message || "Cash-flow data is currently unavailable."
    );
}
function renderFundamentals(stock) {
        const fundamentals = stock.fundamentals || {};
        const currency = stock.company?.currency || "USD";

        setText("fund-pe", formatRatio(fundamentals.peTTM));

        setText(
            "fund-eps",
            fundamentals.epsTTM == null
                ? "Unavailable"
                : formatCurrency(fundamentals.epsTTM, currency)
        );

        setText(
            "fund-revenue",
            fundamentals.revenuePerShareTTM == null
                ? "Unavailable"
                : `${formatCurrency(
                    fundamentals.revenuePerShareTTM,
                    currency
                )} per share`
        );

        setText(
            "fund-margin",
            formatPercent(fundamentals.netProfitMarginTTM)
        );

        setText("fund-roe", formatPercent(fundamentals.roeTTM));
        setText("fund-roa", formatPercent(fundamentals.roaTTM));

        setText(
            "fund-current-ratio",
            formatRatio(fundamentals.currentRatio)
        );

        setText(
            "fund-dividend",
            formatPercent(fundamentals.dividendYieldIndicatedAnnual)
        );

        setText(
            "fund-52-high",
            formatCurrency(fundamentals.week52High, currency)
        );

        setText(
            "fund-52-low",
            formatCurrency(fundamentals.week52Low, currency)
        );
    }

    // ---------------------------------------------------------
    // Fundamental analysis and automatic insights
    // ---------------------------------------------------------

    function renderFundamentalInsights(stock) {
        const fundamentals = stock.fundamentals || {};
        const company = stock.company || {};

        // Do not convert missing values to zero.
        const pe = numeric(fundamentals.peTTM);
        const eps = numeric(fundamentals.epsTTM);
        const margin = numeric(fundamentals.netProfitMarginTTM);
        const roe = numeric(fundamentals.roeTTM);
        const roa = numeric(fundamentals.roaTTM);
        const currentRatio = numeric(fundamentals.currentRatio);
        const dividendYield = numeric(
            fundamentals.dividendYieldIndicatedAnnual
        );

        const insights = [];

        // Price-to-earnings valuation.
        if (pe === null) {
            insights.push({
                title: "Valuation",
                detail: "P/E data is unavailable. Check whether the provider supplies trailing earnings data."
            });
        } else if (pe < 0) {
            insights.push({
                title: "Valuation",
                detail: "The reported P/E is negative. Conventional positive P/E comparisons may not be meaningful when earnings are negative."
            });
        } else if (pe === 0) {
            insights.push({
                title: "Valuation",
                detail: "P/E is zero. Verify that the source has sufficient earnings data."
            });
        } else if (pe < 15) {
            insights.push({
                title: "Valuation",
                detail: "P/E is below 15. This can indicate a lower valuation, but compare growth prospects, risks, and industry peers."
            });
        } else if (pe <= 25) {
            insights.push({
                title: "Valuation",
                detail: "P/E is between 15 and 25. Compare this multiple with similar companies and expected earnings growth."
            });
        } else {
            insights.push({
                title: "Valuation",
                detail: "P/E is above 25. The share price may reflect substantial growth expectations; check whether earnings can support them."
            });
        }

        // Earnings per share.
        if (eps !== null) {
            if (eps > 0) {
                insights.push({
                    title: "Earnings",
                    detail: `Trailing EPS is positive at ${formatNumber(eps)}. Review earnings growth and whether the trend is sustainable.`
                });
            } else if (eps < 0) {
                insights.push({
                    title: "Earnings",
                    detail: `Trailing EPS is negative (${formatNumber(eps)}). Investigate the reasons for the reported loss.`
                });
            } else {
                insights.push({
                    title: "Earnings",
                    detail: "Trailing EPS is zero. Check the company's latest earnings report."
                });
            }
        } else {
            insights.push({
                title: "Earnings",
                detail: "Trailing earnings per share data is unavailable."
            });
        }

        // Net profit margin.
        if (margin !== null) {
            let interpretation;

            if (margin < 0) {
                interpretation = "The company reports a negative profit margin.";
            } else if (margin <= 5) {
                interpretation = "Profitability appears relatively thin; compare it with companies in the same industry.";
            } else if (margin <= 15) {
                interpretation = "Assess this margin against industry peers and the company's historical results.";
            } else {
                interpretation = "This is a relatively strong margin in many industries, although industry comparisons are essential.";
            }

            insights.push({
                title: "Profitability",
                detail: `Net profit margin: ${formatPercent(margin)}. ${interpretation}`
            });
        } else {
            insights.push({
                title: "Profitability",
                detail: "Net profit margin data is unavailable."
            });
        }

        // Return on equity.
        if (roe !== null) {
            insights.push({
                title: "Return on equity",
                detail: `ROE is ${formatPercent(roe)}. Compare it with industry peers and review debt levels, since leverage can affect this measure.`
            });
        } else {
            insights.push({
                title: "Return on equity",
                detail: "ROE data is unavailable."
            });
        }

        // Return on assets.
        if (roa !== null) {
            insights.push({
                title: "Return on assets",
                detail: `ROA is ${formatPercent(roa)}. Compare this result with similar businesses to assess how effectively assets generate returns.`
            });
        } else {
            insights.push({
                title: "Return on assets",
                detail: "ROA data is unavailable."
            });
        }

        // Short-term liquidity.
        if (currentRatio !== null) {
            let interpretation;

            if (currentRatio < 1) {
                interpretation = "Current liabilities exceed current assets. Investigate short-term liquidity and the company's industry.";
            } else if (currentRatio <= 1.5) {
                interpretation = "Review working capital, cash flow, and upcoming obligations to assess short-term liquidity.";
            } else {
                interpretation = "Current assets exceed current liabilities. Check asset quality and whether the ratio is appropriate for this industry.";
            }

            insights.push({
                title: "Liquidity",
                detail: `Current ratio: ${formatNumber(currentRatio)}. ${interpretation}`
            });
        } else {
            insights.push({
                title: "Liquidity",
                detail: "Current ratio data is unavailable."
            });
        }

        // Dividend yield.
        if (dividendYield !== null) {
            insights.push({
                title: "Dividends",
                detail: `Indicated annual dividend yield: ${formatPercent(dividendYield)}. Review dividend coverage, cash flow, and payout sustainability.`
            });
        } else {
            insights.push({
                title: "Dividends",
                detail: "Indicated annual dividend yield data is unavailable or not reported."
            });
        }

        // Additional fundamental metrics.
        const priceToBook = numeric(fundamentals.priceToBook);
        const grossMargin = numeric(fundamentals.grossMarginTTM);
        const debtToEquity = numeric(fundamentals.debtToEquity);
        const revenueGrowth = numeric(fundamentals.revenueGrowthTTMYoy);
        const earningsGrowth = numeric(fundamentals.epsGrowthTTMYoy);

        // Price-to-book valuation.
        if (priceToBook !== null) {
            let interpretation;

            if (priceToBook < 0) {
                interpretation =
                    "Negative book value can make this ratio difficult to interpret. Review the balance sheet.";
            } else if (priceToBook === 0) {
                interpretation =
                    "The ratio is zero. Verify the reported book value and source data.";
            } else if (priceToBook < 1) {
                interpretation =
                    "The shares trade below reported book value per share. Investigate asset quality, liabilities, and business risks.";
            } else {
                interpretation =
                    "Compare this valuation with industry peers, return on equity, and expected growth.";
            }

            insights.push({
                title: "Price-to-book",
                detail: `P/B ratio: ${formatRatio(priceToBook)}. ${interpretation}`
            });
        } else {
            insights.push({
                title: "Price-to-book",
                detail: "Price-to-book data is unavailable."
            });
        }

        // Gross margin.
        if (grossMargin !== null) {
            let interpretation;

            if (grossMargin < 0) {
                interpretation =
                    "The reported gross margin is negative. Investigate revenue and direct production or service costs.";
            } else if (grossMargin < 20) {
                interpretation =
                    "Gross margin is relatively low in many sectors. Compare it with similar companies.";
            } else {
                interpretation =
                    "Assess this margin against industry peers and historical results; a higher margin is not automatically better.";
            }

            insights.push({
                title: "Gross margin",
                detail: `Gross margin: ${formatPercent(grossMargin)}. ${interpretation}`
            });
        } else {
            insights.push({
                title: "Gross margin",
                detail: "Gross margin data is unavailable."
            });
        }

        // Debt relative to equity.
        if (debtToEquity !== null) {
            let interpretation;

            if (debtToEquity < 0) {
                interpretation =
                    "A negative ratio can reflect negative equity or unusual balance-sheet data. Review the source figures.";
            } else if (debtToEquity < 0.5) {
                interpretation =
                    "Reported debt is relatively low compared with equity under this measure. Consider cash flow and industry norms.";
            } else if (debtToEquity <= 1) {
                interpretation =
                    "Compare borrowing levels, interest costs, and cash flow with those of industry peers.";
            } else {
                interpretation =
                    "Debt exceeds equity under this measure. Examine debt maturities, interest coverage, and cash flow.";
            }

            insights.push({
                title: "Debt-to-equity",
                detail: `Debt-to-equity ratio: ${formatRatio(debtToEquity)}. ${interpretation}`
            });
        } else {
            insights.push({
                title: "Debt-to-equity",
                detail: "Debt-to-equity data is unavailable."
            });
        }

        // Year-over-year revenue growth.
        if (revenueGrowth !== null) {
            let interpretation;

            if (revenueGrowth < 0) {
                interpretation =
                    "Revenue has declined over the reported comparison period. Investigate demand, pricing, and one-off factors.";
            } else if (revenueGrowth === 0) {
                interpretation =
                    "Revenue is unchanged under this measure. Review historical trends and the company's outlook.";
            } else {
                interpretation =
                    "Revenue has grown over the reported comparison period. Check whether growth is sustainable and profitable.";
            }

            insights.push({
                title: "Revenue growth",
                detail: `Reported year-over-year revenue growth: ${formatPercent(revenueGrowth)}. ${interpretation}`
            });
        } else {
            insights.push({
                title: "Revenue growth",
                detail: "Year-over-year revenue growth data is unavailable."
            });
        }

        // Year-over-year earnings growth.
        if (earningsGrowth !== null) {
            let interpretation;

            if (earningsGrowth < 0) {
                interpretation =
                    "Reported earnings growth is negative. Determine whether earnings fell from a high base or reflect worsening business performance.";
            } else if (earningsGrowth === 0) {
                interpretation =
                    "Reported earnings growth is unchanged. Compare earnings with revenue and cash flow trends.";
            } else {
                interpretation =
                    "Reported earnings have grown. Check whether this growth is supported by revenue and operating cash flow.";
            }

            insights.push({
                title: "Earnings growth",
                detail: `Reported year-over-year earnings growth: ${formatPercent(earningsGrowth)}. ${interpretation}`
            });
        } else {
            insights.push({
                title: "Earnings growth",
                detail: "Year-over-year earnings growth data is unavailable."
            });
        }
        // 52-week trading range.
        const high = numeric(fundamentals.week52High);
        const low = numeric(fundamentals.week52Low);
        const currentPrice = numeric(stock.quote?.current);
        const currency = company.currency || "USD";

        if (high !== null && low !== null) {
            let rangeDetail =
                `The reported 52-week range is ${formatCurrency(low, currency)} to ${formatCurrency(high, currency)}.`;

            if (
                currentPrice !== null &&
                high > low &&
                currentPrice >= low &&
                currentPrice <= high
            ) {
                const position = ((currentPrice - low) / (high - low)) * 100;

                rangeDetail +=
                    ` The current price is approximately ${formatNumber(position)}% of the way from the low to the high.`;
            }

            rangeDetail +=
                " A position in this range does not by itself establish whether a stock is cheap or expensive.";

            insights.push({
                title: "52-week trading range",
                detail: rangeDetail
            });
        } else {
            insights.push({
                title: "52-week trading range",
                detail: "52-week high and low data is unavailable."
            });
        }

        // Create or reuse the results panel.
        let panel = byId("fundamental-insights");

        if (!panel) {
            panel = document.createElement("div");
            panel.id = "fundamental-insights";
            panel.className = "fundamental-insights";
            fundamentalsSection?.appendChild(panel);
        }

        if (!panel) return;

        panel.replaceChildren();

        const heading = document.createElement("h3");
        heading.textContent =
            `Fundamental Analysis — ${company.name || stock.symbol}`;

        const summary = document.createElement("p");
        summary.textContent =
            `Automated financial screening for ${stock.symbol}. ` +
            "Interpretations are general guidelines, not a buy or sell recommendation.";

        const list = document.createElement("ul");
        list.className = "fundamental-insights-list";

        for (const insight of insights) {
            const item = document.createElement("li");
            item.className = "fundamental-insight-item";

            const title = document.createElement("strong");
            title.textContent = `${insight.title}: `;

            const detail = document.createElement("span");
            detail.textContent = insight.detail;

            item.append(title, detail);
            list.appendChild(item);
        }

        const limitations = document.createElement("p");
        limitations.className = "fundamental-analysis-disclaimer";
        limitations.textContent =
            "Some metrics may be missing or delayed. Thresholds are general " +
            "screening guidelines and may not suit every sector. Consider " +
            "financial statements, debt, cash flow, growth, and risks.";

        panel.append(heading, summary, list, limitations);
        renderFundamentalReport(stock);
        renderAdvancedFundamentalScore(stock);
    }

    // ---------------------------------------------------------
    // ---------------------------------------------------------
    // ---------------------------------------------------------
    // Advanced Fundamental Analysis Report
    // ---------------------------------------------------------

    function renderFundamentalReport(stock) {
        const f = stock.fundamentals || {};
        const company = stock.company || {};

        function firstMetric(names) {
            for (const name of names) {
                const value = numeric(f[name]);
                if (value !== null) {
                    return { name, value };
                }
            }
            return null;
        }

        function metricText(names, formatter, label) {
            const metric = firstMetric(names);

            if (!metric) {
                return `${label}: unavailable from the current data feed.`;
            }

            return `${label}: ${formatter(metric.value)}.`;
        }

        function percent(value) {
            return `${value.toFixed(2)}%`;
        }

        function multiple(value) {
            return `${value.toFixed(2)}x`;
        }

        const sections = [
            {
                title: "Valuation",
                description:
                    "Valuation multiples need to be compared with growth, industry peers and business quality.",
                metrics: [
                    metricText(["peTTM"], multiple, "Trailing P/E"),
                    metricText(["priceToBook"], multiple, "Price-to-book")
                ]
            },
            {
                title: "Profitability",
                description:
                    "Margins and returns help describe how effectively the company generates profit.",
                metrics: [
                    metricText(["netProfitMarginTTM"], percent, "Net profit margin"),
                    metricText(["roeTTM"], percent, "Return on equity"),
                    metricText(["roaTTM"], percent, "Return on assets")
                ]
            },
            {
                title: "Growth",
                description:
                    "Growth figures describe reported historical performance, not guaranteed future results.",
                metrics: [
                    metricText(
                        ["revenueGrowthTTMYoy", "revenueGrowthTTMYoy"],
                        percent,
                        "Year-over-year revenue growth"
                    ),
                    metricText(
                        ["epsGrowthTTMYoy"],
                        percent,
                        "Year-over-year EPS growth"
                    )
                ]
            },
            {
                title: "Financial strength",
                description:
                    "Liquidity and debt measures require industry context and a review of cash flow.",
                metrics: [
                    metricText(["currentRatio"], value => value.toFixed(2), "Current ratio"),
                    metricText(
                        ["debtToEquityTTM", "totalDebtToEquity"],
                        percent,
                        "Debt-to-equity"
                    )
                ]
            },
            {
                title: "Dividends",
                description:
                    "Dividend yield alone does not show whether a payout is sustainable.",
                metrics: [
                    metricText(
                        ["dividendYieldIndicatedAnnual"],
                        percent,
                        "Indicated annual dividend yield"
                    )
                ]
            }
        ];

        const risks = [];
        const pe = numeric(f.peTTM);
        const margin = numeric(f.netProfitMarginTTM);
        const roe = numeric(f.roeTTM);
        const currentRatio = numeric(f.currentRatio);
        const debtToEquity = firstMetric([
            "debtToEquityTTM",
            "totalDebtToEquity"
        ]);

        if (pe !== null && pe < 0) {
            risks.push(
                "Negative trailing P/E: conventional P/E comparisons may not be meaningful."
            );
        }

        if (margin !== null && margin < 0) {
            risks.push(
                "Negative net profit margin: the reported period shows a net loss relative to revenue."
            );
        }

        if (roe !== null && roe < 0) {
            risks.push(
                "Negative return on equity: investigate earnings, equity and unusual accounting items."
            );
        }

        if (currentRatio !== null && currentRatio < 1) {
            risks.push(
                "Current ratio below 1: current liabilities exceed current assets under this measure."
            );
        }

        if (debtToEquity && debtToEquity.value > 200) {
            risks.push(
                "Debt-to-equity is above 200% if the provider reports this metric as a percentage. Verify its definition and compare it with industry peers."
            );
        }

        const availableCount = sections.reduce((count, section) => {
            return count + section.metrics.filter(
                item => !item.endsWith("unavailable from the current data feed.")
            ).length;
        }, 0);

        const expectedCount = sections.reduce(
            (count, section) => count + section.metrics.length,
            0
        );

        const report = document.createElement("section");
        report.className = "fundamental-report";
        report.id = "fundamental-report";

        const heading = document.createElement("h3");
        heading.textContent =
            `Advanced Fundamental Analysis Report — ${company.name || stock.symbol}`;

        const overview = document.createElement("p");
        overview.className = "fundamental-report-overview";
        overview.textContent = availableCount === 0
            ? "A full assessment is not available because none of the report metrics could be read from the current data feed."
            : `The report found ${availableCount} of ${expectedCount} expected metric values. Review each section alongside the company's filings and industry context.`;

        const coverage = document.createElement("p");
        coverage.className = "fundamental-report-coverage";
        coverage.textContent =
            `Metric coverage: ${availableCount}/${expectedCount}. ` +
            "Missing metrics are excluded from interpretation, not treated as zero.";

        const grid = document.createElement("div");
        grid.className = "fundamental-report-grid";

        for (const section of sections) {
            const card = document.createElement("article");
            card.className = "fundamental-report-card";

            const title = document.createElement("h4");
            title.textContent = section.title;

            const description = document.createElement("p");
            description.className = "fundamental-report-description";
            description.textContent = section.description;

            const list = document.createElement("ul");
            for (const text of section.metrics) {
                const item = document.createElement("li");
                item.textContent = text;
                list.appendChild(item);
            }

            card.append(title, description, list);
            grid.appendChild(card);
        }

        const riskHeading = document.createElement("h4");
        riskHeading.textContent = "Potential risk flags";

        const riskList = document.createElement("ul");
        riskList.className = "fundamental-report-risks";

        if (risks.length === 0) {
            const item = document.createElement("li");
            item.textContent =
                "No predefined risk flags were triggered by the available checks. This does not mean the company is risk-free.";
            riskList.appendChild(item);
        } else {
            for (const risk of risks) {
                const item = document.createElement("li");
                item.textContent = risk;
                riskList.appendChild(item);
            }
        }

        const disclaimer = document.createElement("p");
        disclaimer.className = "fundamental-report-disclaimer";
        disclaimer.textContent =
            "This automated report uses the available provider metrics and simple screening rules. It does not replace financial statements, cash-flow analysis, industry comparisons or professional advice. It is not a buy or sell recommendation.";

        report.append(
            heading,
            overview,
            coverage,
            grid,
            riskHeading,
            riskList,
            disclaimer
        );

        const panel = byId("fundamental-insights");
        if (panel) {
            panel.appendChild(report);
        }
    }
    // Advanced Fundamental Score
    // ---------------------------------------------------------

    function renderAdvancedFundamentalScore(stock) {
        const scoreData = calculateAdvancedFundamentalScore(stock);
        const {
            metricScores,
            categories,
            scoredCategories,
            overallScore,
            interpretation,
            financialHealthScore,
            cashFlowScore,
            healthCoverage
        } = scoreData;
        const panel = byId("fundamental-insights");
        if (!panel) return;

        let scorePanel = byId("fundamental-score-panel");

        if (!scorePanel) {
            scorePanel = document.createElement("section");
            scorePanel.id = "fundamental-score-panel";
            scorePanel.className = "fundamental-score-panel";
        }

        scorePanel.replaceChildren();

        const heading = document.createElement("h3");
        heading.textContent = "Advanced Fundamental Score";

        const overview = document.createElement("div");
        overview.className = "fundamental-score-overview";

        const number = document.createElement("p");
        number.className = "fundamental-score-number";
        number.textContent = overallScore === null
            ? "N/A"
            : `${overallScore}/100`;

        const description = document.createElement("p");
        description.className = "fundamental-score-description";
        description.textContent = interpretation;

        overview.append(number, description);
        const healthHeading = document.createElement("h4");
        healthHeading.textContent = "Financial Health Score";

        const healthNumber = document.createElement("p");
        healthNumber.className = "fundamental-score-number";
        healthNumber.textContent = financialHealthScore === null
            ? "N/A"
            : `${financialHealthScore}/100`;

        const healthDescription = document.createElement("p");
        healthDescription.className = "fundamental-score-description";
        healthDescription.textContent = financialHealthScore === null
            ? "Insufficient financial health data."
            : `Based on ${healthCoverage.join(", ")}. ` +
              "This is a screening estimate, not a credit rating.";

        const healthPanel = document.createElement("div");
        healthPanel.className = "fundamental-score-health";
        healthPanel.append(
            healthHeading,
            healthNumber,
            healthDescription
        );

        overview.appendChild(healthPanel);

        const coverage = document.createElement("p");
        coverage.className = "fundamental-score-coverage";
        coverage.textContent =
            `Data coverage: ${metricScores.length} of 11 metrics scored; ` +
            `${scoredCategories.length} of 5 categories available. ` +
            "Unavailable or unsuitable metrics are excluded, not scored as zero.";

        const categoryList = document.createElement("div");
        categoryList.className = "fundamental-score-categories";

        const categoryDescriptions = {
            "Valuation": "Screens the price paid relative to earnings and book value. Lower multiples are not always better; growth and industry matter.",
            "Profitability": "Reviews margins and returns to assess how effectively the company generates profit.",
            "Growth": "Screens recent revenue and earnings growth. Past growth may not continue.",
            "Financial strength": "Reviews liquidity and debt relative to equity. Appropriate levels vary by industry.",
            "Dividends": "Screens the indicated dividend yield. A high yield can also reflect a falling share price or dividend risk."
        };

        for (const category of categories) {
            const row = document.createElement("div");
            row.className = "fundamental-score-category";

            const label = document.createElement("div");
            label.className = "fundamental-score-category-label";

            const name = document.createElement("strong");
            name.textContent = category.name;

            const value = document.createElement("span");
            value.className = "fundamental-score-category-value";
            value.textContent = category.score === null
                ? "Insufficient data"
                : `${category.score}/100`;

            const rating = document.createElement("span");
            rating.className = "fundamental-score-rating";

            const ratingLevel = category.score === null
                ? "unavailable"
                : category.score >= 80
                    ? "strong"
                    : category.score >= 60
                        ? "moderate"
                        : "weak";

            rating.dataset.level = ratingLevel;
            rating.textContent = category.score === null
                ? "No data"
                : category.score >= 80
                    ? "Strong"
                    : category.score >= 60
                        ? "Moderate"
                        : "Weak";

            label.append(name, value, rating);

            const track = document.createElement("div");
            track.className = "fundamental-score-track";
            track.setAttribute("role", "img");
            track.setAttribute(
                "aria-label",
                category.score === null
                    ? `${category.name}: insufficient data`
                    : `${category.name}: ${category.score} out of 100`
            );

            const bar = document.createElement("div");
            bar.className = "fundamental-score-bar";
            bar.style.width = `${category.score ?? 0}%`;

            if (category.score === null) {
                bar.classList.add("fundamental-score-bar-empty");
            }

            track.appendChild(bar);

            const detail = document.createElement("p");
            detail.className = "fundamental-score-detail";
            detail.textContent = category.entries.length
                ? "Based on: " + category.entries
                    .map(item => `${item.label} (${item.score})`)
                    .join(", ")
                : "No suitable metrics were available for this category.";

            const explanation = document.createElement("p");
            explanation.className = "fundamental-score-explanation";
            explanation.textContent = categoryDescriptions[category.name];

            row.append(label, explanation, track, detail);
            categoryList.appendChild(row);
        }

        const disclaimer = document.createElement("p");
        disclaimer.className = "fundamental-score-disclaimer";
        disclaimer.textContent =
            "Method: available category scores are weighted equally; metrics " +
            "within each category are averaged equally. Thresholds are heuristic, " +
            "not sector-adjusted. A high score does not mean a stock is fairly " +
            "valued or likely to rise. Review financial statements, cash flow, " +
            "industry peers, risks, and data quality. This is not investment advice.";

        const categoryChart = document.createElement("section");
        categoryChart.className = "fundamental-category-chart";
        categoryChart.setAttribute("aria-label", "Fundamental category score chart");

        const chartHeading = document.createElement("h4");
        chartHeading.textContent = "Category score chart";

        const chartDescription = document.createElement("p");
        chartDescription.className = "fundamental-category-chart-description";
        chartDescription.textContent =
            "Compare available category scores on a common 0–100 scale.";

        const chartRows = document.createElement("div");
        chartRows.className = "fundamental-category-chart-rows";

        for (const category of categories) {
            const chartRow = document.createElement("div");
            chartRow.className = "fundamental-chart-row";

            const chartLabel = document.createElement("span");
            chartLabel.className = "fundamental-chart-label";
            chartLabel.textContent = category.name;

            const chartTrack = document.createElement("div");
            chartTrack.className = "fundamental-chart-track";
            chartTrack.setAttribute("role", "img");

            const chartBar = document.createElement("div");
            chartBar.className = "fundamental-chart-bar";

            const hasScore =
                typeof category.score === "number" &&
                Number.isFinite(category.score);

            chartTrack.setAttribute(
                "aria-label",
                hasScore
                    ? `${category.name}: ${category.score} out of 100`
                    : `${category.name}: insufficient data`
            );

            if (hasScore) {
                const safeScore = Math.max(0, Math.min(100, category.score));
                chartBar.style.width = `${safeScore}%`;
            } else {
                chartBar.classList.add("fundamental-chart-bar-empty");
            }

            chartTrack.appendChild(chartBar);

            const chartValue = document.createElement("span");
            chartValue.className = "fundamental-chart-value";
            chartValue.textContent = hasScore
                ? `${category.score}/100`
                : "Unavailable";

            chartRow.append(chartLabel, chartTrack, chartValue);
            chartRows.appendChild(chartRow);
        }

        categoryChart.append(chartHeading, chartDescription, chartRows);
        scorePanel.append(
            heading,
            overview,
            coverage,
            categoryChart,
            categoryList,
            disclaimer
        );

        panel.appendChild(scorePanel);
    }

    // ---------------------------------------------------------
    // Discounted Cash Flow (DCF) valuation
    // ---------------------------------------------------------

    function renderDCF(stock) {
        const form = byId("dcf-form");
        if (!form) return;

        const company = stock.company || {};
        const currency = company.currency || "USD";
        const price = numeric(stock.quote?.current);

        setText("dcf-stock-name", company.name || company.ticker || "Selected stock");
        setText(
            "dcf-current-price",
            price !== null && price > 0
                ? formatCurrency(price, currency)
                : "Unavailable"
        );
        setText("dcf-currency", currency);
        // Reset company-specific DCF data whenever a different stock is loaded.
        // Keep the general valuation assumptions unchanged.
        for (const id of ["dcf-fcf", "dcf-net-debt", "dcf-shares"]) {
            const input = byId(id);
            if (input) input.value = "";
        }

        // Automatically populate available financial figures.
        // Yahoo Finance reports these values in absolute units.
        // The DCF form expects millions.

        const latestCashFlow = stock.cashFlow?.periods?.[0];
        const reportedFCF = numeric(latestCashFlow?.freeCashFlow);
        const calculatedFCFF = numeric(stock.cashFlow?.fcff?.value);

        // Prefer calculated annual FCFF. Fall back to reported FCF
        // when Yahoo does not provide enough annual data to calculate FCFF.
        const startingCashFlow = calculatedFCFF !== null
            ? calculatedFCFF
            : reportedFCF;

        if (startingCashFlow !== null) {
            const fcfInput = byId("dcf-fcf");
            if (fcfInput) {
                fcfInput.value = String(startingCashFlow / 1000000);
            }
        }

        const balanceSheet = stock.balanceSheet || {};

        const reportedNetDebt = numeric(balanceSheet.netDebt);

        if (reportedNetDebt !== null) {
            const debtInput = byId("dcf-net-debt");
            if (debtInput) {
                debtInput.value = String(reportedNetDebt / 1000000);
            }
        }

        const reportedShares = numeric(
            balanceSheet.sharesOutstanding
        );

        if (reportedShares !== null && reportedShares > 0) {
            const sharesInput = byId("dcf-shares");
            if (sharesInput) {
                sharesInput.value = String(reportedShares / 1000000);
            }
        }

        for (const id of [
            "dcf-intrinsic-value",
            "dcf-margin-safety",
            "dcf-upside",
            "dcf-enterprise-value",
            "dcf-equity-value"
        ]) {
            setText(id, "—");
        }

        const scenarioResults = byId("dcf-scenario-results");

        if (scenarioResults) {
            scenarioResults.replaceChildren();

            const row = document.createElement("tr");
            const cell = document.createElement("td");

            cell.colSpan = 5;
            cell.textContent = "Run a valuation to see scenarios.";

            row.appendChild(cell);
            scenarioResults.appendChild(row);
        }

        const sensitivityHead = byId("dcf-sensitivity-head");
        const sensitivityResults = byId("dcf-sensitivity-results");

        if (sensitivityHead) {
            sensitivityHead.replaceChildren();

            const heading = document.createElement("th");
            heading.scope = "col";
            heading.textContent = "FCF growth / discount";

            sensitivityHead.appendChild(heading);
        }

        if (sensitivityResults) {
            sensitivityResults.replaceChildren();

            const row = document.createElement("tr");
            const cell = document.createElement("td");

            cell.colSpan = 6;
            cell.textContent = "Run a DCF valuation to see sensitivity results.";

            row.appendChild(cell);
            sensitivityResults.appendChild(row);
        }

        const status = byId("dcf-status");

        if (status) {
            status.classList.remove("error");
            status.textContent =
                calculatedFCFF !== null
                    ? `Annual calculated FCFF (${stock.cashFlow?.fcff?.date || "latest available year"}) was used as the starting value. Review the source figures, net debt and shares before calculating.`
                    : reportedFCF !== null
                        ? "Annual FCFF was unavailable, so reported free cash flow was used as an estimate. It may differ from unlevered FCFF. Check net debt and shares before calculating."
                        : "No automatic FCFF or reported FCF estimate was available. Enter verified annual FCFF, net debt and shares before calculating.";
        }


        // Bind the form once. The handler always reads the currently selected stock.
        const fcffBreakdown = byId("dcf-fcff-breakdown");
        const fcffBreakdownDate = byId("dcf-fcff-breakdown-date");
        const fcffBreakdownContent = byId("dcf-fcff-breakdown-content");

        if (fcffBreakdown && fcffBreakdownContent) {
            const fcffComponents = stock.cashFlow?.fcff?.components;

            const ebit = numeric(fcffComponents?.ebit);
            const taxRate = numeric(fcffComponents?.taxRate);
            const depreciation = numeric(
                fcffComponents?.depreciationAndAmortization
            );
            const capitalExpenditure = numeric(
                fcffComponents?.capitalExpenditure
            );
            const workingCapitalChange = numeric(
                fcffComponents?.changeInWorkingCapital
            );

            const componentsAvailable =
                calculatedFCFF !== null &&
                stock.cashFlow?.fcff?.available === true &&
                ebit !== null &&
                taxRate !== null &&
                depreciation !== null &&
                capitalExpenditure !== null &&
                workingCapitalChange !== null;

            if (componentsAvailable) {
                const afterTaxEBIT = ebit * (1 - taxRate);

                const formatMillions = value =>
                    (value / 1000000).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    });

                const rows = [
                    ["EBIT", formatMillions(ebit)],
                    ["Tax rate", `${(taxRate * 100).toFixed(2)}%`],
                    ["EBIT after tax", formatMillions(afterTaxEBIT)],
                    ["Depreciation and amortisation", formatMillions(depreciation)],
                    ["Capital expenditure", formatMillions(capitalExpenditure)],
                    ["Change in working capital", formatMillions(workingCapitalChange)],
                    ["Calculated annual FCFF", formatMillions(calculatedFCFF)]
                ];

                const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "dcf-calculate-button wacc-comparison-export";
    exportButton.textContent = "Export comparison CSV";

    exportButton.addEventListener("click", () => {
        const headers = [
            "Symbol",
            "Calculation date",
            "WACC (%)",
            "CAPM cost of equity (%)",
            "After-tax cost of debt (%)",
            "Equity weighting (%)",
            "Debt weighting (%)",
            "Risk-free rate (%)",
            "Beta",
            "Expected market return (%)",
            "Pre-tax cost of debt (%)",
            "Tax rate (%)",
            "Equity (input units)",
            "Debt (input units)"
        ];

        const csvRows = [headers];

        function csvCell(value) {
            const text = String(value ?? "");
            return `"${text.replace(/"/g, '""')}"`;
        }

        function formatMetric(value) {
            return Number.isFinite(value)
                ? value.toFixed(4)
                : "Unavailable";
        }

        entries.forEach((entry) => {
            const values = entry.values || {};

            const riskFree = Number(values["wacc-risk-free"]);
            const beta = Number(values["wacc-beta"]);
            const marketReturn = Number(values["wacc-market-return"]);
            const costDebt = Number(values["wacc-cost-debt"]);
            const taxRate = Number(values["wacc-tax-rate"]);
            const equity = Number(values["wacc-equity"]);
            const debt = Number(values["wacc-debt"]);

            const inputs = [
                riskFree, beta, marketReturn,
                costDebt, taxRate, equity, debt
            ];

            let costOfEquity = NaN;
            let afterTaxDebt = NaN;
            let equityWeight = NaN;
            let debtWeight = NaN;

            if (
                inputs.every(Number.isFinite) &&
                equity >= 0 &&
                debt >= 0 &&
                equity + debt > 0
            ) {
                const totalCapital = equity + debt;

                costOfEquity =
                    riskFree + beta * (marketReturn - riskFree);

                afterTaxDebt =
                    costDebt * (1 - taxRate / 100);

                equityWeight = equity / totalCapital * 100;
                debtWeight = debt / totalCapital * 100;
            }

            csvRows.push([
                entry.symbol,
                entry.createdAt,
                formatMetric(Number(entry.wacc)),
                formatMetric(costOfEquity),
                formatMetric(afterTaxDebt),
                formatMetric(equityWeight),
                formatMetric(debtWeight),
                formatMetric(riskFree),
                formatMetric(beta),
                formatMetric(marketReturn),
                formatMetric(costDebt),
                formatMetric(taxRate),
                values["wacc-equity"] ?? "",
                values["wacc-debt"] ?? ""
            ]);
        });

        const csvContent = "\uFEFF" + csvRows
            .map((row) => row.map(csvCell).join(","))
            .join("\r\n");

        const blob = new Blob(
            [csvContent],
            { type: "text/csv;charset=utf-8;" }
        );

        const url = URL.createObjectURL(blob);
        const downloadLink = document.createElement("a");

        downloadLink.href = url;
        downloadLink.download =
            `wacc-comparison-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;

        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();

        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    container.appendChild(exportButton);
    const table = document.createElement("table");
                const tbody = document.createElement("tbody");

                rows.forEach(([label, value], index) => {
                    const row = document.createElement("tr");
                    const heading = document.createElement("td");
                    const result = document.createElement("td");

                    heading.textContent = label;
                    result.textContent = value;

                    if (index === rows.length - 1) {
                        row.classList.add("dcf-fcff-total");
                    }

                    row.append(heading, result);
                    tbody.appendChild(row);
                });

                table.appendChild(tbody);
                fcffBreakdownContent.replaceChildren(table);

                if (fcffBreakdownDate) {
                    fcffBreakdownDate.textContent =
                        `Fiscal year: ${stock.cashFlow?.fcff?.date || "Latest available year"}`;
                }

                fcffBreakdown.hidden = false;
            } else {
                fcffBreakdown.hidden = true;
                fcffBreakdownContent.replaceChildren();

                if (fcffBreakdownDate) {
                    fcffBreakdownDate.textContent = "";
                }
            }
        }

        if (form.dataset.bound === "true") return;
        form.dataset.bound = "true";

        form.addEventListener("submit", event => {
            event.preventDefault();

            const activeStock = currentStock;
            const activeCurrency = activeStock?.company?.currency || "USD";
            const activePrice = numeric(activeStock?.quote?.current);

            const readInput = id => {
                const element = byId(id);
                if (!element || element.value.trim() === "") return null;

                const value = Number(element.value);
                return Number.isFinite(value) ? value : null;
            };

            const startingFCF = readInput("dcf-fcf");
            const netDebt = readInput("dcf-net-debt");
            const shares = readInput("dcf-shares");
            const growthPercent = readInput("dcf-growth");
            const discountPercent = readInput("dcf-discount");
            const terminalGrowthPercent = readInput("dcf-terminal-growth");
            const years = Number(byId("dcf-years")?.value);

            const outputIds = [
                "dcf-intrinsic-value",
                "dcf-margin-safety",
                "dcf-upside",
                "dcf-enterprise-value",
                "dcf-equity-value"
            ];

            for (const id of outputIds) setText(id, "—");
            const qualityPanel = byId("dcf-quality-warnings");
            const qualityList = byId("dcf-quality-warning-list");

            if (qualityList) qualityList.replaceChildren();
            if (qualityPanel) qualityPanel.hidden = true;

            const scenarioBody = byId("dcf-scenario-results");
            if (scenarioBody) scenarioBody.replaceChildren();

            const status = byId("dcf-status");
            const reportError = message => {
                setText("dcf-status", message);
                if (status) status.classList.add("error");
            };

            if (!activeStock) {
                reportError("Load a stock before calculating its valuation.");
                return;
            }

            if (
                startingFCF === null || startingFCF <= 0 ||
                netDebt === null ||
                shares === null || shares <= 0 ||
                growthPercent === null || growthPercent < -50 || growthPercent > 100 ||
                discountPercent === null || discountPercent <= 0 || discountPercent > 50 ||
                terminalGrowthPercent === null ||
                terminalGrowthPercent < -5 || terminalGrowthPercent > 10 ||
                ![5, 7, 10].includes(years)
            ) {
                reportError(
                    "Check your inputs. FCF and shares must be positive; " +
                    "net debt must be entered, and rates must be within the stated limits."
                );
                return;
            }

            const growth = growthPercent / 100;
            const discount = discountPercent / 100;
            const terminalGrowth = terminalGrowthPercent / 100;

            // The optimistic scenario reduces the discount rate by 1 percentage point.
            if (discount - 0.01 <= terminalGrowth) {
                reportError(
                    "The discount rate must be at least 1 percentage point above " +
                    "terminal growth so every scenario has a valid terminal value."
                );
                return;
            }

            if (activePrice === null || activePrice <= 0) {
                reportError(
                    "The current market price is unavailable. Reload the stock data before calculating margin of safety."
                );
                return;
            }

                        // DCF quality warnings: informational only; they do not block valuation.
            const qualityWarnings = [];

            if (growthPercent > 15) {
                qualityWarnings.push({
                    level: "dcf-quality-warning-caution",
                    message: "High forecast growth: growth above 15% can be difficult to sustain. Check the company's historical growth and future prospects."
                });
            }

            if (growthPercent < -5) {
                qualityWarnings.push({
                    level: "dcf-quality-warning-caution",
                    message: "Significant forecast decline: growth below -5% may produce a very low valuation. Check whether this decline is intentional."
                });
            }

            if (discountPercent < 6) {
                qualityWarnings.push({
                    level: "dcf-quality-warning-caution",
                    message: "Low discount rate: below 6% may make the estimated intrinsic value unusually sensitive to your assumptions."
                });
            }

            if (terminalGrowthPercent > 3.5) {
                qualityWarnings.push({
                    level: "dcf-quality-warning-caution",
                    message: "High terminal growth: above 3.5% may be difficult to sustain indefinitely. Consider whether this assumption is realistic."
                });
            }

            if (netDebt < 0) {
                qualityWarnings.push({
                    level: "dcf-quality-warning-info",
                    message: "Negative net debt indicates a net-cash position. Check that your debt and cash figures are entered correctly."
                });
            }

            const calculatedFCFFValue = activeStock.cashFlow?.fcff?.value;
            const hasCalculatedFCFF =
                calculatedFCFFValue !== null &&
                calculatedFCFFValue !== undefined &&
                Number.isFinite(Number(calculatedFCFFValue)) &&
                Number(calculatedFCFFValue) > 0;

            if (!hasCalculatedFCFF) {
                qualityWarnings.push({
                    level: "dcf-quality-warning-caution",
                    message: "No positive calculated FCFF value is available in the loaded stock data. Verify that your starting cash flow is appropriate for a FCFF valuation."
                });
            }

            if (qualityList) {
                for (const warning of qualityWarnings) {
                    const item = document.createElement("li");
                    item.classList.add(warning.level);
                    item.textContent = warning.message;
                    qualityList.appendChild(item);
                }
            }

            if (qualityPanel) {
                qualityPanel.hidden = qualityWarnings.length === 0;
            }
if (status) status.classList.remove("error");

            // FCF and net debt are in millions; shares are in millions.
            // Therefore, equity value / shares gives currency per share.
            function calculateScenario(scenarioGrowth, scenarioDiscount) {
                if (scenarioDiscount <= terminalGrowth) return null;

                let presentValueFCF = 0;
                let projectedFCF = startingFCF;

                for (let year = 1; year <= years; year += 1) {
                    projectedFCF *= 1 + scenarioGrowth;
                    presentValueFCF +=
                        projectedFCF / Math.pow(1 + scenarioDiscount, year);
                }

                const terminalFCF = projectedFCF * (1 + terminalGrowth);
                const terminalValue =
                    terminalFCF / (scenarioDiscount - terminalGrowth);
                const presentValueTerminal =
                    terminalValue / Math.pow(1 + scenarioDiscount, years);

                const enterpriseValue = presentValueFCF + presentValueTerminal;
                const equityValue = enterpriseValue - netDebt;
                const intrinsicValue = equityValue / shares;

                if (
                    !Number.isFinite(enterpriseValue) ||
                    !Number.isFinite(equityValue) ||
                    !Number.isFinite(intrinsicValue)
                ) {
                    return null;
                }

                return {
                    enterpriseValue,
                    equityValue,
                    intrinsicValue,
                    marginOfSafety: intrinsicValue > 0
                        ? ((intrinsicValue - activePrice) / intrinsicValue) * 100
                        : null,
                    upside: ((intrinsicValue / activePrice) - 1) * 100
                };
            }

            const base = calculateScenario(growth, discount);
            const conservative = calculateScenario(growth - 0.02, discount + 0.01);
            const optimistic = calculateScenario(growth + 0.02, discount - 0.01);

            if (!base || !conservative || !optimistic) {
                reportError("Unable to calculate one or more scenarios. Review your assumptions.");
                return;
            }

            const millions = value =>
                `${formatNumber(value, 2)} million ${activeCurrency}`;

            setText(
                "dcf-intrinsic-value",
                formatCurrency(base.intrinsicValue, activeCurrency)
            );
            setText(
                "dcf-margin-safety",
                base.marginOfSafety === null
                    ? "N/A — non-positive intrinsic value"
                    : `${formatNumber(base.marginOfSafety, 2)}%`
            );
            setText("dcf-upside", `${formatNumber(base.upside, 2)}%`);
            setText("dcf-enterprise-value", millions(base.enterpriseValue));
            setText("dcf-equity-value", millions(base.equityValue));

            const scenarios = [
                {
                    name: "Conservative",
                    growth: growth - 0.02,
                    discount: discount + 0.01,
                    result: conservative
                },
                {
                    name: "Base case",
                    growth,
                    discount,
                    result: base
                },
                {
                    name: "Optimistic",
                    growth: growth + 0.02,
                    discount: discount - 0.01,
                    result: optimistic
                }
            ];

            const body = byId("dcf-scenario-results");

            if (body) {
                for (const scenario of scenarios) {
                    const row = document.createElement("tr");

                    const values = [
                        scenario.name,
                        `${formatNumber(scenario.growth * 100, 2)}%`,
                        `${formatNumber(scenario.discount * 100, 2)}%`,
                        formatCurrency(scenario.result.intrinsicValue, activeCurrency),
                        scenario.result.marginOfSafety === null
                            ? "N/A"
                            : `${formatNumber(scenario.result.marginOfSafety, 2)}%`
                    ];

                    for (const value of values) {
                        const cell = document.createElement("td");
                        cell.textContent = value;
                        row.appendChild(cell);
                    }

                    body.appendChild(row);
                }
            }

            // DCF sensitivity analysis: five growth rates and five discount rates.
            const sensitivityHead = byId("dcf-sensitivity-head");
            const sensitivityBody = byId("dcf-sensitivity-results");

            if (sensitivityHead && sensitivityBody) {
                sensitivityHead.replaceChildren();
                sensitivityBody.replaceChildren();

                const corner = document.createElement("th");
                corner.scope = "col";
                corner.textContent = "FCF growth / discount";
                sensitivityHead.appendChild(corner);

                // The lowest discount rate is discount - 1 percentage point.
                // Existing validation ensures it remains above terminal growth.
                const sensitivityDiscountRates = [
                    -0.01, 0, 0.01, 0.02, 0.03
                ].map(offset => discount + offset);

                const sensitivityGrowthRates = [
                    -0.04, -0.02, 0, 0.02, 0.04
                ].map(offset => growth + offset);

                for (const rate of sensitivityDiscountRates) {
                    const heading = document.createElement("th");
                    heading.scope = "col";
                    heading.textContent = `${formatNumber(rate * 100, 2)}%`;
                    sensitivityHead.appendChild(heading);
                }

                for (const scenarioGrowth of sensitivityGrowthRates) {
                    const row = document.createElement("tr");
                    const rowHeading = document.createElement("th");
                    rowHeading.scope = "row";
                    rowHeading.textContent =
                        `${formatNumber(scenarioGrowth * 100, 2)}%`;
                    row.appendChild(rowHeading);

                    for (const scenarioDiscount of sensitivityDiscountRates) {
                        const cell = document.createElement("td");

                        // Highlight the base-case intersection.
                        const isBaseCase =
                            scenarioGrowth === growth &&
                            scenarioDiscount === discount;

                        if (isBaseCase) {
                            cell.classList.add("dcf-sensitivity-base");
                        }
                        const result = calculateScenario(
                            scenarioGrowth,
                            scenarioDiscount
                        );

                        if (!result) {
                            cell.textContent = "N/A";
                            cell.classList.add("dcf-sensitivity-invalid");
                            cell.title = "This combination cannot be calculated.";
                        } else {
                            cell.textContent = formatCurrency(
                                result.intrinsicValue,
                                activeCurrency
                            );

                            if (result.intrinsicValue > activePrice) {
                                cell.classList.add("dcf-sensitivity-above");
                            } else if (result.intrinsicValue < activePrice) {
                                cell.classList.add("dcf-sensitivity-below");
                            }

                            cell.title =
                                `Growth: ${formatNumber(scenarioGrowth * 100, 2)}%; ` +
                                `discount: ${formatNumber(scenarioDiscount * 100, 2)}%; ` +
                                `market price: ${formatCurrency(activePrice, activeCurrency)}; ` +
                                `margin of safety: ${
                                    result.marginOfSafety === null
                                        ? "N/A"
                                        : `${formatNumber(result.marginOfSafety, 2)}%`
                                }`;
                        }

                        row.appendChild(cell);
                    }

                    sensitivityBody.appendChild(row);
                }
            }
            setText(
                "dcf-status",
                `DCF calculated for ${activeStock.company?.name || activeStock.company?.ticker || "the selected stock"} using ${years} forecast years. Results depend on your assumptions.`
            );
        });
    }
    // Technical indicators
    // ---------------------------------------------------------

    function renderIndicators(stock) {
        const indicators = stock.indicators || {};
        const currency = stock.company?.currency || "USD";
        const macd = indicators.macd || {};

        setText(
            "indicator-rsi",
            indicators.rsi14 == null
                ? "Unavailable"
                : formatNumber(indicators.rsi14)
        );

        setText(
            "indicator-sma-20",
            indicators.sma20 == null
                ? "Unavailable"
                : formatCurrency(indicators.sma20, currency)
        );

        setText(
            "indicator-sma-50",
            indicators.sma50 == null
                ? "Unavailable"
                : formatCurrency(indicators.sma50, currency)
        );

        setText(
            "indicator-ema-12",
            indicators.ema20 == null
                ? "Unavailable"
                : formatCurrency(indicators.ema20, currency)
        );

        setText(
            "indicator-ema-26",
            macd.macd == null
                ? "Unavailable"
                : formatNumber(macd.macd, 4)
        );

        setText(
            "indicator-macd",
            macd.macd == null
                ? "Unavailable"
                : `MACD ${formatNumber(macd.macd, 4)} · Signal ${
                    formatNumber(macd.signal, 4)
                } · Histogram ${formatNumber(macd.histogram, 4)}`
        );
    }

    // ---------------------------------------------------------
    // Native canvas price-history chart (no chart library needed)
    // ---------------------------------------------------------

    function drawChart(stock) {
        if (!chartCanvas) return;

        const context = chartCanvas.getContext("2d");

        if (!context) {
            showMessage(chartMessage, "Unable to render the chart.", true);
            return;
        }

        const history = Array.isArray(stock.history)
            ? stock.history.filter(
                (item) =>
                    numeric(item.close) !== null &&
                    item.date
            )
            : [];

        const width = Math.max(
            300,
            chartCanvas.parentElement?.clientWidth || 600
        );

        const height = 300;
        const pixelRatio = Math.max(1, window.devicePixelRatio || 1);

        chartCanvas.width = width * pixelRatio;
        chartCanvas.height = height * pixelRatio;
        chartCanvas.style.width = "100%";
        chartCanvas.style.height = `${height}px`;

        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, width, height);

        if (history.length === 0) {
            showMessage(
                chartMessage,
                "No historical price data is available for this symbol.",
                false
            );
            return;
        }

        showMessage(
            chartMessage,
            `${history.length} daily price records loaded.`,
            false
        );

        const values = history.map((item) => Number(item.close));
        const minimum = Math.min(...values);
        const maximum = Math.max(...values);
        const range = maximum - minimum || 1;

        const padding = {
            top: 20,
            right: 18,
            bottom: 35,
            left: 65
        };

        const plotWidth = width - padding.left - padding.right;
        const plotHeight = height - padding.top - padding.bottom;

        const yFor = (value) =>
            padding.top +
            ((maximum - value) / range) * plotHeight;

        const xFor = (index) =>
            padding.left +
            (index / Math.max(1, values.length - 1)) * plotWidth;

        context.font = "12px sans-serif";
        context.lineWidth = 1;
        context.textAlign = "right";
        context.textBaseline = "middle";

        for (let step = 0; step <= 4; step += 1) {
            const value = maximum - (range * step) / 4;
            const y = yFor(value);

            context.beginPath();
            context.moveTo(padding.left, y);
            context.lineTo(width - padding.right, y);
            context.strokeStyle = "#334155";
            context.stroke();

            context.fillStyle = "#94a3b8";
            context.fillText(formatNumber(value), padding.left - 8, y);
        }

        context.beginPath();

        values.forEach((value, index) => {
            const x = xFor(index);
            const y = yFor(value);

            if (index === 0) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        });

        context.strokeStyle = "#8b7cff";
        context.lineWidth = 2;
        context.stroke();

        context.fillStyle = "#94a3b8";
        context.textAlign = "left";
        context.textBaseline = "alphabetic";
        context.fillText(
            history[0].date,
            padding.left,
            height - 10
        );

        context.textAlign = "right";
        context.fillText(
            history[history.length - 1].date,
            width - padding.right,
            height - 10
        );
    }

    // ---------------------------------------------------------
    // Stock analysis
    // ---------------------------------------------------------

    async function analyzeStock(symbol, updateAddress = true) {
        const normalizedSymbol = normalizeSymbol(symbol);

        if (!normalizedSymbol) {
            showMessage(
                stockMessage,
                "Enter a valid ticker symbol, such as AAPL.",
                true
            );
            return false;
        }

        if (searchButton) searchButton.disabled = true;

        showMessage(
            stockMessage,
            `Loading ${normalizedSymbol} stock data…`
        );

        showMessage(chartMessage, "");

        try {
            const stock = await api(
                `/api/stocks/${encodeURIComponent(normalizedSymbol)}`
            );

            currentStock = stock;

            renderCompany(stock);
            renderFundamentals(stock);
            renderCashFlowAnalysis(stock);
            renderDCF(stock);
            renderIndicators(stock);
            drawChart(stock);

            if (symbolInput) {
                symbolInput.value = normalizedSymbol;
            }

            if (updateAddress) {
                const url = new URL(window.location.href);
                url.searchParams.set("symbol", normalizedSymbol);

                window.history.replaceState({}, "", url);
            }

            showMessage(
                stockMessage,
                `Analysis loaded for ${stock.company?.name || normalizedSymbol}.`
            );

            return true;
        } catch (error) {
            showMessage(
                stockMessage,
                error.message || "Unable to analyze this stock.",
                true
            );

            return false;
        } finally {
            if (searchButton) searchButton.disabled = false;
        }
    }

    if (searchForm) {
        searchForm.addEventListener("submit", (event) => {
            event.preventDefault();
            analyzeStock(symbolInput?.value);
        });
    }

    // ---------------------------------------------------------
    // Fundamental Analysis menu button
    // ---------------------------------------------------------

    if (fundamentalMenuButton && fundamentalsSection) {
        fundamentalMenuButton.addEventListener("click", async () => {
            fundamentalsSection.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });

            fundamentalsSection.classList.add("fundamentals-highlight");

            const symbol =
                currentStock?.symbol ||
                symbolInput?.value ||
                "AAPL";

            const loaded = await analyzeStock(symbol, false);

            if (loaded && currentStock) {
                renderFundamentalInsights(currentStock);
            }

            fundamentalsSection.setAttribute("tabindex", "-1");
            fundamentalsSection.focus({ preventScroll: true });

            window.setTimeout(() => {
                fundamentalsSection.classList.remove(
                    "fundamentals-highlight"
                );
            }, 1800);
        });
    }

    // Redraw the chart when the browser window changes size.
    if (chartResizeHandler) {
        window.removeEventListener("resize", chartResizeHandler);
    }

    chartResizeHandler = () => {
        if (currentStock) drawChart(currentStock);
    };

    window.addEventListener("resize", chartResizeHandler);

    // ---------------------------------------------------------
    // Watchlist
    // ---------------------------------------------------------

    function renderWatchlist() {
        if (!watchlistList) return;

        watchlistList.replaceChildren();

        if (watchlistEmpty) {
            watchlistEmpty.hidden = watchlist.length > 0;
        }

        for (const item of watchlist) {
            const symbol = typeof item === "string"
                ? item
                : item.symbol;

            if (!symbol) continue;

            const listItem = document.createElement("li");

            const analyzeButton = document.createElement("button");
            analyzeButton.type = "button";
            analyzeButton.textContent = symbol;
            analyzeButton.setAttribute(
                "aria-label",
                `Analyze ${symbol}`
            );

            analyzeButton.addEventListener("click", () => {
                analyzeStock(symbol);
                window.scrollTo({
                    top: 0,
                    behavior: "smooth"
                });
            });

            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.textContent = "Remove";
            removeButton.setAttribute(
                "aria-label",
                `Remove ${symbol} from watchlist`
            );

            removeButton.addEventListener("click", async () => {
                await removeFromWatchlist(symbol);
            });

            listItem.append(analyzeButton, removeButton);
            watchlistList.appendChild(listItem);
        }
    }

    async function loadWatchlist() {
        try {
            const data = await api("/api/stocks/watchlist");

            watchlist = Array.isArray(data.watchlist)
                ? data.watchlist
                : [];

            renderWatchlist();
        } catch (error) {
            showMessage(
                watchlistMessage,
                error.message || "Unable to load watchlist.",
                true
            );
        }
    }

    async function addToWatchlist(symbol) {
        const normalizedSymbol = normalizeSymbol(symbol);

        if (!normalizedSymbol) {
            showMessage(
                watchlistMessage,
                "Enter a valid ticker symbol.",
                true
            );
            return;
        }

        if (watchlistButton) watchlistButton.disabled = true;

        try {
            const data = await api("/api/stocks/watchlist", {
                method: "POST",
                body: JSON.stringify({
                    symbol: normalizedSymbol
                })
            });

            watchlist = Array.isArray(data.watchlist)
                ? data.watchlist
                : watchlist;

            renderWatchlist();

            if (watchlistInput) watchlistInput.value = "";

            showMessage(
                watchlistMessage,
                data.message || `${normalizedSymbol} added to watchlist.`
            );
        } catch (error) {
            showMessage(
                watchlistMessage,
                error.message || "Unable to add stock.",
                true
            );
        } finally {
            if (watchlistButton) watchlistButton.disabled = false;
        }
    }

    async function removeFromWatchlist(symbol) {
        try {
            const data = await api(
                `/api/stocks/watchlist/${encodeURIComponent(symbol)}`,
                { method: "DELETE" }
            );

            watchlist = Array.isArray(data.watchlist)
                ? data.watchlist
                : watchlist.filter((item) =>
                    (typeof item === "string" ? item : item.symbol) !== symbol
                );

            renderWatchlist();

            showMessage(
                watchlistMessage,
                data.message || `${symbol} removed from watchlist.`
            );
        } catch (error) {
            showMessage(
                watchlistMessage,
                error.message || "Unable to remove stock.",
                true
            );
        }
    }

    if (watchlistForm) {
        watchlistForm.addEventListener("submit", (event) => {
            event.preventDefault();
            addToWatchlist(watchlistInput?.value);
        });
    }

    // ---------------------------------------------------------

// ---------------------------------------------------------
// Side-by-side stock comparison
// Uses the existing authenticated /api/stocks/:symbol endpoint.
// ---------------------------------------------------------

async function runStockComparison() {
    const form = document.getElementById("stock-comparison-form");
    const button = document.getElementById("stock-comparison-button");
    const message = document.getElementById("stock-comparison-message");
    const results = document.getElementById("stock-comparison-results");

    if (!form || !button || !message || !results) return;

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const rawSymbols = [
            document.getElementById("comparison-symbol-1")?.value,
            document.getElementById("comparison-symbol-2")?.value,
            document.getElementById("comparison-symbol-3")?.value
        ];

        const enteredSymbols = rawSymbols
            .map((value) => String(value || "").trim())
            .filter(Boolean);

        const symbols = enteredSymbols.map(normalizeSymbol);

        if (symbols.some((symbol) => !symbol)) {
            message.textContent =
                "Enter valid ticker symbols using letters, numbers, dots, hyphens or underscores.";
            results.replaceChildren();
            return;
        }

        if (symbols.length < 2 || symbols.length > 3) {
            message.textContent =
                "Enter two or three stock symbols to compare.";
            return;
        }

        if (new Set(symbols).size !== symbols.length) {
            message.textContent =
                "Each stock symbol must be different.";
            return;
        }

        button.disabled = true;
        message.textContent =
            `Loading comparison for ${symbols.join(", ")}…`;
        results.replaceChildren();

        try {
            const responses = await Promise.allSettled(
                symbols.map((symbol) =>
                    api(`/api/stocks/${encodeURIComponent(symbol)}`)
                )
            );

            const stocks = [];
            const failures = [];

            responses.forEach((response, index) => {
                if (response.status === "fulfilled") {
                    stocks.push(response.value);
                } else {
                    failures.push(
                        `${symbols[index]}: ${
                            response.reason?.message ||
                            "Unable to load stock data."
                        }`
                    );
                }
            });

            if (stocks.length < 2) {
                throw new Error(
                    failures.length
                        ? failures.join(" | ")
                        : "At least two stocks must load successfully."
                );
            }

            renderStockComparisonTable(stocks, results);

            message.textContent = failures.length
                ? `Loaded ${stocks.length} stocks. Some requests failed: ${failures.join(" | ")}`
                : `Comparison ready for ${stocks.map((stock) => stock.symbol).join(", ")}.`;
        } catch (error) {
            message.textContent =
                error.message || "Unable to compare these stocks.";
            results.replaceChildren();
        } finally {
            button.disabled = false;
        }
    });
}

function renderStockComparisonTable(stocks, container) {
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "dcf-calculate-button wacc-comparison-export";
    exportButton.textContent = "Export comparison CSV";

    exportButton.addEventListener("click", () => {
        const headers = [
            "Symbol",
            "Calculation date",
            "WACC (%)",
            "CAPM cost of equity (%)",
            "After-tax cost of debt (%)",
            "Equity weighting (%)",
            "Debt weighting (%)",
            "Risk-free rate (%)",
            "Beta",
            "Expected market return (%)",
            "Pre-tax cost of debt (%)",
            "Tax rate (%)",
            "Equity (input units)",
            "Debt (input units)"
        ];

        const csvRows = [headers];

        function csvCell(value) {
            const text = String(value ?? "");
            return `"${text.replace(/"/g, '""')}"`;
        }

        function formatMetric(value) {
            return Number.isFinite(value)
                ? value.toFixed(4)
                : "Unavailable";
        }

        entries.forEach((entry) => {
            const values = entry.values || {};

            const riskFree = Number(values["wacc-risk-free"]);
            const beta = Number(values["wacc-beta"]);
            const marketReturn = Number(values["wacc-market-return"]);
            const costDebt = Number(values["wacc-cost-debt"]);
            const taxRate = Number(values["wacc-tax-rate"]);
            const equity = Number(values["wacc-equity"]);
            const debt = Number(values["wacc-debt"]);

            const inputs = [
                riskFree, beta, marketReturn,
                costDebt, taxRate, equity, debt
            ];

            let costOfEquity = NaN;
            let afterTaxDebt = NaN;
            let equityWeight = NaN;
            let debtWeight = NaN;

            if (
                inputs.every(Number.isFinite) &&
                equity >= 0 &&
                debt >= 0 &&
                equity + debt > 0
            ) {
                const totalCapital = equity + debt;

                costOfEquity =
                    riskFree + beta * (marketReturn - riskFree);

                afterTaxDebt =
                    costDebt * (1 - taxRate / 100);

                equityWeight = equity / totalCapital * 100;
                debtWeight = debt / totalCapital * 100;
            }

            csvRows.push([
                entry.symbol,
                entry.createdAt,
                formatMetric(Number(entry.wacc)),
                formatMetric(costOfEquity),
                formatMetric(afterTaxDebt),
                formatMetric(equityWeight),
                formatMetric(debtWeight),
                formatMetric(riskFree),
                formatMetric(beta),
                formatMetric(marketReturn),
                formatMetric(costDebt),
                formatMetric(taxRate),
                values["wacc-equity"] ?? "",
                values["wacc-debt"] ?? ""
            ]);
        });

        const csvContent = "\uFEFF" + csvRows
            .map((row) => row.map(csvCell).join(","))
            .join("\r\n");

        const blob = new Blob(
            [csvContent],
            { type: "text/csv;charset=utf-8;" }
        );

        const url = URL.createObjectURL(blob);
        const downloadLink = document.createElement("a");

        downloadLink.href = url;
        downloadLink.download =
            `wacc-comparison-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;

        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();

        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    container.appendChild(exportButton);
    const table = document.createElement("table");
    table.className = "stock-comparison-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const metricHeader = document.createElement("th");
    metricHeader.scope = "col";
    metricHeader.textContent = "Metric";
    headerRow.appendChild(metricHeader);

    for (const stock of stocks) {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent =
            `${stock.company?.name || stock.symbol} (${stock.symbol})`;
        headerRow.appendChild(th);
    }

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    const number = (value, digits = 2) => {
        if (value === null || value === undefined || value === "") {
            return "Unavailable";
        }

        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return "Unavailable";

        return parsed.toLocaleString(undefined, {
            maximumFractionDigits: digits,
            minimumFractionDigits: 0
        });
    };

    const percent = (value) =>
        value === null || value === undefined || value === ""
            ? "Unavailable"
            : `${number(value)}%`;

    const currency = (stock, value) => {
        if (value === null || value === undefined || value === "") {
            return "Unavailable";
        }

        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return "Unavailable";

        const code = stock.company?.currency || "USD";

        try {
            return new Intl.NumberFormat(undefined, {
                style: "currency",
                currency: code,
                maximumFractionDigits: 2
            }).format(parsed);
        } catch {
            return `${code} ${number(parsed)}`;
        }
    };

    const marketCap = (stock) => {
        const value = stock.company?.marketCapitalization;
        if (value === null || value === undefined) {
            return "Unavailable";
        }

        // Finnhub profile market capitalization is expressed in millions.
        return `${number(value)} million ${stock.company?.currency || "USD"}`;
    };

    const fundamentalScores = new Map(
        stocks.map(stock => [
            stock.symbol,
            calculateAdvancedFundamentalScore(stock)
        ])
    );

    const getFundamentalScore = stock =>
        fundamentalScores.get(stock.symbol);

    const formatScore = value =>
        value === null || value === undefined
            ? "Unavailable"
            : `${value}/100`;

    // Per-stock strengths, areas to review, and data coverage.
    const summary = document.createElement("div");
    summary.className = "comparison-insights";

    const summaryHeading = document.createElement("h3");
    summaryHeading.textContent = "Fundamental strengths & areas to review";
    summary.appendChild(summaryHeading);

    const summaryIntro = document.createElement("p");
    summaryIntro.className = "comparison-insights-intro";
    summaryIntro.textContent =
        "Category rankings use the existing fundamental scoring model. " +
        "Compare companies within their industries and review missing data.";
    summary.appendChild(summaryIntro);

    for (const stock of stocks) {
        const scoreData = getFundamentalScore(stock);

        const available = scoreData.categories.filter(category =>
            typeof category.score === "number" &&
            Number.isFinite(category.score)
        );

        const ranked = [...available].sort(
            (a, b) => b.score - a.score
        );

        const card = document.createElement("article");
        card.className = "comparison-insight-card";

        const title = document.createElement("h4");
        title.textContent =
            `${stock.company?.name || stock.symbol} (${stock.symbol})`;

        const overall = document.createElement("p");
        overall.className = "comparison-insight-overall";
        overall.textContent =
            `Overall score: ${formatScore(scoreData.overallScore)}`;

        const coverage = document.createElement("p");
        coverage.className = "comparison-insight-coverage";
        coverage.textContent =
            `Data coverage: ${scoreData.metricScores.length}/11 metrics; ` +
            `${available.length}/5 categories scored.`;

        const strengths = document.createElement("p");
        strengths.textContent = ranked.length
            ? `Strongest category: ${ranked[0].name} (${ranked[0].score}/100).`
            : "Strongest category: unavailable because category scores are missing.";

        const attention = document.createElement("p");
        attention.textContent = ranked.length
            ? `Lowest-scoring category: ${ranked[ranked.length - 1].name} ` +
              `(${ranked[ranked.length - 1].score}/100). Review its underlying metrics.`
            : "Lowest-scoring category: unavailable because category scores are missing.";

        const missing = document.createElement("p");
        missing.className = "comparison-insight-missing";
        missing.textContent = available.length < 5
            ? `Coverage note: ${5 - available.length} category ` +
              `${5 - available.length === 1 ? "score is" : "scores are"} unavailable. ` +
              "Missing data is not ranked as a weak result."
            : "All five category scores are available; individual metrics may still be missing.";

        card.append(title, overall, coverage, strengths, attention, missing);
        summary.appendChild(card);
    }

    // Compare overall fundamental scores and show category-level details.
    const scoreComparisonEntries = stocks.map(stock => ({
        stock,
        scoreData: getFundamentalScore(stock)
    }));

    const getMetricSignature = scoreData =>
        (scoreData?.metricScores || [])
            .map(metric => `${metric.category}::${metric.label}`)
            .sort()
            .join("|");

    const referenceSignature = getMetricSignature(
        scoreComparisonEntries[0]?.scoreData
    );

    const sameMetricCoverage = scoreComparisonEntries.length >= 2 &&
        scoreComparisonEntries.every(entry =>
            getMetricSignature(entry.scoreData) === referenceSignature
        );

    const allScoresAvailable = scoreComparisonEntries.every(entry =>
        Number.isFinite(entry.scoreData?.overallScore)
    );

    const rankingAllowed = sameMetricCoverage && allScoresAvailable;

    const rankingCard = document.createElement("article");
    rankingCard.className =
        "comparison-insight-card comparison-score-ranking";

    const rankingHeading = document.createElement("h4");
    rankingHeading.textContent = "Fundamental score comparison";

    const rankingIntro = document.createElement("p");

    if (!sameMetricCoverage) {
        rankingIntro.textContent =
            "Overall ranking withheld because the companies have different " +
            "sets of available scored metrics. Category-level results are " +
            "still displayed below.";
    } else if (!allScoresAvailable) {
        rankingIntro.textContent =
            "Overall ranking unavailable because at least one company has " +
            "insufficient data. Available category results are displayed below.";
    } else {
        rankingIntro.textContent =
            "Companies are ranked by overall fundamental score. " +
            "Category scores show the contribution of each area.";
    }

    const rankedEntries = rankingAllowed
        ? [...scoreComparisonEntries].sort(
            (a, b) =>
                b.scoreData.overallScore - a.scoreData.overallScore
        )
        : [...scoreComparisonEntries];

    const companyList = document.createElement("ul");
    companyList.className = "comparison-score-company-list";

    let previousScore = null;
    let previousRank = 0;

    for (let index = 0; index < rankedEntries.length; index++) {
        const entry = rankedEntries[index];
        const scoreData = entry.scoreData;
        const score = scoreData?.overallScore;

        const rank = rankingAllowed
            ? (score === previousScore ? previousRank : index + 1)
            : null;

        previousScore = score;
        previousRank = rank;

        const companyName =
            entry.stock.company?.name || entry.stock.symbol;

        const companyItem = document.createElement("li");
        companyItem.className = "comparison-score-company";

        const companyHeading = document.createElement("div");
        companyHeading.className = "comparison-score-company-heading";

        const companyTitle = document.createElement("strong");
        companyTitle.textContent =
            (rankingAllowed ? rank + ". " : "") +
            companyName + " (" + entry.stock.symbol + ")";

        const overallValue = document.createElement("span");
        overallValue.className = "comparison-score-overall-value";
        overallValue.textContent =
            Number.isFinite(score) ? score + "/100" : "Unavailable";

        companyHeading.append(companyTitle, overallValue);

        const companyCoverage = document.createElement("p");
        companyCoverage.className = "comparison-score-company-coverage";
        companyCoverage.textContent =
            (scoreData?.metricScores?.length || 0) +
            "/11 metrics scored; " +
            (scoreData?.scoredCategories?.length || 0) +
            "/5 categories available.";

        const categoryList = document.createElement("ul");
        categoryList.className = "comparison-score-category-list";

        const categories = scoreData?.categories || [];

        for (const category of categories) {
            const categoryItem = document.createElement("li");
            categoryItem.className = "comparison-score-category";

            const categoryName = document.createElement("span");
            categoryName.className = "comparison-score-category-name";
            categoryName.textContent = category.name;

            const categoryValue = document.createElement("strong");
            categoryValue.className = "comparison-score-category-value";
            categoryValue.textContent =
                Number.isFinite(category.score)
                    ? category.score + "/100"
                    : "Unavailable";

            const categoryCoverage = document.createElement("span");
            categoryCoverage.className =
                "comparison-score-category-coverage";

            const metricCount = Array.isArray(category.entries)
                ? category.entries.length
                : 0;

            categoryCoverage.textContent =
                metricCount + (metricCount === 1 ? " metric" : " metrics");

            // Visual category score bar.
            const categoryTrack = document.createElement("div");
            categoryTrack.className = "fundamental-score-track";
            categoryTrack.setAttribute("role", "img");

            const hasCategoryScore = Number.isFinite(category.score);

            categoryTrack.setAttribute(
                "aria-label",
                hasCategoryScore
                    ? `${category.name}: ${category.score} out of 100`
                    : `${category.name}: score unavailable`
            );

            const categoryBar = document.createElement("div");
            categoryBar.className = "fundamental-score-bar";

            const safeCategoryScore = hasCategoryScore
                ? Math.max(0, Math.min(100, category.score))
                : 0;

            categoryBar.style.width = `${safeCategoryScore}%`;

            if (!hasCategoryScore) {
                categoryBar.classList.add("fundamental-score-bar-empty");
            }

            categoryTrack.appendChild(categoryBar);

            categoryItem.append(
                categoryName,
                categoryValue,
                categoryCoverage,
                categoryTrack
            );

            categoryList.appendChild(categoryItem);
        }

        companyItem.append(
            companyHeading,
            companyCoverage,
            categoryList
        );

        companyList.appendChild(companyItem);
    }

    // Compare category leaders across the selected companies.
    const categoryLeaderCard = document.createElement("article");
    categoryLeaderCard.className =
        "comparison-insight-card comparison-category-leaders";

    const categoryLeaderHeading = document.createElement("h4");
    categoryLeaderHeading.textContent = "Category leaders";

    const categoryLeaderIntro = document.createElement("p");
    categoryLeaderIntro.textContent =
        "Highest available category score among the selected companies. " +
        "Tied scores share the lead.";

    const categoryLeaderList = document.createElement("ul");
    categoryLeaderList.className = "comparison-category-leader-list";

    const leaderCategories =
        scoreComparisonEntries[0]?.scoreData?.categories || [];

    for (const category of leaderCategories) {
        const candidates = scoreComparisonEntries
            .map(entry => {
                const matchingCategory =
                    entry.scoreData?.categories?.find(
                        item => item.name === category.name
                    );

                return {
                    stock: entry.stock,
                    score: matchingCategory?.score
                };
            })
            .filter(candidate => Number.isFinite(candidate.score));

        const leaderItem = document.createElement("li");
        leaderItem.className = "comparison-category-leader";

        const leaderName = document.createElement("strong");
        leaderName.className = "comparison-category-leader-name";
        leaderName.textContent = category.name;

        const leaderResult = document.createElement("span");
        leaderResult.className = "comparison-category-leader-result";

        const leaderCoverage = document.createElement("span");
        leaderCoverage.className = "comparison-category-leader-coverage";

        if (candidates.length === 0) {
            leaderResult.textContent = "No available scores";
            leaderCoverage.textContent =
                "0 of " + scoreComparisonEntries.length + " companies";
        } else {
            const highestScore = Math.max(
                ...candidates.map(candidate => candidate.score)
            );

            const leaders = candidates.filter(
                candidate => candidate.score === highestScore
            );

            const leaderNames = leaders.map(candidate =>
                (candidate.stock.company?.name || candidate.stock.symbol) +
                " (" + candidate.stock.symbol + ")"
            );

            leaderResult.textContent =
                leaderNames.join(", ") + " — " + highestScore + "/100";

            leaderCoverage.textContent =
                candidates.length + " of " +
                scoreComparisonEntries.length + " companies scored";

            if (leaders.length > 1) {
                leaderItem.classList.add("has-tied-leaders");
            }
        }

        leaderItem.append(
            leaderName,
            leaderResult,
            leaderCoverage
        );

        categoryLeaderList.appendChild(leaderItem);
    }

    categoryLeaderCard.append(
        categoryLeaderHeading,
        categoryLeaderIntro,
        categoryLeaderList
    );

    // Generate data-driven fundamental comparison insights.
    const comparisonInsightsCard = document.createElement("article");
    comparisonInsightsCard.className =
        "comparison-insight-card comparison-fundamental-insights";

    const comparisonInsightsHeading = document.createElement("h4");
    comparisonInsightsHeading.textContent =
        "Fundamental comparison insights";

    const comparisonInsightsIntro = document.createElement("p");
    comparisonInsightsIntro.textContent =
        "Highlights meaningful differences between the available " +
        "fundamental category scores.";

    const comparisonInsightsList = document.createElement("ul");
    comparisonInsightsList.className =
        "comparison-fundamental-insights-list";

    const insightCategories =
        scoreComparisonEntries[0]?.scoreData?.categories || [];

    let insightCount = 0;
    let categoriesWithCompleteCoverage = 0;

    for (const category of insightCategories) {
        const categoryCandidates = scoreComparisonEntries
            .map(entry => {
                const matchingCategory =
                    entry.scoreData?.categories?.find(
                        item => item.name === category.name
                    );

                return {
                    stock: entry.stock,
                    score: matchingCategory?.score
                };
            })
            .filter(candidate =>
                Number.isFinite(candidate.score)
            );

        if (categoryCandidates.length === scoreComparisonEntries.length) {
            categoriesWithCompleteCoverage++;
        }

        if (categoryCandidates.length < 2) {
            continue;
        }

        const highestScore = Math.max(
            ...categoryCandidates.map(candidate => candidate.score)
        );

        const lowestScore = Math.min(
            ...categoryCandidates.map(candidate => candidate.score)
        );

        const scoreDifference = highestScore - lowestScore;

        if (scoreDifference < 10) {
            continue;
        }

        const leaders = categoryCandidates.filter(
            candidate => candidate.score === highestScore
        );

        const lowestScorers = categoryCandidates.filter(
            candidate => candidate.score === lowestScore
        );

        const leaderNames = leaders.map(candidate =>
            (candidate.stock.company?.name || candidate.stock.symbol) +
            " (" + candidate.stock.symbol + ")"
        );

        const lowestNames = lowestScorers.map(candidate =>
            (candidate.stock.company?.name || candidate.stock.symbol) +
            " (" + candidate.stock.symbol + ")"
        );

        const insightItem = document.createElement("li");
        insightItem.className = "comparison-fundamental-insight";

        const insightTitle = document.createElement("strong");
        insightTitle.textContent = category.name;

        const insightText = document.createElement("p");

        if (leaders.length > 1) {
            insightText.textContent =
                "Tied category leaders: " +
                leaderNames.join(", ") +
                " scored " + highestScore + "/100. " +
                "Lowest score: " + lowestNames.join(", ") +
                " at " + lowestScore + "/100. " +
                "Difference: " + scoreDifference + " points.";
        } else {
            insightText.textContent =
                leaderNames.join(", ") +
                " scored highest at " + highestScore + "/100, " +
                "while " + lowestNames.join(", ") +
                " scored lowest at " + lowestScore + "/100. " +
                "Difference: " + scoreDifference + " points.";
        }

        const insightCoverage = document.createElement("span");
        insightCoverage.className =
            "comparison-fundamental-insight-coverage";

        insightCoverage.textContent =
            categoryCandidates.length + " of " +
            scoreComparisonEntries.length +
            " companies have scores for this category.";

        insightItem.append(
            insightTitle,
            insightText,
            insightCoverage
        );

        comparisonInsightsList.appendChild(insightItem);
        insightCount++;
    }

    const comparisonInsightsSummary = document.createElement("p");
    comparisonInsightsSummary.className =
        "comparison-fundamental-insights-summary";

    comparisonInsightsSummary.textContent =
        insightCount > 0
            ? insightCount +
              " meaningful category difference" +
              (insightCount === 1 ? "" : "s") +
              " identified using a minimum 10-point score gap."
            : "No category differences of 10 points or more were " +
              "identified among the available scores.";

    const comparisonInsightsCoverage = document.createElement("p");
    comparisonInsightsCoverage.className =
        "comparison-fundamental-insights-coverage";

    comparisonInsightsCoverage.textContent =
        categoriesWithCompleteCoverage + " of " +
        insightCategories.length +
        " categories have scores for every selected company. " +
        "Categories with incomplete data are not treated as complete comparisons.";

    const comparisonInsightsDisclaimer = document.createElement("p");
    comparisonInsightsDisclaimer.className =
        "comparison-fundamental-insights-disclaimer";

    comparisonInsightsDisclaimer.textContent =
        "These insights compare heuristic scores only. They do not " +
        "establish business quality, predict future performance, or " +
        "constitute investment advice.";

    comparisonInsightsCard.append(
        comparisonInsightsHeading,
        comparisonInsightsIntro,
        comparisonInsightsList,
        comparisonInsightsSummary,
        comparisonInsightsCoverage,
        comparisonInsightsDisclaimer
    );
    const rankingDisclaimer = document.createElement("p");
    rankingDisclaimer.className = "comparison-insight-missing";
    rankingDisclaimer.textContent =
        "This is a heuristic screening comparison, not an investment " +
        "recommendation. Scores are not sector-adjusted and do not measure " +
        "business quality or investment risk in full.";

    rankingCard.append(
        rankingHeading,
        rankingIntro,
        companyList,
        categoryLeaderCard,
        comparisonInsightsCard,
        rankingDisclaimer
    );

    summary.appendChild(rankingCard);
// Compare individual financial metric leaders.
    const leaderDefinitions = [
        {
            label: "Highest revenue growth",
            key: "revenueGrowthTTMYoy",
            suffix: "%",
            direction: "highest"
        },
        {
            label: "Highest net profit margin",
            key: "netProfitMarginTTM",
            suffix: "%",
            direction: "highest"
        },
        {
            label: "Lowest positive P/E",
            key: "peTTM",
            suffix: "x",
            direction: "lowest",
            positiveOnly: true
        },
        {
            label: "Highest current ratio",
            key: "currentRatio",
            suffix: "x",
            direction: "highest"
        },
        {
            label: "Highest dividend yield",
            key: "dividendYieldIndicatedAnnual",
            suffix: "%",
            direction: "highest",
            nonNegativeOnly: true
        }
    ];

    const leadersCard = document.createElement("article");
    leadersCard.className =
        "comparison-insight-card comparison-metric-leaders";

    const leadersHeading = document.createElement("h4");
    leadersHeading.textContent = "Metric-by-metric comparison leaders";
    leadersCard.appendChild(leadersHeading);

    const leadersIntro = document.createElement("p");
    leadersIntro.textContent =
        "These highlights compare individual reported metrics. " +
        "They are not an overall investment ranking.";
    leadersCard.appendChild(leadersIntro);

    const leadersList = document.createElement("ul");
    leadersList.className = "comparison-metric-leaders-list";

    for (const definition of leaderDefinitions) {
        const candidates = stocks
            .map(stock => {
                const rawValue = stock.fundamentals?.[definition.key];

                if (
                    rawValue === null ||
                    rawValue === undefined ||
                    rawValue === ""
                ) {
                    return null;
                }

                const value = Number(rawValue);

                if (!Number.isFinite(value)) {
                    return null;
                }

                if (definition.positiveOnly && value <= 0) {
                    return null;
                }

                if (definition.nonNegativeOnly && value < 0) {
                    return null;
                }

                return { stock, value };
            })
            .filter(Boolean);

        const item = document.createElement("li");
        const label = document.createElement("strong");
        label.textContent = `${definition.label}: `;

        const result = document.createElement("span");

        if (candidates.length === 0) {
            result.textContent = "No comparable data available.";
        } else if (candidates.length === 1) {
            result.textContent =
                "Only one company has valid data; no comparison possible.";
        } else {
            const bestValue = candidates.reduce((best, candidate) =>
                definition.direction === "lowest"
                    ? Math.min(best, candidate.value)
                    : Math.max(best, candidate.value),
                candidates[0].value
            );

            const leaders = candidates.filter(candidate =>
                Math.abs(candidate.value - bestValue) < 0.000001
            );

            const names = leaders.map(({ stock }) =>
                `${stock.company?.name || stock.symbol} (${stock.symbol})`
            );

            result.textContent =
                `${names.join(", ")} — ${bestValue.toFixed(2)}${definition.suffix}`;
        }

        const coverage = document.createElement("small");
        coverage.className = "comparison-metric-leaders-coverage";
        coverage.textContent =
            `Data coverage: ${candidates.length} of ${stocks.length} companies`;

        const quality = document.createElement("span");
        quality.className = "comparison-metric-leaders-quality";

        if (candidates.length < 2) {
            quality.classList.add("is-insufficient");
            quality.textContent = "Insufficient data";
        } else if (candidates.length < stocks.length) {
            quality.classList.add("is-partial");
            quality.textContent = "Partial comparison";
        } else {
            quality.classList.add("is-complete");
            quality.textContent = "Complete comparison";
        }

        item.append(label, result, coverage, quality);
        leadersList.appendChild(item);
    }

    leadersCard.appendChild(leadersList);
    summary.appendChild(leadersCard);
        // Comparison signals only; these are not investment recommendations.
    const comparisonHighlightRules = {
        peTTM: "lowest-positive",
        priceToBook: "lowest-positive",
        netProfitMarginTTM: "highest",
        grossMarginTTM: "highest",
        operatingMarginTTM: "highest",
        roeTTM: "highest",
        roaTTM: "highest",
        revenueGrowthTTMYoy: "highest",
        epsGrowthTTMYoy: "highest",
        currentRatio: "highest",
        debtToEquity: "lowest-nonnegative",
        dividendYieldIndicatedAnnual: "highest"
    };

    const getComparisonWinner = (key) => {
        const direction = comparisonHighlightRules[key];

        if (!direction) return [];

        const candidates = stocks
            .map((stock, index) => {
                const rawValue = stock.fundamentals?.[key];

                // Missing values must never be interpreted as zero.
                if (
                    rawValue === null ||
                    rawValue === undefined ||
                    (typeof rawValue === "string" && rawValue.trim() === "")
                ) {
                    return null;
                }

                const value = Number(rawValue);

                if (!Number.isFinite(value)) return null;

                if (
                    direction === "lowest-positive" &&
                    value <= 0
                ) {
                    return null;
                }

                if (
                    direction === "lowest-nonnegative" &&
                    value < 0
                ) {
                    return null;
                }

                return { index, value };
            })
            .filter(Boolean);

        // Do not declare a winner with fewer than two valid companies.
        if (candidates.length < 2) return [];

        const best = candidates.reduce((current, candidate) => {
            if (direction === "highest") {
                return Math.max(current, candidate.value);
            }

            return Math.min(current, candidate.value);
        }, candidates[0].value);

        // Highlight ties as well as individual winners.
        const tolerance = Math.max(1, Math.abs(best)) * 0.00000001;

        return candidates
            .filter(candidate =>
                Math.abs(candidate.value - best) <= tolerance
            )
            .map(candidate => candidate.index);
    };
const rows = [
        {
            label: "Advanced fundamental score",
            get: stock => {
                const score = getFundamentalScore(stock).overallScore;
                return formatScore(score);
            }
        },
        {
            label: "Scored metrics",
            get: stock => {
                const score = getFundamentalScore(stock);
                return `${score.metricScores.length}/11 metrics`;
            }
        },
        {
            label: "Available categories",
            get: stock => {
                const score = getFundamentalScore(stock);
                return `${score.scoredCategories.length}/5 categories`;
            }
        },
        {
            label: "Valuation score",
            get: stock => formatScore(
                getFundamentalScore(stock).categories.find(
                    item => item.name === "Valuation"
                )?.score
            )
        },
        {
            label: "Profitability score",
            get: stock => formatScore(
                getFundamentalScore(stock).categories.find(
                    item => item.name === "Profitability"
                )?.score
            )
        },
        {
            label: "Growth score",
            get: stock => formatScore(
                getFundamentalScore(stock).categories.find(
                    item => item.name === "Growth"
                )?.score
            )
        },
        {
            label: "Financial strength score",
            get: stock => formatScore(
                getFundamentalScore(stock).categories.find(
                    item => item.name === "Financial strength"
                )?.score
            )
        },
        {
            label: "Dividends score",
            get: stock => formatScore(
                getFundamentalScore(stock).categories.find(
                    item => item.name === "Dividends"
                )?.score
            )
        },
        {
            label: "Current price",
            get: (s) => currency(s, s.quote?.current)
        },
        {
            label: "Daily change",
            get: (s) => {
                const change = s.quote?.change;
                const changePercent = s.quote?.changePercent;

                if (change == null && changePercent == null) {
                    return "Unavailable";
                }

                const currencyChange = change == null
                    ? "Unavailable"
                    : currency(s, change);

                const percentChange = changePercent == null
                    ? "Unavailable"
                    : `${number(changePercent)}%`;

                return `${currencyChange} (${percentChange})`;
            }
        },
        { label: "Market capitalization", get: marketCap },
        { label: "P/E (TTM)", key: "peTTM", get: (s) => number(s.fundamentals?.peTTM) },
        { label: "EPS (TTM)", get: (s) => currency(s, s.fundamentals?.epsTTM) },
        { label: "Price-to-book", key: "priceToBook", get: (s) => number(s.fundamentals?.priceToBook) },
        { label: "Net profit margin", key: "netProfitMarginTTM", get: (s) => percent(s.fundamentals?.netProfitMarginTTM) },
        { label: "Gross margin", key: "grossMarginTTM", get: (s) => percent(s.fundamentals?.grossMarginTTM) },
        { label: "Operating margin", key: "operatingMarginTTM", get: (s) => percent(s.fundamentals?.operatingMarginTTM) },
        { label: "Return on equity (ROE)", key: "roeTTM", get: (s) => percent(s.fundamentals?.roeTTM) },
        { label: "Return on assets (ROA)", key: "roaTTM", get: (s) => percent(s.fundamentals?.roaTTM) },
        { label: "Revenue growth (YoY)", key: "revenueGrowthTTMYoy", get: (s) => percent(s.fundamentals?.revenueGrowthTTMYoy) },
        { label: "EPS growth (YoY)", key: "epsGrowthTTMYoy", get: (s) => percent(s.fundamentals?.epsGrowthTTMYoy) },
        { label: "Current ratio", key: "currentRatio", get: (s) => number(s.fundamentals?.currentRatio) },
        { label: "Debt-to-equity", key: "debtToEquity", get: (s) => number(s.fundamentals?.debtToEquity) },
        { label: "Dividend yield", key: "dividendYieldIndicatedAnnual", get: (s) => percent(s.fundamentals?.dividendYieldIndicatedAnnual) },
        { label: "Beta", get: (s) => number(s.fundamentals?.beta) },
        { label: "52-week high", get: (s) => currency(s, s.fundamentals?.week52High) },
        { label: "52-week low", get: (s) => currency(s, s.fundamentals?.week52Low) }
    ];

    for (const item of rows) {
        const row = document.createElement("tr");
        const labelCell = document.createElement("th");
        labelCell.scope = "row";
        labelCell.textContent = item.label;
        row.appendChild(labelCell);

        const winningIndexes = item.key
            ? getComparisonWinner(item.key)
            : [];

        stocks.forEach((stock, index) => {
            const cell = document.createElement("td");
            cell.textContent = item.get(stock);

            if (winningIndexes.includes(index)) {
                cell.classList.add("comparison-best-value");

                const marker = document.createElement("span");
                marker.className = "comparison-best-value-label";
                marker.textContent = "Best";
                marker.title = "Best value among companies with valid data";

                cell.appendChild(marker);
            }

            row.appendChild(cell);
        });

        tbody.appendChild(row);
    }

    table.appendChild(tbody);
    // ---------------------------------------------------------
    // Visual stock comparison charts
    // ---------------------------------------------------------

    const chartsContainer = document.createElement("section");
    chartsContainer.className = "stock-comparison-charts";
    chartsContainer.setAttribute(
        "aria-label",
        "Visual comparison of stock valuation, profitability and growth"
    );

    const chartsHeading = document.createElement("h3");
    chartsHeading.textContent = "Visual financial comparison";
    chartsContainer.appendChild(chartsHeading);

    const chartsIntro = document.createElement("p");
    chartsIntro.className = "stock-comparison-charts-intro";
    chartsIntro.textContent =
        "Each metric has its own scale. Bars compare the selected companies; " +
        "negative values extend to the left where applicable. Missing data is shown as N/A.";
    chartsContainer.appendChild(chartsIntro);

    const chartColors = [
        "#6d8cff",
        "#22a06b",
        "#d99032"
    ];

    const metricDescriptions = {
        peTTM: "Price-to-earnings compares the share price with earnings per share. A lower figure is not automatically better.",
        priceToBook: "Price-to-book compares the company's market value with its reported book value.",
        netProfitMarginTTM: "Shows how much net profit the company earns from each unit of revenue.",
        roeTTM: "Return on equity measures how effectively the company generates profit from shareholders' equity.",
        roaTTM: "Return on assets measures how effectively the company uses its assets to generate profit.",
        revenueGrowthTTMYoy: "Measures the change in revenue compared with the same period one year earlier.",
        epsGrowthTTMYoy: "Measures the change in earnings per share compared with the same period one year earlier.",
        currentRatio: "Compares current assets with current liabilities. It provides an indication of short-term liquidity.",
        debtToEquity: "Compares debt with shareholders' equity. Higher values can indicate greater financial leverage.",
        dividendYieldIndicatedAnnual: "Estimates annual dividends as a percentage of the current share price. The yield can change."
    };
    const chartGroups = [
        {
            title: "Valuation",
            description: "Lower positive multiples can indicate a cheaper valuation, but should be compared within the same industry.",
            metrics: [
                { label: "P/E (TTM)", key: "peTTM", suffix: "x" },
                { label: "Price-to-book", key: "priceToBook", suffix: "x" }
            ]
        },
        {
            title: "Profitability",
            description: "These percentages show how effectively companies generate profits and returns.",
            metrics: [
                { label: "Net profit margin", key: "netProfitMarginTTM", suffix: "%" },
                { label: "ROE", key: "roeTTM", suffix: "%" },
                { label: "ROA", key: "roaTTM", suffix: "%" }
            ]
        },
        {
            title: "Growth",
            description: "Year-over-year growth can be negative as well as positive.",
            metrics: [
                { label: "Revenue growth (YoY)", key: "revenueGrowthTTMYoy", suffix: "%" },
                { label: "EPS growth (YoY)", key: "epsGrowthTTMYoy", suffix: "%" }
            ]
        },
        {
            title: "Financial strength",
            description: "Current ratio and debt-to-equity provide different views of liquidity and leverage. Interpret them in the context of the company's industry.",
            metrics: [
                { label: "Current ratio", key: "currentRatio", suffix: "x" },
                { label: "Debt-to-equity", key: "debtToEquity", suffix: "x" }
            ]
        },
        {
            title: "Dividends",
            description: "Indicated annual dividend yield is a percentage of the current share price and can change as prices and payouts change.",
            metrics: [
                { label: "Dividend yield", key: "dividendYieldIndicatedAnnual", suffix: "%" }
            ]
        }
    ];

    for (const group of chartGroups) {
        const groupPanel = document.createElement("section");
        groupPanel.className = "stock-comparison-chart-panel";

        const groupHeading = document.createElement("h4");
        groupHeading.textContent = group.title;
        groupPanel.appendChild(groupHeading);

        const groupDescription = document.createElement("p");
        groupDescription.className = "stock-comparison-chart-description";
        groupDescription.textContent = group.description;
        groupPanel.appendChild(groupDescription);

        const legend = document.createElement("div");
        legend.className = "stock-comparison-chart-legend";

        stocks.forEach((stock, index) => {
            const legendItem = document.createElement("span");
            legendItem.className = "stock-comparison-legend-item";

            const swatch = document.createElement("span");
            swatch.className = "stock-comparison-legend-swatch";
            swatch.style.backgroundColor =
                chartColors[index % chartColors.length];

            const legendLabel = document.createElement("span");
            legendLabel.textContent = stock.symbol;

            legendItem.append(swatch, legendLabel);
            legend.appendChild(legendItem);
        });

        groupPanel.appendChild(legend);

        for (const metric of group.metrics) {
            const metricValues = stocks.map((stock) => {
                const rawValue = stock.fundamentals?.[metric.key];

                if (rawValue === null || rawValue === undefined || rawValue === "") {
                    return null;
                }

                const value = Number(rawValue);
                return Number.isFinite(value) ? value : null;
            });

            const availableValues = metricValues.filter(
                value => value !== null
            );

            const hasNegative = availableValues.some(value => value < 0);
            const maximum = Math.max(
                0,
                ...availableValues.map(value => Math.abs(value))
            ) || 1;

            const metricBlock = document.createElement("div");
            metricBlock.className = "stock-comparison-metric";

            const metricHeading = document.createElement("h5");
            metricHeading.textContent = metric.label;
            metricBlock.appendChild(metricHeading);

            const metricDescription = document.createElement("p");
            metricDescription.className = "stock-comparison-metric-description";
            metricDescription.textContent =
                metricDescriptions[metric.key] ||
                "Financial metric used for company comparison.";

            metricBlock.appendChild(metricDescription);

            stocks.forEach((stock, index) => {
                const value = metricValues[index];

                const stockRow = document.createElement("div");
                stockRow.className = "stock-comparison-chart-row";

                const stockLabel = document.createElement("span");
                stockLabel.className = "stock-comparison-chart-symbol";
                stockLabel.textContent = stock.symbol;

                const track = document.createElement("div");
                track.className = "stock-comparison-chart-track";

                const chartDescription = value === null
                    ? `${stock.symbol}: ${metric.label}, no data available`
                    : `${stock.symbol}: ${metric.label}, ${value.toFixed(2)}${metric.suffix}`;

                track.setAttribute("role", "img");
                track.setAttribute("aria-label", chartDescription);
                track.title = chartDescription;

                if (hasNegative) {
                    track.classList.add("has-negative-values");

                    const zeroLine = document.createElement("span");
                    zeroLine.className = "stock-comparison-chart-zero";
                    track.appendChild(zeroLine);
                }

                if (value !== null && value !== 0) {
                    const bar = document.createElement("span");
                    bar.className = "stock-comparison-chart-bar";
                    bar.style.backgroundColor =
                        chartColors[index % chartColors.length];

                    const width = hasNegative
                        ? (Math.abs(value) / maximum) * 48
                        : (Math.abs(value) / maximum) * 100;

                    bar.style.width = `${width}%`;

                    if (hasNegative) {
                        bar.style.left = value < 0
                            ? `${50 - width}%`
                            : "50%";
                    } else {
                        bar.style.left = "0";
                    }

                    track.appendChild(bar);
                }

                const valueLabel = document.createElement("span");
                valueLabel.className = "stock-comparison-chart-value";

                valueLabel.textContent = value === null
                    ? "N/A"
                    : `${value.toFixed(2)}${metric.suffix}`;

                if (value === null) {
                    valueLabel.classList.add("is-unavailable");
                }

                stockRow.append(stockLabel, track, valueLabel);
                metricBlock.appendChild(stockRow);
            });

            groupPanel.appendChild(metricBlock);
        }

        chartsContainer.appendChild(groupPanel);
    }
    container.replaceChildren(summary, chartsContainer, exportButton, table);
}
    // Initial page load
    // ---------------------------------------------------------

    runStockComparison();

    loadWatchlist();

    const parameters = new URLSearchParams(window.location.search);
    const initialSymbol = parameters.get("symbol") || "AAPL";

    if (symbolInput) {
        symbolInput.value = initialSymbol;
    }

    analyzeStock(initialSymbol, false);
});





























