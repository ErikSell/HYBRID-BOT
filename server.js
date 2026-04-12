import express from "express";
import { placeOrder } from "./utils/binance.js";
import { allowedPairs } from "./config/pairs.js";

const app = express();
app.use(express.json());

app.post('/webhook', async (req, res) => {
  try {
    const signal = req.body;
    console.log('TradingView Signal empfangen:', signal);

    const result = await binanceUtils.placeMarketOrder(signal);   // dein utils/binance.js

    res.json({ status: 'success', message: 'Order platziert', result });
  } catch (err) {
    console.error('Webhook Fehler:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(3000, () => console.log("🚀 Bot läuft auf Port 3000"));

app.post("/test", (req, res) => {
  console.log("🧪 TEST-WEBHOOK EMPFANGEN:", req.body);

  res.json({
    status: "OK",
    message: "👍 Test erfolgreich empfangen!",
    received: req.body
  });
});
