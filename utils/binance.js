import Binance from 'binance';

class BinanceFutures {
  constructor() {
    this.client = new Binance({
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET,
      futures: true   // Wichtig: Futures-Modus aktivieren
    });

    this.symbol = 'XAUUSDT';
    this.defaultQuantity = 0.01;   // Sehr klein zum Testen (~20-30 USD Notional)
    this.leverage = 3;             // Starte vorsichtig mit 3x oder 1x
  }

  async initLeverage() {
    try {
      await this.client.futuresLeverage({
        symbol: this.symbol,
        leverage: this.leverage
      });
      console.log(`✅ Leverage für ${this.symbol} auf ${this.leverage}x gesetzt`);
    } catch (err) {
      console.warn(`Leverage setzen fehlgeschlagen (evtl. schon gesetzt): ${err.message}`);
    }
  }

  async placeMarketOrder(signal) {
    const action = (signal.action || '').toLowerCase();
    const position = (signal.position || '').toLowerCase();
    let quantity = parseFloat(signal.contracts) || this.defaultQuantity;

    let side = 'BUY';
    if (action.includes('sell') || position === 'short') {
      side = 'SELL';
    }

    // Quantity auf Binance-Precision bringen (XAUUSDT erlaubt meist 3 Dezimalstellen)
    quantity = parseFloat(quantity.toFixed(3));

    if (quantity < 0.001) quantity = 0.01; // Mindestgröße Sicherheit

    try {
      const order = await this.client.futuresMarketOrder({
        symbol: this.symbol,
        side: side,
        quantity: quantity
      });

      console.log(`[${new Date().toISOString()}] ✅ ${side} Market Order: ${quantity} ${this.symbol}`);
      console.log('Order Details:', order);

      return { status: 'success', side, quantity, order };
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Binance Fehler:`, error.message || error);
      throw error;
    }
  }
}

const binanceUtils = new BinanceFutures();
export { binanceUtils };
export default binanceUtils;
