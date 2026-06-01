/**
 * XO Pulse Edge Detection Engine
 * 
 * Core strategy: At T-6 seconds before window close,
 * BTC has basically already moved. Buy the near-certain
 * winner if it's still priced cheap enough to profit.
 * 
 * Edge = Fair Value - Market Price - Fees
 * Only trade if edge > MIN_EDGE_CENTS
 */

const MIN_EDGE_CENTS = 0.02;    // Minimum 2¢ edge to trade
const XO_FEE = 0.015;           // ~1.5% XO fee
const TRADE_WINDOW_SECONDS = 6; // Enter only in last 6 seconds

// Historical 1-second BTC volatility (sigma per second, in USD)
// Used to estimate remaining uncertainty in window
const BTC_1S_VOL = 8.5; // ~$8.50 per second std dev (conservative)

/**
 * Calculate probability that UP wins given current delta and time remaining
 * Uses a simplified normal distribution model
 */
function calcUpProbability(deltaUSD, secondsRemaining) {
  if (secondsRemaining <= 0) {
    // Window closed — result is final
    return deltaUSD >= 0 ? 1.0 : 0.0;
  }

  // Remaining volatility: sigma * sqrt(t)
  const remainingVol = BTC_1S_VOL * Math.sqrt(secondsRemaining);

  // z-score: how many sigmas is current delta from zero
  // P(Up wins) = P(final price >= open) = P(delta + noise >= 0)
  // = P(noise >= -delta) = Phi(delta / remainingVol)
  const z = deltaUSD / remainingVol;
  return normalCDF(z);
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun)
 */
function normalCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return z > 0 ? 1 - p : p;
}

/**
 * Calculate fair value of a share (pays $1 if correct)
 */
function fairValue(probability) {
  return probability * 1.0;
}

/**
 * Calculate edge after fees
 * edge = fairValue - marketPrice - fee
 */
function calcEdge(fairVal, marketPrice) {
  const fee = marketPrice * XO_FEE;
  return fairVal - marketPrice - fee;
}

/**
 * Main decision function
 * Returns: { action: "BUY_UP" | "BUY_DOWN" | "SKIP", edge, upProb, downProb, reason }
 */
function makeDecision(params) {
  const { deltaUSD, secondsRemaining, upPrice, downPrice } = params;

  // Only act in the last 6 seconds
  if (secondsRemaining > TRADE_WINDOW_SECONDS) {
    return {
      action: "SKIP",
      reason: `Too early — ${secondsRemaining}s remaining (enter at ${TRADE_WINDOW_SECONDS}s)`,
      upProb: null, downProb: null, edge: null
    };
  }

  if (secondsRemaining < 0) {
    return { action: "SKIP", reason: "Window closed", upProb: null, downProb: null, edge: null };
  }

  // Calculate probabilities
  const upProb = calcUpProbability(deltaUSD, secondsRemaining);
  const downProb = 1 - upProb;

  // Fair values
  const upFair = fairValue(upProb);
  const downFair = fairValue(downProb);

  // Edges
  const upEdge = calcEdge(upFair, upPrice);
  const downEdge = calcEdge(downFair, downPrice);

  // Decision
  if (upEdge > MIN_EDGE_CENTS && upEdge >= downEdge) {
    return {
      action: "BUY_UP",
      edge: upEdge,
      upProb, downProb,
      fairValue: upFair,
      marketPrice: upPrice,
      reason: `UP edge ${(upEdge * 100).toFixed(1)}¢ | P(up)=${(upProb * 100).toFixed(1)}% | market=${upPrice.toFixed(3)}`
    };
  }

  if (downEdge > MIN_EDGE_CENTS) {
    return {
      action: "BUY_DOWN",
      edge: downEdge,
      upProb, downProb,
      fairValue: downFair,
      marketPrice: downPrice,
      reason: `DOWN edge ${(downEdge * 100).toFixed(1)}¢ | P(down)=${(downProb * 100).toFixed(1)}% | market=${downPrice.toFixed(3)}`
    };
  }

  return {
    action: "SKIP",
    edge: Math.max(upEdge, downEdge),
    upProb, downProb,
    reason: `No edge — best is ${(Math.max(upEdge, downEdge) * 100).toFixed(1)}¢ (need ${MIN_EDGE_CENTS * 100}¢)`
  };
}

module.exports = { makeDecision, calcUpProbability, normalCDF, MIN_EDGE_CENTS, TRADE_WINDOW_SECONDS };
