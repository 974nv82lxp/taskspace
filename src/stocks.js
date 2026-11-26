
import express from "express";
import db from "./db.js";
import YahooFinance from "yahoo-finance2";

const router = express.Router();

const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";
const SYMBOL_PATTERN = /^[A-Z0-9.^_-]{1,20}$/;

db.exec(`
    CREATE TABLE IF NOT EXISTS stock_watchlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        UNIQUE (user_id, symbol),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_stock_watchlist_user
    ON stock_watchlist(user_id);
`);


async function getOptionalCashFlow(symbol) {
    const yahooFinance = new YahooFinance();

    const validNumber = (value) =>
        typeof value === "number" && Number.isFinite(value);

    const toDateKey = (value) => {
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value.toISOString().slice(0, 10);
        }

        if (typeof value === "number" && Number.isFinite(value)) {
            const date = new Date(value * 1000);
            return Number.isNaN(date.getTime())
                ? null
                : date.toISOString().slice(0, 10);
        }

        if (typeof value === "string" && value.length >= 10) {
            return value.slice(0, 10);
        }

        return null;
    };

    // Keep the existing trailing cash-flow history for the other analyses.
    let rows = [];

    try {
        const result = await yahooFinance.fundamentalsTimeSeries(
            symbol,
            {
                period1: "2020-01-01",
                type: "trailing",
                module: "cash-flow"
            },
            { validateResult: false }
        );

        if (Array.isArray(result)) {
            rows = result;
        }
    } catch {
        // Annual FCFF retrieval is attempted independently below.
    }

    const periods = rows
        .map((row) => {
            const date = toDateKey(row?.date);

            const operatingCashFlow = validNumber(row?.operatingCashFlow)
                ? row.operatingCashFlow
                : null;

            const capitalExpenditure = validNumber(row?.capitalExpenditure)
                ? row.capitalExpenditure
                : null;

            const reportedFreeCashFlow = validNumber(row?.freeCashFlow)
                ? row.freeCashFlow
                : null;

            const freeCashFlow = reportedFreeCashFlow !== null
                ? reportedFreeCashFlow
                : operatingCashFlow !== null && capitalExpenditure !== null
                    ? operatingCashFlow + capitalExpenditure
                    : null;

            const netIncome = validNumber(
                row?.netIncomeFromContinuingOperations
            )
                ? row.netIncomeFromContinuingOperations
                : null;

            return {
                date,
                operatingCashFlow,
                capitalExpenditure,
                freeCashFlow,
                netIncome
            };
        })
        .filter((period) =>
            period.date &&
            (
                period.operatingCashFlow !== null ||
                period.capitalExpenditure !== null ||
                period.freeCashFlow !== null ||
                period.netIncome !== null
            )
        )
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 8);

    // Retrieve annual income-statement and cash-flow data independently
    // from the trailing history above.
    let annualFinancialRows = [];
    let annualCashFlowRows = [];

    const annualResults = await Promise.allSettled([
        yahooFinance.fundamentalsTimeSeries(
            symbol,
            {
                period1: "2020-01-01",
                type: "annual",
                module: "financials"
            },
            { validateResult: false }
        ),
        yahooFinance.fundamentalsTimeSeries(
            symbol,
            {
                period1: "2020-01-01",
                type: "annual",
                module: "cash-flow"
            },
            { validateResult: false }
        )
    ]);

    if (
        annualResults[0].status === "fulfilled" &&
        Array.isArray(annualResults[0].value)
    ) {
        annualFinancialRows = annualResults[0].value;
    }

    if (
        annualResults[1].status === "fulfilled" &&
        Array.isArray(annualResults[1].value)
    ) {
        annualCashFlowRows = annualResults[1].value;
    }

    // Match income-statement and cash-flow figures by the exact fiscal date.
    const financialByDate = new Map();

    for (const row of annualFinancialRows) {
        const date = toDateKey(row?.date);

        if (date) {
            financialByDate.set(date, row);
        }
    }

    const annualFCFFCandidates = [];

    for (const cashRow of annualCashFlowRows) {
        const date = toDateKey(cashRow?.date);
        const financialRow = date
            ? financialByDate.get(date)
            : null;

        if (!date || !financialRow) {
            continue;
        }

        const ebit = validNumber(financialRow.EBIT)
            ? financialRow.EBIT
            : validNumber(financialRow.operatingIncome)
                ? financialRow.operatingIncome
                : null;

        let taxRate = null;

        if (
            validNumber(financialRow.taxRateForCalcs) &&
            financialRow.taxRateForCalcs >= 0 &&
            financialRow.taxRateForCalcs <= 1
        ) {
            taxRate = financialRow.taxRateForCalcs;
        } else if (
            validNumber(financialRow.taxProvision) &&
            validNumber(financialRow.pretaxIncome) &&
            financialRow.pretaxIncome > 0
        ) {
            const calculatedTaxRate =
                financialRow.taxProvision / financialRow.pretaxIncome;

            if (
                Number.isFinite(calculatedTaxRate) &&
                calculatedTaxRate >= 0 &&
                calculatedTaxRate <= 1
            ) {
                taxRate = calculatedTaxRate;
            }
        }

        const depreciationAndAmortization =
            validNumber(cashRow.depreciationAndAmortization)
                ? cashRow.depreciationAndAmortization
                : validNumber(cashRow.depreciationAmortizationDepletion)
                    ? cashRow.depreciationAmortizationDepletion
                    : null;

        const capitalExpenditure = validNumber(cashRow.capitalExpenditure)
            ? cashRow.capitalExpenditure
            : null;

        const changeInWorkingCapital =
            validNumber(cashRow.changeInWorkingCapital)
                ? cashRow.changeInWorkingCapital
                : null;

        // Do not calculate FCFF from incomplete annual statements.
        if (
            ebit === null ||
            taxRate === null ||
            depreciationAndAmortization === null ||
            capitalExpenditure === null ||
            changeInWorkingCapital === null
        ) {
            continue;
        }

        // Yahoo reports capital expenditure and working-capital changes
        // as signed cash-flow impacts. Keep those signs as reported.
        const value =
            ebit * (1 - taxRate) +
            depreciationAndAmortization +
            capitalExpenditure +
            changeInWorkingCapital;

        if (!Number.isFinite(value)) {
            continue;
        }

        annualFCFFCandidates.push({
            date,
            value,
            components: {
                ebit,
                taxRate,
                depreciationAndAmortization,
                capitalExpenditure,
                changeInWorkingCapital
            }
        });
    }

    annualFCFFCandidates.sort((a, b) =>
        b.date.localeCompare(a.date)
    );

    const latestFCFF = annualFCFFCandidates[0] || null;

    const fcff = latestFCFF
        ? {
            available: true,
            source: "Yahoo Finance",
            date: latestFCFF.date,
            value: latestFCFF.value,
            components: latestFCFF.components,
            method: "EBIT × (1 − tax rate) + depreciation and amortization + capital expenditure + change in working capital",
            message: "Calculated from matching annual income-statement and cash-flow figures. Review the reported components and accounting sign conventions."
        }
        : {
            available: false,
            source: "Yahoo Finance",
            date: null,
            value: null,
            components: null,
            method: null,
            message: "Annual FCFF could not be calculated because matching annual statement data or required components were unavailable."
        };

    return {
        available: periods.length > 0 || fcff.available,
        source: "Yahoo Finance",
        currency: null,
        periods,
        fcff,
        message: periods.length > 0 || fcff.available
            ? null
            : "No usable cash-flow or annual FCFF figures were returned."
    };
}
async function getOptionalBalanceSheet(symbol) {
    try {
        const yahooFinance = new YahooFinance();

        const rows = await yahooFinance.fundamentalsTimeSeries(
            symbol,
            {
                period1: "2020-01-01",
                type: "quarterly",
                module: "balance-sheet"
            },
            { validateResult: false }
        );

        const validNumber = (value) =>
            typeof value === "number" && Number.isFinite(value);

        if (!Array.isArray(rows) || rows.length === 0) {
            return {
                available: false,
                source: "Yahoo Finance",
                date: null,
                netDebt: null,
                sharesOutstanding: null
            };
        }

        const latest = rows
            .filter(row => row?.date)
            .sort((a, b) =>
                new Date(b.date).getTime() - new Date(a.date).getTime()
            )[0];

        if (!latest) {
            return {
                available: false,
                source: "Yahoo Finance",
                date: null,
                netDebt: null,
                sharesOutstanding: null
            };
        }

        let totalDebt = null;

        if (validNumber(latest.totalDebt) && latest.totalDebt >= 0) {
            totalDebt = latest.totalDebt;
        }

        let netDebt = null;

        if (validNumber(latest.netDebt)) {
            netDebt = latest.netDebt;
        } else if (
            validNumber(latest.totalDebt) &&
            validNumber(latest.cashAndCashEquivalents)
        ) {
            netDebt =
                latest.totalDebt - latest.cashAndCashEquivalents;
        }

        const sharesOutstanding =
            validNumber(latest.ordinarySharesNumber) &&
            latest.ordinarySharesNumber > 0
                ? latest.ordinarySharesNumber
                : null;

        return {
            available:
                totalDebt !== null ||
                netDebt !== null ||
                sharesOutstanding !== null,
            source: "Yahoo Finance",
            date: latest.date instanceof Date
                ? latest.date.toISOString().slice(0, 10)
                : String(latest.date).slice(0, 10),
            totalDebt,
            netDebt,
            sharesOutstanding
        };
    } catch {
        return {
            available: false,
            source: "Yahoo Finance",
            date: null,
            totalDebt: null,
            netDebt: null,
            sharesOutstanding: null
        };
    }
}
function requireAuth(req, res, next) {
    if (!req.session?.userId) {
        return res.status(401).json({
            error: "Please log in to use stock analysis."
        });
    }

    next();
}

function normalizeSymbol(value) {
    if (typeof value !== "string") return null;

    const symbol = value.trim().toUpperCase();

    return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

function getApiKey() {
    const key = process.env.FINNHUB_API_KEY;

    if (!key || !key.trim()) {
        const error = new Error(
            "Finnhub is not configured. Add FINNHUB_API_KEY to your .env file."
        );
        error.status = 503;
        throw error;
    }

    return key.trim();
}

async function finnhubRequest(endpoint, parameters = {}) {
    const url = new URL(`${FINNHUB_BASE_URL}${endpoint}`);
    url.searchParams.set("token", getApiKey());

    for (const [key, value] of Object.entries(parameters)) {
        url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
        signal: AbortSignal.timeout(12000)
    });

    if (response.status === 401) {
        const error = new Error(
            "Finnhub authentication failed. Check your API key."
        );
        error.status = 502;
        throw error;
    }

    if (response.status === 403) {
        const error = new Error(
            `Finnhub denied access to ${endpoint}. Check your API permissions and plan.`
        );
        error.status = 502;
        throw error;
    }

    if (response.status === 429) {
        const error = new Error(
            "Finnhub rate limit reached. Please wait and try again."
        );
        error.status = 429;
        throw error;
    }

    if (!response.ok) {
        const error = new Error(
            `Finnhub request to ${endpoint} failed with HTTP ${response.status}.`
        );
        error.status = 502;
        throw error;
    }

    return response.json();
}

function calculateSMA(values, period) {
    if (values.length < period) return null;

    const recent = values.slice(-period);

    return recent.reduce((sum, value) => sum + value, 0) / period;
}

function calculateEMA(values, period) {
    if (values.length < period) return [];

    const multiplier = 2 / (period + 1);
    const output = [];

    let ema = values.slice(0, period)
        .reduce((sum, value) => sum + value, 0) / period;

    output[period - 1] = ema;

    for (let index = period; index < values.length; index += 1) {
        ema = (values[index] - ema) * multiplier + ema;
        output[index] = ema;
    }

    return output;
}

function calculateRSI(values, period = 14) {
    if (values.length <= period) return null;

    let gains = 0;
    let losses = 0;

    for (let index = 1; index <= period; index += 1) {
        const change = values[index] - values[index - 1];

        if (change > 0) gains += change;
        if (change < 0) losses -= change;
    }

    let averageGain = gains / period;
    let averageLoss = losses / period;

    for (let index = period + 1; index < values.length; index += 1) {
        const change = values[index] - values[index - 1];

        averageGain =
            (averageGain * (period - 1) + Math.max(change, 0)) / period;

        averageLoss =
            (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    }

    if (averageGain === 0 && averageLoss === 0) return 50;
    if (averageLoss === 0) return 100;

    const relativeStrength = averageGain / averageLoss;

    return 100 - 100 / (1 + relativeStrength);
}

function calculateMACD(values) {
    const ema12 = calculateEMA(values, 12);
    const ema26 = calculateEMA(values, 26);

    const macdValues = values.map((_, index) => {
        if (ema12[index] === undefined || ema26[index] === undefined) {
            return null;
        }

        return ema12[index] - ema26[index];
    });

    const validMACD = macdValues.filter(Number.isFinite);
    const signalValues = calculateEMA(validMACD, 9);

    if (validMACD.length === 0 || signalValues.length === 0) {
        return {
            macd: null,
            signal: null,
            histogram: null
        };
    }

    const macd = validMACD.at(-1);
    const signal = signalValues.at(-1);

    return {
        macd,
        signal,
        histogram: macd - signal
    };
}

function round(value, digits = 2) {
    if (!Number.isFinite(value)) return null;

    return Number(value.toFixed(digits));
}

function metricValue(metrics, ...keys) {
    for (const key of keys) {
        const value = metrics[key];

        if (value !== null && value !== undefined && value !== "") {
            const number = Number(value);

            if (Number.isFinite(number)) return number;
        }
    }

    return null;
}

function calculateIndicators(candles) {
    const closes = candles.c;

    return {
        rsi14: round(calculateRSI(closes)),
        sma20: round(calculateSMA(closes, 20)),
        sma50: round(calculateSMA(closes, 50)),
        ema20: round(calculateEMA(closes, 20).at(-1)),
        macd: Object.fromEntries(
            Object.entries(calculateMACD(closes)).map(
                ([key, value]) => [key, round(value, 4)]
            )
        )
    };
}

function getWatchlist(userId) {
    return db.prepare(`
        SELECT symbol, created_at AS createdAt
        FROM stock_watchlist
        WHERE user_id = ?
        ORDER BY created_at DESC, symbol ASC
    `).all(userId);
}

router.use(requireAuth);

// GET /api/stocks/search?q=AAPL
router.get("/search", async (req, res, next) => {
    try {
        const query = typeof req.query.q === "string"
            ? req.query.q.trim()
            : "";

        if (!query || query.length > 50) {
            return res.status(400).json({
                error: "Enter a company name or ticker symbol."
            });
        }

        const data = await finnhubRequest("/search", { q: query });

        const results = (Array.isArray(data.result) ? data.result : [])
            .slice(0, 10)
            .map((item) => ({
                symbol: item.symbol,
                description: item.description,
                type: item.type
            }));

        res.json({ results });
    } catch (error) {
        next(error);
    }
});

// GET /api/stocks/watchlist
router.get("/watchlist", (req, res) => {
    res.json({ watchlist: getWatchlist(req.session.userId) });
});

// POST /api/stocks/watchlist { "symbol": "AAPL" }
router.post("/watchlist", (req, res, next) => {
    const symbol = normalizeSymbol(req.body?.symbol);

    if (!symbol) {
        return res.status(400).json({
            error: "Enter a valid ticker symbol."
        });
    }

    try {
        db.prepare(`
            INSERT INTO stock_watchlist (user_id, symbol)
            VALUES (?, ?)
            ON CONFLICT(user_id, symbol) DO NOTHING
        `).run(req.session.userId, symbol);

        res.status(201).json({
            message: `${symbol} is in your watchlist.`,
            watchlist: getWatchlist(req.session.userId)
        });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/stocks/watchlist/AAPL
router.delete("/watchlist/:symbol", (req, res, next) => {
    const symbol = normalizeSymbol(req.params.symbol);

    if (!symbol) {
        return res.status(400).json({
            error: "Invalid ticker symbol."
        });
    }

    try {
        db.prepare(`
            DELETE FROM stock_watchlist
            WHERE user_id = ? AND symbol = ?
        `).run(req.session.userId, symbol);

        res.json({
            message: `${symbol} removed from your watchlist.`,
            watchlist: getWatchlist(req.session.userId)
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/stocks/AAPL
router.get("/:symbol", async (req, res, next) => {
    const symbol = normalizeSymbol(req.params.symbol);

    if (!symbol) {
        return res.status(400).json({
            error: "Invalid ticker symbol."
        });
    }

    try {
        const to = Math.floor(Date.now() / 1000);
        const from = to - 200 * 24 * 60 * 60;

        // Quotes, company profiles and financial metrics are required.
        // Historical candles are optional because Finnhub access can vary
        // by account plan. A candle failure must not block fundamentals.
        let candleUnavailableReason = null;

        const candleRequest = finnhubRequest("/stock/candle", {
            symbol,
            resolution: "D",
            from,
            to
        }).catch((error) => {
            if (error.status === 502 && /HTTP 403|denied access/.test(error.message)) {
                candleUnavailableReason =
                    "Historical candles are restricted by your Finnhub API access or plan.";
            } else if (error.status === 429) {
                candleUnavailableReason =
                    "Historical candles are temporarily unavailable because the Finnhub rate limit was reached.";
            } else if (error.name === "TimeoutError" ||
                       error.name === "AbortError") {
                candleUnavailableReason =
                    "The historical price request timed out.";
            } else {
                candleUnavailableReason =
                    "Historical price data could not be loaded from Finnhub.";
            }

            return null;
        });

        const [quote, profile, metrics, candles, cashFlow, balanceSheet] = await Promise.all([
            finnhubRequest("/quote", { symbol }),
            finnhubRequest("/stock/profile2", { symbol }),
            finnhubRequest("/stock/metric", {
                symbol,
                metric: "all"
            }),
            candleRequest,
            Promise.race([
                getOptionalCashFlow(symbol),
                new Promise((resolve) => setTimeout(() => resolve({
                    available: false,
                    source: "Yahoo Finance",
                    currency: null,
                    periods: [],
                    message: "Cash-flow lookup timed out."
                }), 8000))
            ]),
            Promise.race([
                getOptionalBalanceSheet(symbol),
                new Promise((resolve) => setTimeout(() => resolve({
                    available: false,
                    source: "Yahoo Finance",
                    date: null,
                    totalDebt: null,
                    netDebt: null,
                    sharesOutstanding: null
                }), 8000))
            ])
        ]);

        const validCandles =
            candles?.s === "ok" &&
            Array.isArray(candles.c) &&
            Array.isArray(candles.t) &&
            Array.isArray(candles.o) &&
            Array.isArray(candles.h) &&
            Array.isArray(candles.l) &&
            Array.isArray(candles.v) &&
            candles.c.length > 0;

        const history = validCandles
            ? candles.t.map((timestamp, index) => ({
                date: new Date(timestamp * 1000).toISOString().slice(0, 10),
                open: candles.o[index],
                high: candles.h[index],
                low: candles.l[index],
                close: candles.c[index],
                volume: candles.v[index]
            }))
            : [];

        const metricData = metrics?.metric ?? {};

        res.json({
            symbol,

            quote: {
                current: Number.isFinite(quote?.c) && quote.c > 0
                    ? quote.c
                    : null,
                change: Number.isFinite(quote?.d) ? quote.d : null,
                changePercent: Number.isFinite(quote?.dp) ? quote.dp : null,
                high: Number.isFinite(quote?.h) ? quote.h : null,
                low: Number.isFinite(quote?.l) ? quote.l : null,
                open: Number.isFinite(quote?.o) ? quote.o : null,
                previousClose: Number.isFinite(quote?.pc) ? quote.pc : null,
                timestamp: Number.isFinite(quote?.t)
                    ? new Date(quote.t * 1000).toISOString()
                    : null
            },

            company: {
                name: profile?.name || symbol,
                ticker: profile?.ticker || symbol,
                exchange: profile?.exchange || null,
                industry: profile?.finnhubIndustry || null,
                country: profile?.country || null,
                currency: profile?.currency || null,
                website: profile?.weburl || null,
                marketCapitalization:
                    Number.isFinite(profile?.marketCapitalization)
                        ? profile.marketCapitalization
                        : null
            },

            cashFlow,
            balanceSheet,

            fundamentals: {
                peTTM: metricValue(metricData, "peTTM"),
                epsTTM: metricValue(metricData, "epsTTM"),
                revenuePerShareTTM:
                    metricValue(metricData, "revenuePerShareTTM"),

                netProfitMarginTTM:
                    metricValue(metricData, "netProfitMarginTTM"),
                grossMarginTTM:
                    metricValue(metricData, "grossMarginTTM"),
                operatingMarginTTM:
                    metricValue(metricData, "operatingMarginTTM"),

                roeTTM: metricValue(metricData, "roeTTM"),
                roaTTM: metricValue(metricData, "roaTTM"),
                currentRatio:
                    metricValue(metricData, "currentRatioQuarterly"),

                priceToBook:
                    metricValue(metricData, "pbQuarterly", "pbAnnual"),
                beta: metricValue(metricData, "beta"),
                debtToEquity:
                    metricValue(
                        metricData,
                        "totalDebt/totalEquityQuarterly",
                        "totalDebt/totalEquityAnnual",
                        "totalDebtToEquityQuarterly",
                        "totalDebtToEquityAnnual"
                    ),

                revenueGrowthTTMYoy:
                    metricValue(metricData, "revenueGrowthTTMYoy"),
                epsGrowthTTMYoy:
                    metricValue(metricData, "epsGrowthTTMYoy"),

                dividendYieldIndicatedAnnual:
                    metricValue(metricData, "dividendYieldIndicatedAnnual"),

                week52High: metricValue(metricData, "52WeekHigh"),
                week52Low: metricValue(metricData, "52WeekLow")
            },

            history,

            indicators: validCandles
                ? calculateIndicators(candles)
                : {
                    rsi14: null,
                    sma20: null,
                    sma50: null,
                    ema20: null,
                    macd: {
                        macd: null,
                        signal: null,
                        histogram: null
                    }
                },

            dataStatus: {
                quoteSource: "Finnhub",
                historySource: validCandles
                    ? "Finnhub daily candles"
                    : "Unavailable",
                historyAvailable: history.length > 0,
                historyError: validCandles
                    ? null
                    : candleUnavailableReason ||
                      "Finnhub returned no historical candle data for this symbol.",
                quoteTimestamp: Number.isFinite(quote?.t)
                    ? new Date(quote.t * 1000).toISOString()
                    : null,
                note: validCandles
                    ? "Market data may be delayed or limited by your Finnhub plan."
                    : "Quote and fundamental data may be available even when historical candles are restricted."
            }
        });
    } catch (error) {
        next(error);
    }
});

export default router;



