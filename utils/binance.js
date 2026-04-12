import { USDMClient } from 'binance';

class BinanceFutures {
  constructor() {
    this.client = new USDMClient({
      api_key: process.env.BINANCE_API_KEY,
      api_secret: process.env.BINANCE_API_SECRET,
      // baseURL ist bei dieser Library automatisch fapi.binance.com für USDM
    });

    this.symbol = 'XAUUSDT';
    this.defaultQuantity = 0.01;   // Sehr klein zum Testen (~20-30 USD Notional)
    this.leverage = 3;             // Starte mit 3x – sicher!
  }

  async initLeverage() {
    try {
      await this.client.changeInitialLeverage(this.symbol, this.leverage);
      console.log(`✅ Leverage für ${this.symbol} auf ${this.leverage}x gesetzt`);
    } catch (err) {
      console.warn(`Leverage setzen fehlgeschlagen (evtl. schon gesetzt): ${err.message}`);
    }
  }

  async placeMarketOrder(signal) {
    const action = (signal.action || '').toLowerCase().trim();
    const position = (signal.position || '').toLowerCase().trim();
    let quantity = parseFloat(signal.contracts) || this.defaultQuantity;

    let side = 'BUY';

    if (action === 'buy' || action === 'entrylong' || position === 'long') {
      side = 'BUY';
    } else if (action === 'sell' || action === 'entryshort' || position === 'short') {
      side = 'SELL';
    } else {
      console.log('❌ Unbekanntes Signal ignoriert:', signal);
      return { status: 'ignored', reason: 'unknown action' };
    }

    quantity = parseFloat(quantity.toFixed(3));
    if (quantity < 0.001) quantity = 0.01;

    try {
      const order = await this.client.submitNewOrder({
        symbol: this.symbol,
        side: side,
        type: 'MARKET',
        quantity: quantity
      });

      console.log(`[${new Date().toISOString()}] ✅ ${side} Market Order platziert: ${quantity} ${this.symbol}`);
      console.log('Order Response:', JSON.stringify(order, null, 2));

      return { 
        status: 'success', 
        side, 
        quantity, 
        order 
      };
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Binance Order Fehler:`, error.message || error);
      throw error;
    }
  }
}

const binanceUtils = new BinanceFutures();
export { binanceUtils };
export default binanceUtils;
