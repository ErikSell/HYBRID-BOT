import axios from 'axios';
import crypto from 'crypto';

class BitgetFutures {
  constructor() {
    this.baseURL = 'https://api.bitget.com';
    this.symbol = 'ARBUSDT';           // Arbitrum Perpetual
    this.defaultQuantity = 10;         // Fallback Quantity
    this.leverage = 8;
    this.productType = 'USDT-FUTURES';
  }

  _getSignature(timestamp, method, endpoint, body = '') {
    const message = timestamp + method + endpoint + body;
    return crypto
      .createHmac('sha256', process.env.BITGET_API_SECRET)
      .update(message)
      .digest('base64');
  }

  async _signedRequest(method, endpoint, data = {}) {
    const timestamp = Date.now().toString();
    const body = method === 'POST' ? JSON.stringify(data) : '';
    const signature = this._getSignature(timestamp, method, endpoint, body);

    const headers = {
      'ACCESS-KEY': process.env.BITGET_API_KEY,
      'ACCESS-SIGN': signature,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': process.env.BITGET_PASSPHRASE,
      'Content-Type': 'application/json',
      'locale': 'en-US'
    };

    try {
      const response = await axios({
        method,
        url: `${this.baseURL}${endpoint}`,
        headers,
        data: method === 'POST' ? data : undefined
      });
      return response.data;
    } catch (error) {
      console.error('Bitget API Error:', error.response?.data || error.message);
      throw error;
    }
  }

  async initLeverage() {
    try {
      await this._signedRequest('POST', '/api/v2/mix/order/setLeverage', {
        symbol: this.symbol,
        productType: this.productType,
        marginMode: 'crossed',
        leverage: this.leverage.toString()
      });
      console.log(`✅ Leverage für ${this.symbol} auf ${this.leverage}x gesetzt`);
    } catch (err) {
      console.warn('Leverage setzen fehlgeschlagen:', err.message);
    }
  }

  async placeMarketOrder(signal) {
    const action = (signal.action || '').toLowerCase().trim();
    const position = (signal.position || '').toLowerCase().trim();
    let quantity = parseFloat(signal.contracts) || this.defaultQuantity;

    let side = 'buy';
    let tradeSide = 'open';

    // WICHTIG: Exit-Logik bei "flat"
    if (position === 'flat') {
      console.log('🔄 Exit-Signal erkannt (Position: flat) → Position wird geschlossen');
      tradeSide = 'close';
      
      // Bei Exit nehmen wir die Contracts aus dem Signal (das ist die aktuelle Positionsgröße)
      quantity = parseFloat(signal.contracts) || 10;
    } 
    else if (action === 'buy' || action === 'entrylong' || position === 'long') {
      side = 'buy';
      tradeSide = 'open';
    } 
    else if (action === 'sell' || action === 'entryshort' || position === 'short') {
      side = 'sell';
      tradeSide = 'open';
    } 
    else {
      console.log('❌ Unbekanntes Signal ignoriert:', signal);
      return { status: 'ignored' };
    }

    // Precision für ARBUSDT (meist 1 Dezimalstelle)
    quantity = parseFloat(quantity.toFixed(1));
    if (quantity < 1) quantity = 10;

    try {
      const orderData = {
        symbol: this.symbol,
        productType: this.productType,
        marginMode: 'crossed',
        marginCoin: 'USDT',
        side: side,
        orderType: 'market',
        size: quantity.toString(),
        tradeSide: tradeSide   // "open" oder "close"
      };

      const result = await this._signedRequest('POST', '/api/v2/mix/order/place-order', orderData);

      const actionText = position === 'flat' ? 'CLOSE' : side.toUpperCase();
      console.log(`[${new Date().toISOString()}] ✅ ${actionText} Order platziert: ${quantity} ${this.symbol} (tradeSide: ${tradeSide})`);
      console.log('Bitget Response:', JSON.stringify(result, null, 2));

      return { 
        status: 'success', 
        action: actionText, 
        quantity, 
        order: result 
      };
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Bitget Order Fehler:`, error.message || error);
      throw error;
    }
  }
}

const bitgetUtils = new BitgetFutures();
export { bitgetUtils };
export default bitgetUtils;
