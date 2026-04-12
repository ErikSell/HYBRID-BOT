const { Spot, Futures } = require('@binance/futures-connector'); // oder binance-api-node / ccxt – je nach dem was du schon nutzt

// Falls du noch kein Futures-Client hast, sag Bescheid, ich passe es an

class BinanceUtils {
  constructor() {
    this.futuresClient = new Futures(process.env.BINANCE_API_KEY, process.env.BINANCE_API_SECRET);
    this.symbol = 'XAUUSDT';
    this.defaultQuantity = 0.01;     // Sehr klein für Test – später anpassen
    this.leverage = 5;
  }

  async setLeverage() {
    try {
      await this.futuresClient.changeInitialLeverage(this.symbol, this.leverage);
      console.log(`✅ Leverage auf ${this.leverage}x gesetzt für ${this.symbol}`);
    } catch (err) {
      console.error('Leverage Fehler:', err.message);
    }
  }

  async placeMarketOrder(signal) {
    const action = signal.action ? signal.action.toLowerCase() : '';
    const position = signal.position ? signal.position.toLowerCase() : '';
    let side = 'BUY';

    if (action === 'buy' || (position === 'long' && action.includes('buy'))) {
      side = 'BUY';
    } else if (action === 'sell' || (position === 'short' && action.includes('sell'))) {
      side = 'SELL';
    } else {
      console.log('Unbekanntes Signal ignoriert:', signal);
      return { status: 'ignored' };
    }

    const quantity = parseFloat(signal.contracts) || this.defaultQuantity;

    try {
      const order = await this.futuresClient.newOrder({
        symbol: this.symbol,
        side: side,
        type: 'MARKET',
        quantity: quantity.toFixed(3)   // Binance verlangt oft bestimmte Precision
      });

      console.log(`[${new Date().toISOString()}] ✅ ${side} Order ausgeführt: ${quantity} ${this.symbol}`);
      console.log(order);
      return { status: 'success', order };
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Binance Fehler:`, error.message || error);
      throw error;
    }
  }
}

module.exports = new BinanceUtils();
