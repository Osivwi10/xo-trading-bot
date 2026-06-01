const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "trades.log");
let priceLogThrottle = 0;

function timestamp() {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

function log(message) {
  const line = `[${timestamp()}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

function logPrice(price, openPrice) {
  const now = Date.now();
  if (now - priceLogThrottle < 2000) return;
  priceLogThrottle = now;
  if (!openPrice) return;
  const delta = price - openPrice;
  const sign = delta >= 0 ? "+" : "";
  const arrow = delta >= 0 ? "▲" : "▼";
  process.stdout.write(
    `\r[${timestamp()}] BTC: $${price.toFixed(2)}  ${arrow} ${sign}$${delta.toFixed(2)} from open   `
  );
}

function logTrade(action, direction, amount, price, txHash) {
  const line = `[${timestamp()}] TRADE | ${action} ${direction} | $${amount} @ $${price.toFixed(2)} | TX: ${txHash}`;
  console.log("\n" + line);
  fs.appendFileSync(LOG_FILE, line + "\n");
  const csvFile = path.join(__dirname, "trades.csv");
  if (!fs.existsSync(csvFile)) {
    fs.writeFileSync(csvFile, "timestamp,action,direction,amount,price,tx_hash\n");
  }
  fs.appendFileSync(csvFile, `${timestamp()},${action},${direction},${amount},${price.toFixed(2)},${txHash}\n`);
}

module.exports = { log, logPrice, logTrade };
