import express from "express";
import { binanceUtils } from "./utils/binance.js";

const app = express();
app.use(express.json());

// ======================
// Haupt-Webhook für TradingView Alerts
// ======================
app.post('/webhook', async (req, res) => {
  try {
    const signal = req.body;
    console.log('📨 TradingView Signal empfangen:', JSON.stringify(signal, null, 2));

    const result = await binanceUtils.placeMarketOrder(signal);

    res.json({
      status: 'success',
      message: 'Order erfolgreich an Binance gesendet',
      result
    });
  } catch (err) {
    console.error('❌ Webhook Fehler:', err.message || err);
    res.status(500).json({
      status: 'error',
      message: err.message || 'Fehler beim Platzieren der Order'
    });
  }
});

// ======================
// Test-Route
// ======================
app.post("/test", (req, res) => {
  console.log("🧪 TEST-WEBHOOK EMPFANGEN:", req.body);
  res.json({
    status: "OK",
    message: "Test erfolgreich empfangen!",
    received: req.body
  });
});

// ======================
// Server starten
// ======================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Hybrid Bot läuft auf Port ${PORT}`);
  console.log(`📡 Webhook bereit: /webhook`);
  console.log(`🧪 Test-Route: /test`);

  // Leverage beim Start setzen
  binanceUtils.initLeverage().catch(err => {
    console.warn('⚠️ Leverage konnte nicht automatisch gesetzt werden:', err.message);
  });
});

export default app;
