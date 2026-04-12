import express from "express";
import { bitgetUtils } from "./utils/bitget.js";

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Haupt-Webhook
app.post('/webhook', async (req, res) => {
  try {
    const signal = req.body;
    
    console.log('📨 RAW Signal empfangen:', JSON.stringify(signal, null, 2));
    console.log('📨 Signal Typ:', typeof signal);
    console.log('📨 Keys im Signal:', Object.keys(signal));

    if (!signal || Object.keys(signal).length === 0) {
      console.log('❌ Leeres Signal empfangen! TradingView schickt nichts.');
      return res.status(400).json({ status: 'error', message: 'Leeres Signal' });
    }

    const result = await bitgetUtils.placeMarketOrder(signal);

    res.json({
      status: 'success',
      message: 'Order verarbeitet',
      result
    });
  } catch (err) {
    console.error('❌ Webhook Fehler:', err.message || err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Test-Route
app.post("/test", (req, res) => {
  console.log("🧪 TEST empfangen:", JSON.stringify(req.body, null, 2));
  res.json({ status: "OK", received: req.body });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Hybrid Bot läuft auf Port ${PORT}`);
  console.log(`📡 Webhook bereit: /webhook`);
});

export default app;
