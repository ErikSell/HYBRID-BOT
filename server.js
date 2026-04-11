import express from "express";
import { placeOrder } from "./utils/binance.js";
import { allowedPairs } from "./config/pairs.js";

const app = express();
app.use(express.json());

app.post("/webhook", async (req, res) => {
  try {
    const { symbol, side } = req.body;

    console.log("📩 Alert erhalten:", req.body);

    if (!allowedPairs.includes(symbol)) {
      console.log("❌ Symbol nicht erlaubt:", symbol);
      return res.json({ status: "ignored", reason: "pair not allowed" });
    }

    console.log("🚀 Sende Order an Binance...");

    const order = await placeOrder(symbol, side);

    console.log("✅ ORDER:", order.data);

    res.json({ status: "ok", order: order.data });

  } catch (err) {
    console.error("❌ ERROR:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.listen(3000, () => console.log("🚀 Bot läuft auf Port 3000"));
