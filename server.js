import { USDMClient } from '@binance/futures-connector';

class BinanceFutures {
  constructor() {
    this.client = new USDMClient(
      process.env.BINANCE_API_KEY,
      process.env.BINANCE_API_SECRET,
      { baseURL: 'https://fapi.binance.com' }   // USDT-M Futures
    );

    this.symbol = 'XAUUSDT';
    this.defaultQuantity = 0.01;   // Sehr klein zum Testen (ca. 20-30 USD Notional bei Gold ~2500)
    this.leverage = 5;             // Ändere auf 1-3 für ersten Test
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
    const action = (signal.action || '').toLowerCase();
    const position = (signal.position || '').toLowerCase();
    const contracts = parseFloat(signal.contracts) || this.defaultQuantity;

    let side = 'BUY';

    if (action === 'buy' || action === 'entrylong' || position === 'long') {
      side = 'BUY';
    } else if (action === 'sell' || action === 'entryshort' || position === 'short') {
      side = 'SELL';
    } else {
      console.log('❌ Unbekanntes Signal ignoriert:', signal);
      return { status: 'ignored', reason: 'unknown action' };
    }

    try {
      const orderParams = {
        symbol: this.symbol,
        side: side,
        type: 'MARKET',
        quantity: contracts.toFixed(3),   // Binance Precision für XAUUSDT
      };

      const result = await this.client.newOrder(orderParams);

      console.log(`[${new Date().toISOString()}] ✅ ${side} Market Order platziert: ${contracts} ${this.symbol}`);
      console.log('Order Response:', result);

      return { status: 'success', side, quantity: contracts, order: result };
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Binance Order Fehler:`, error.message || error);
      throw error;
    }
  }
}

const binance = new BinanceFutures();
export { binance as binanceUtils };
export default binance;
