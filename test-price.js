const WebSocket = require("ws");

console.log("🧪 Testing Binance BTC/USDT price feed...");
console.log("   Press Ctrl+C to stop\n");

const ws = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@trade");

let count = 0;
let openPrice = null;

ws.on("open", () => {
  console.log("✅ Connected to Binance!\n");
});

ws.on("message", (data) => {
  const trade = JSON.parse(data);
  const price = parseFloat(trade.p);

  if (!openPrice) {
    openPrice = price;
    console.log(`📌 Open price set: $${openPrice.toFixed(2)}\n`);
  }

  count++;
  if (count % 5 === 0) {
    const delta = price - openPrice;
    const sign = delta >= 0 ? "+" : "";
    const direction = delta >= 0 ? "▲ UP" : "▼ DOWN";
    console.log(`BTC: $${price.toFixed(2)}  |  Delta: ${sign}$${delta.toFixed(2)}  |  ${direction}`);

    if (Math.abs(delta) >= 15) {
      console.log(`  🟢 Would trigger SECOND BUY`);
    } else if (Math.abs(delta) >= 5) {
      console.log(`  🟡 Would trigger FIRST BUY`);
    }
  }
});

ws.on("error", (err) => console.error("❌ Error:", err.message));
