const { ethers } = require("ethers");
const WebSocket = require("ws");
const config = require("./config");
const { log, logTrade, logPrice } = require("./logger");

let windowOpenPrice = null;
let currentPrice = null;
let currentPosition = null;
let positionCount = 0;
let totalInvested = 0;
let isTrading = false;
let contractReady = false;
let provider = null;
let signer = null;
let contract = null;

async function setup() {
  log("🚀 XO Market Pulse Bot starting...");
  provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL);
  signer = new ethers.Wallet(config.PRIVATE_KEY, provider);
  const network = await provider.getNetwork();
  log(`✅ Connected to: ${network.name} (chainId: ${network.chainId})`);
  log(`👛 Wallet: ${signer.address}`);

  const usdcContract = new ethers.Contract(
    config.USDC_ADDRESS,
    ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"],
    provider
  );
  const balance = await usdcContract.balanceOf(signer.address);
  const decimals = await usdcContract.decimals();
  log(`💰 USDC Balance: $${ethers.formatUnits(balance, decimals)}`);

  const addr = config.XO_CONTRACT_ADDRESS;
  if (!addr || addr.includes("PENDING") || addr.includes("YOUR_XO")) {
    log("⚠️  Contract not configured yet - price feed only mode");
  } else {
    contract = new ethers.Contract(addr, require("./abi.json"), signer);
    contractReady = true;
    log("✅ Contract loaded. Starting price feed...\n");
  }
}

function startPriceFeed() {
  const ws = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@trade");

  ws.on("open", () => {
    log("✅ Binance price feed connected.\n");
    resetWindow();
  });

  ws.on("message", (data) => {
    const trade = JSON.parse(data);
    currentPrice = parseFloat(trade.p);
    logPrice(currentPrice, windowOpenPrice);
    evaluateStrategy();
  });

  ws.on("error", (err) => log(`❌ WebSocket error: ${err.message}`));

  ws.on("close", () => {
    log("⚠️  Price feed disconnected. Reconnecting in 3s...");
    setTimeout(startPriceFeed, 3000);
  });
}

function resetWindow() {
  const now = Date.now();
  const msUntilNext = (5 * 60 * 1000) - (now % (5 * 60 * 1000));

  if (currentPrice) {
    windowOpenPrice = currentPrice;
    currentPosition = null;
    positionCount = 0;
    totalInvested = 0;
    isTrading = false;
    log(`\n🕐 New 5-min window. Open price: $${windowOpenPrice.toFixed(2)}`);
    log(`⏰ Next reset in: ${Math.round(msUntilNext / 1000)}s\n`);
  }

  setTimeout(resetWindow, msUntilNext);
}

async function evaluateStrategy() {
  if (!windowOpenPrice || !currentPrice || isTrading || !contractReady) return;

  const delta = currentPrice - windowOpenPrice;
  const absDelta = Math.abs(delta);
  const direction = delta >= 0 ? "UP" : "DOWN";

  if (currentPosition && currentPosition !== direction && absDelta < config.REVERSAL_THRESHOLD) {
    log(`🔄 REVERSAL! Price moving against ${currentPosition} position.`);
    await sellCurrentPosition();
    await buyPosition(direction, config.BET_AMOUNT_SMALL, "Reversal buy");
    return;
  }

  if (!currentPosition && absDelta >= config.THRESHOLD_FIRST_BUY) {
    log(`📈 First threshold hit! Delta: $${delta.toFixed(2)} → Buying ${direction}`);
    await buyPosition(direction, config.BET_AMOUNT_SMALL, "Initial buy");
    return;
  }

  if (currentPosition === direction && positionCount === 1 && absDelta >= config.THRESHOLD_SECOND_BUY) {
    log(`📈 Second threshold hit! Adding to ${direction}`);
    await buyPosition(direction, config.BET_AMOUNT_LARGE, "Momentum buy");
    return;
  }
}

async function buyPosition(direction, amount, reason) {
  if (isTrading) return;
  isTrading = true;
  try {
    const amountWei = ethers.parseUnits(amount.toString(), 6);
    log(`\n🟢 BUYING ${direction} | $${amount} USDC | ${reason}`);
    log(`   Price: $${currentPrice.toFixed(2)} | Delta: $${(currentPrice - windowOpenPrice).toFixed(2)}`);

    await approveUSDC(amountWei);

    const tx = await contract.buyPosition(
      direction === "UP" ? 0 : 1,
      amountWei,
      { gasLimit: config.GAS_LIMIT, maxFeePerGas: ethers.parseUnits(config.MAX_GAS_GWEI, "gwei") }
    );
    log(`   📤 TX: ${tx.hash}`);
    const receipt = await tx.wait();
    log(`   ✅ Confirmed in block ${receipt.blockNumber}`);

    currentPosition = direction;
    positionCount++;
    totalInvested += amount;
    logTrade("BUY", direction, amount, currentPrice, tx.hash);
  } catch (err) {
    log(`   ❌ Buy failed: ${err.message}`);
  } finally {
    isTrading = false;
  }
}

async function sellCurrentPosition() {
  if (isTrading || !currentPosition) return;
  isTrading = true;
  try {
    log(`\n🔴 SELLING ${currentPosition} | Price: $${currentPrice.toFixed(2)}`);
    const tx = await contract.sellPosition(
      currentPosition === "UP" ? 0 : 1,
      { gasLimit: config.GAS_LIMIT, maxFeePerGas: ethers.parseUnits(config.MAX_GAS_GWEI, "gwei") }
    );
    log(`   📤 TX: ${tx.hash}`);
    const receipt = await tx.wait();
    log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
    logTrade("SELL", currentPosition, totalInvested, currentPrice, tx.hash);
    currentPosition = null;
    positionCount = 0;
    totalInvested = 0;
  } catch (err) {
    log(`   ❌ Sell failed: ${err.message}`);
  } finally {
    isTrading = false;
  }
}

async function approveUSDC(amountWei) {
  const usdcContract = new ethers.Contract(
    config.USDC_ADDRESS,
    ["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"],
    signer
  );
  const allowance = await usdcContract.allowance(signer.address, config.XO_CONTRACT_ADDRESS);
  if (allowance < amountWei) {
    log("   🔑 Approving USDC...");
    const tx = await usdcContract.approve(config.XO_CONTRACT_ADDRESS, ethers.MaxUint256);
    await tx.wait();
    log("   ✅ USDC approved.");
  }
}

(async () => {
  try {
    await setup();
    startPriceFeed();
    process.on("SIGINT", () => {
      log("\n⛔ Bot stopped.");
      if (currentPosition) log(`⚠️  Open ${currentPosition} position — check beta.xo.market/pulse manually.`);
      process.exit(0);
    });
  } catch (err) {
    log(`💥 Fatal: ${err.message}`);
    process.exit(1);
  }
})();
