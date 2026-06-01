/**
 * XO Pulse Trading Bot v2
 * 
 * Strategy: At T-6 seconds before 5-min window close,
 * BTC has basically moved where it's going. Buy the
 * near-certain winner if market price still has 2¢+ edge.
 * 
 * Currently runs in PAPER TRADING mode.
 * Switch PAPER_MODE=false when RPC key is ready.
 */

const WebSocket = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");

const { makeDecision, TRADE_WINDOW_SECONDS } = require("./edge");
const { getMarketPrices } = require("./markets");
const PaperTrader = require("./paper");

const PAPER_MODE = process.env.PAPER_MODE !== "false"; // Default: paper trading
const POLL_INTERVAL_MS = 1000;   // Poll market prices every 1 second
const DASHBOARD_PORT = process.env.PORT || 3001;

// ── State ─────────────────────────────────────────────────────────────────────
let currentPrice = null;
let windowOpenPrice = null;
let windowStartTime = null;
let currentDecision = null;
let lastDecisionTime = 0;
let tradedThisWindow = false;
let activeMarketId = null;

const paper = new PaperTrader();
const wssClients = new Set();

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString().substring(11,19)}] ${msg}`;
  console.log(line);
  fs.appendFileSync("bot.log", line + "\n");
}

// ── Dashboard WebSocket Server ─────────────────────────────────────────────
function startDashboard() {
  const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/dashboard") {
      const html = fs.readFileSync(path.join(__dirname, "dashboard.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const wss = new WebSocket.Server({ server });
  wss.on("connection", (ws) => {
    wssClients.add(ws);
    ws.on("close", () => wssClients.delete(ws));
    // Send current state immediately on connect
    broadcastState();
  });

  server.listen(DASHBOARD_PORT, () => {
    log(`📊 Dashboard: http://localhost:${DASHBOARD_PORT}`);
  });
}

function broadcastState() {
  const state = buildState();
  const msg = JSON.stringify(state);
  wssClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

function buildState() {
  const now = Date.now();
  const windowElapsed = windowStartTime ? (now - windowStartTime) / 1000 : 0;
  const secondsRemaining = Math.max(0, 300 - windowElapsed);
  const stats = paper.getStats();

  return {
    price: {
      current: currentPrice,
      windowOpen: windowOpenPrice,
      delta: currentPrice && windowOpenPrice ? currentPrice - windowOpenPrice : 0
    },
    window: {
      secondsRemaining: Math.round(secondsRemaining),
      elapsed: Math.round(windowElapsed),
      startPrice: windowOpenPrice
    },
    decision: currentDecision,
    stats,
    trades: paper.trades.slice(-20),
    mode: PAPER_MODE ? "paper" : "live",
    marketId: activeMarketId
  };
}

// ── Binance Price Feed ─────────────────────────────────────────────────────
function startPriceFeed() {
  const ws = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@trade");

  ws.on("open", () => {
    log("✅ Binance price feed connected");
    initWindow();
  });

  ws.on("message", (data) => {
    const trade = JSON.parse(data);
    currentPrice = parseFloat(trade.p);
    broadcastState();
  });

  ws.on("error", (e) => log(`❌ Binance WS error: ${e.message}`));
  ws.on("close", () => {
    log("⚠️  Binance disconnected — reconnecting in 3s...");
    setTimeout(startPriceFeed, 3000);
  });
}

// ── Window Management ──────────────────────────────────────────────────────
function initWindow() {
  const now = Date.now();
  const msInWindow = now % (5 * 60 * 1000);
  const msUntilNext = (5 * 60 * 1000) - msInWindow;
  const secondsIntoWindow = msInWindow / 1000;

  // Set window open price (approximate — we set it from current price)
  if (currentPrice && !windowOpenPrice) {
    windowOpenPrice = currentPrice;
    windowStartTime = now - msInWindow;
    log(`🕐 Window started ${secondsIntoWindow.toFixed(0)}s ago. Open: $${windowOpenPrice.toFixed(2)}`);
  }

  // Schedule next window reset
  log(`⏰ Next window in ${(msUntilNext / 1000).toFixed(0)}s`);
  setTimeout(() => resetWindow(), msUntilNext);
}

function resetWindow() {
  if (currentPrice) {
    // Settle any open paper trade at end of window
    if (paper.openTrade && windowOpenPrice) {
      const wonDirection = currentPrice >= windowOpenPrice ? "UP" : "DOWN";
      log(`\n🏁 Window closed! BTC: $${currentPrice.toFixed(2)} | Open: $${windowOpenPrice.toFixed(2)} | Winner: ${wonDirection}`);
      paper.settle(wonDirection);
    }

    windowOpenPrice = currentPrice;
    windowStartTime = Date.now();
    tradedThisWindow = false;
    currentDecision = null;

    log(`\n🕐 NEW WINDOW | Open: $${windowOpenPrice.toFixed(2)}`);
    broadcastState();
  }

  // Next reset in exactly 5 minutes
  setTimeout(() => resetWindow(), 5 * 60 * 1000);
}

// ── Strategy Loop ──────────────────────────────────────────────────────────
async function strategyLoop() {
  if (!currentPrice || !windowOpenPrice || !windowStartTime) return;

  const now = Date.now();
  const windowElapsed = (now - windowStartTime) / 1000;
  const secondsRemaining = Math.max(0, 300 - windowElapsed);
  const deltaUSD = currentPrice - windowOpenPrice;

  // Fetch live market prices from XO orderbook
  let upPrice = 0.5;
  let downPrice = 0.5;

  if (activeMarketId) {
    const prices = await getMarketPrices(activeMarketId);
    if (prices) {
      upPrice = prices.upPrice || 0.5;
      downPrice = prices.downPrice || 0.5;
    }
  }

  // Run decision engine
  const decision = makeDecision({ deltaUSD, secondsRemaining, upPrice, downPrice });
  currentDecision = decision;

  // Log decision every 5 seconds
  if (now - lastDecisionTime > 5000) {
    lastDecisionTime = now;
    const remaining = secondsRemaining.toFixed(0);
    log(`T-${remaining}s | BTC Δ$${deltaUSD.toFixed(2)} | UP=${upPrice.toFixed(3)} DN=${downPrice.toFixed(3)} | ${decision.action}: ${decision.reason}`);
  }

  // Execute if we have edge and haven't traded this window
  if (!tradedThisWindow && decision.action !== "SKIP") {
    if (secondsRemaining <= TRADE_WINDOW_SECONDS && secondsRemaining > 0) {
      tradedThisWindow = true;

      if (PAPER_MODE) {
        const price = decision.action === "BUY_UP" ? upPrice : downPrice;
        paper.buy(
          decision.action === "BUY_UP" ? "UP" : "DOWN",
          price,
          decision.edge,
          activeMarketId,
          windowOpenPrice,
          deltaUSD
        );
      } else {
        log("🔴 LIVE TRADING not yet enabled — add RPC key to activate");
      }
    }
  }

  broadcastState();
}

// ── Market Discovery Loop ──────────────────────────────────────────────────
async function marketDiscoveryLoop() {
  try {
    const { getCurrentMarket } = require("./markets");
    const market = await getCurrentMarket();
    if (market && market.condition_id !== activeMarketId) {
      activeMarketId = market.condition_id;
      log(`📍 Active market: ${activeMarketId}`);
    }
  } catch (e) {
    // Silently continue — market discovery is best-effort
  }

  setTimeout(marketDiscoveryLoop, 30000); // Refresh every 30s
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  log("🚀 XO Pulse Bot v2 starting...");
  log(`📄 Mode: ${PAPER_MODE ? "PAPER TRADING" : "LIVE TRADING"}`);

  startDashboard();
  startPriceFeed();
  marketDiscoveryLoop();

  // Run strategy loop every second
  setInterval(strategyLoop, POLL_INTERVAL_MS);

  process.on("SIGINT", () => {
    log("\n⛔ Bot stopped.");
    process.exit(0);
  });
})();
