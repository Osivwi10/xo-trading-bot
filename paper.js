/**
 * Paper Trading Engine
 * Simulates trades without real money
 * Tracks all P&L, win rate, and performance stats
 */

const fs = require("fs");
const path = require("path");

const PAPER_LOG = path.join(__dirname, "paper_trades.json");
const SHARES_PER_TRADE = 10; // Buy 10 shares per trade = $10 max risk

class PaperTrader {
  constructor() {
    this.balance = 300.00;       // Start with $300 paper money
    this.trades = [];
    this.openTrade = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(PAPER_LOG)) {
        const data = JSON.parse(fs.readFileSync(PAPER_LOG, "utf8"));
        this.balance = data.balance || 300;
        this.trades = data.trades || [];
        console.log(`📂 Loaded ${this.trades.length} paper trades. Balance: $${this.balance.toFixed(2)}`);
      }
    } catch (e) {
      console.log("📂 Starting fresh paper trading session.");
    }
  }

  save() {
    fs.writeFileSync(PAPER_LOG, JSON.stringify({
      balance: this.balance,
      trades: this.trades,
      lastUpdated: new Date().toISOString()
    }, null, 2));
  }

  /**
   * Simulate buying a position
   */
  buy(direction, price, edge, conditionId, windowStart, btcDelta) {
    if (this.openTrade) {
      console.log("⚠️  Already have an open paper trade — skipping");
      return null;
    }

    const cost = price * SHARES_PER_TRADE;

    if (cost > this.balance) {
      console.log(`⚠️  Insufficient paper balance ($${this.balance.toFixed(2)} < $${cost.toFixed(2)})`);
      return null;
    }

    this.openTrade = {
      id: Date.now(),
      direction,
      price,
      shares: SHARES_PER_TRADE,
      cost,
      edge,
      conditionId,
      windowStart,
      btcDeltaAtEntry: btcDelta,
      timestamp: new Date().toISOString(),
      status: "OPEN"
    };

    this.balance -= cost;
    console.log(`\n📄 PAPER BUY ${direction} | ${SHARES_PER_TRADE} shares @ $${price.toFixed(3)} = $${cost.toFixed(2)}`);
    console.log(`   Edge: ${(edge * 100).toFixed(1)}¢ | Balance: $${this.balance.toFixed(2)}`);

    this.save();
    return this.openTrade;
  }

  /**
   * Settle the open trade with the actual outcome
   */
  settle(wonDirection) {
    if (!this.openTrade) return null;

    const trade = this.openTrade;
    const won = trade.direction === wonDirection;
    const payout = won ? trade.shares * 1.0 : 0; // $1 per share if correct
    const fee = trade.cost * 0.015;
    const pnl = payout - trade.cost - fee;

    trade.status = won ? "WIN" : "LOSS";
    trade.outcome = wonDirection;
    trade.payout = payout;
    trade.fee = fee;
    trade.pnl = pnl;
    trade.settledAt = new Date().toISOString();

    this.balance += payout;
    this.trades.push(trade);
    this.openTrade = null;

    const emoji = won ? "✅" : "❌";
    console.log(`\n${emoji} PAPER SETTLE | ${won ? "WIN" : "LOSS"} | P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`);
    console.log(`   Balance: $${this.balance.toFixed(2)}`);

    this.save();
    return trade;
  }

  /**
   * Get performance stats
   */
  getStats() {
    const completed = this.trades.filter(t => t.status === "WIN" || t.status === "LOSS");
    const wins = completed.filter(t => t.status === "WIN");
    const totalPnl = completed.reduce((sum, t) => sum + t.pnl, 0);
    const last24h = completed.filter(t => {
      const age = Date.now() - new Date(t.settledAt).getTime();
      return age < 24 * 60 * 60 * 1000;
    });
    const wins24h = last24h.filter(t => t.status === "WIN");

    return {
      balance: this.balance,
      totalTrades: completed.length,
      wins: wins.length,
      losses: completed.length - wins.length,
      winRate: completed.length > 0 ? (wins.length / completed.length * 100).toFixed(1) : "0.0",
      totalPnl: totalPnl.toFixed(2),
      avgEdge: completed.length > 0
        ? (completed.reduce((sum, t) => sum + (t.edge || 0), 0) / completed.length * 100).toFixed(1)
        : "0.0",
      trades24h: last24h.length,
      winRate24h: last24h.length > 0 ? (wins24h.length / last24h.length * 100).toFixed(1) : "0.0",
      openTrade: this.openTrade
    };
  }
}

module.exports = PaperTrader;
