/**
 * XO Market - Market Discovery
 * Fetches active BTC 5-min Pulse markets from the Data API
 */

const BASE_DATA_API = "https://api-mainnet.xo.market";
const BASE_ORDERBOOK_API = "https://orderbooks.xo.market";

/**
 * Fetch all markets and filter for active BTC 5-min Pulse markets
 */
async function getActiveMarkets() {
  try {
    const res = await fetch(`${BASE_DATA_API}/api/markets`);
    const data = await res.json();
    if (!data || !data.data) return [];

    // Filter for active BTC pulse markets
    const btcMarkets = data.data.filter(m =>
      m.active === true &&
      m.question &&
      m.question.toLowerCase().includes("btc") &&
      m.question.toLowerCase().includes("5")
    );

    return btcMarkets;
  } catch (err) {
    console.error("Failed to fetch markets:", err.message);
    return [];
  }
}

/**
 * Get the current active 5-min BTC market
 * Returns the market closest to resolving (most recent window)
 */
async function getCurrentMarket() {
  try {
    // Try orderbook markets endpoint first (we know this works)
    const res = await fetch(`${BASE_ORDERBOOK_API}/markets`);
    const data = await res.json();
    if (!data || !data.data) return null;

    // Get markets with actual prices (active trading)
    const activeMarkets = data.data.filter(m => {
      const tokens = m.tokens || [];
      return tokens.some(t => parseFloat(t.price) > 0 && parseFloat(t.price) < 1);
    });

    if (activeMarkets.length === 0) return null;

    // Return the most recently active market
    return activeMarkets[0];
  } catch (err) {
    console.error("Failed to fetch current market:", err.message);
    return null;
  }
}

/**
 * Get live order book for a market (Up and Down prices)
 */
async function getOrderBook(conditionId) {
  try {
    const res = await fetch(`${BASE_ORDERBOOK_API}/book?condition_id=${conditionId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Failed to fetch order book:", err.message);
    return null;
  }
}

/**
 * Get current Up and Down prices for a market
 */
async function getMarketPrices(conditionId) {
  try {
    const res = await fetch(`${BASE_ORDERBOOK_API}/markets/${conditionId}`);
    if (!res.ok) return null;
    const data = await res.json();

    // tokens[0] = Yes/Up, tokens[1] = No/Down
    const tokens = data.tokens || [];
    const upToken = tokens.find(t => t.outcome === "Yes") || tokens[0];
    const downToken = tokens.find(t => t.outcome === "No") || tokens[1];

    return {
      conditionId,
      upPrice: parseFloat(upToken?.price || 0),
      downPrice: parseFloat(downToken?.price || 0),
      upTokenId: upToken?.token_id,
      downTokenId: downToken?.token_id,
    };
  } catch (err) {
    console.error("Failed to fetch market prices:", err.message);
    return null;
  }
}

module.exports = { getActiveMarkets, getCurrentMarket, getOrderBook, getMarketPrices };
