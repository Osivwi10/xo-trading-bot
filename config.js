require("dotenv").config();

module.exports = {
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  BASE_RPC_URL: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  XO_CONTRACT_ADDRESS: process.env.XO_CONTRACT_ADDRESS || "0xYOUR_XO_CONTRACT_ADDRESS_HERE",
  USDC_ADDRESS: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  BET_AMOUNT_SMALL: parseFloat(process.env.BET_AMOUNT_SMALL) || 2,
  BET_AMOUNT_LARGE: parseFloat(process.env.BET_AMOUNT_LARGE) || 4,
  THRESHOLD_FIRST_BUY: parseFloat(process.env.THRESHOLD_FIRST_BUY) || 5,
  THRESHOLD_SECOND_BUY: parseFloat(process.env.THRESHOLD_SECOND_BUY) || 15,
  REVERSAL_THRESHOLD: parseFloat(process.env.REVERSAL_THRESHOLD) || 3,
  GAS_LIMIT: 300000,
  MAX_GAS_GWEI: "0.1",
};
