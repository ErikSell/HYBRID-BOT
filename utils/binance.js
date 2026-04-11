import axios from "axios";
import CryptoJS from "crypto-js";
import { riskConfig } from "../config/risk.js";

const API_KEY = process.env.BINANCE_KEY;
const API_SECRET = process.env.BINANCE_SECRET;

const BASE_URL = "https://fapi.binance.com";

// Sign Query
function sign(query) {
  return CryptoJS.HmacSHA256(query, API_SECRET).toString();
}

// Get account balance
export async function getBalance() {
  const timestamp = Date.now();
  const query = `timestamp=${timestamp}`;
  const signature = sign(query);

  const url = `${BASE_URL}/fapi/v2/balance?${query}&signature=${signature}`;

  const res = await axios.get(url, {
    headers: { "X-MBX-APIKEY": API_KEY }
  });

  const usdt = res.data.find(a => a.asset === "USDT");
  return parseFloat(usdt.balance);
}

// Calculate position size
export async function calculateQty(price) {
  const balance = await getBalance();
  const margin = balance * (riskConfig.marginPercent / 100);

  const qty = margin / price;
  return Number(qty.toFixed(3));
}

// Place market order
export async function placeOrder(symbol, side) {
  const priceRes = await axios.get(
    `${BASE_URL}/fapi/v1/ticker/price?symbol=${symbol}`
  );

  const price = parseFloat(priceRes.data.price);
  const qty = await calculateQty(price);

  const timestamp = Date.now();
  const query = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${qty}&timestamp=${timestamp}`;
  const signature = sign(query);

  const url = `${BASE_URL}/fapi/v1/order?${query}&signature=${signature}`;

  return axios.post(url, {}, {
    headers: { "X-MBX-APIKEY": API_KEY }
  });
}
