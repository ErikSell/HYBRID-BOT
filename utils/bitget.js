import axios from 'axios';
import crypto from 'crypto';

class BitgetFutures {
  constructor() {
    this.baseURL = 'https://api.bitget.com';
    this.symbol = 'XAGUSDT';
    this.fixedQuantity = 0.4;
    this.leverage = 1;
    this.productType = 'USDT-FUTURES';
  }

  _getSignature(timestamp, method, endpoint, body = '') {
    const message = timestamp + method + endpoint + body;
    return crypto.createHmac('sha256', process.env.BITGET_API_SECRET)
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

  async placeMarketOrder(signal) {
    const position = (signal.position || '').toLowerCase().trim();

    console.log(`🔍 Signal empfangen → Position: "${position}"`);

    let side = 'buy';
    let tradeSide = 'open';

    if (position === 'flat') {
      console.log('🔄 FLAT SIGNAL → versuche Position zu schließen');

      // Versuch 1: Short schließen (buy to close)
      side = 'buy';
      tradeSide = 'close';

      try {
        const orderData = {
          symbol: this.symbol,
          productType: this.productType,
          marginMode: "isolated",
          marginCoin: "USDT",
          side: side,
          orderType: "market",
          size: this.fixedQuantity.toString(),
          tradeSide: tradeSide
        };

        const result = await this._signedRequest('POST', '/api/v2/mix/order/place-order', orderData);

        console.log(`[${new Date().toISOString()}] ✅ CLOSE Order platziert (Short Exit)`);
        return { status: 'success', action: 'CLOSE', quantity: this.fixedQuantity, order: result };

      } catch (error) {
        // Wenn Short-Exit nicht klappt, versuchen wir Long-Exit (sell to close)
        console.log('Short-Exit fehlgeschlagen, versuche Long-Exit...');
        side = 'sell';
        tradeSide = 'close';

        const orderData = {
          symbol: this.symbol,
          productType: this.productType,
          marginMode: "isolated",
          marginCoin: "USDT",
          side: side,
          orderType: "market",
          size: this.fixedQuantity.toString(),
          tradeSide: tradeSide
        };

        const result = await this._signedRequest('POST', '/api/v2/mix/order/place-order', orderData);

        console.log(`[${new Date().toISOString()}] ✅ CLOSE Order platziert (Long Exit Versuch)`);
        return { status: 'success', action: 'CLOSE', quantity: this.fixedQuantity, order: result };
      }
    } 

    // Entry Logik
    else if (position === 'long') {
      side = 'buy';
      tradeSide = 'open';
      console.log('🟢 LONG Entry');
    } 
    else if (position === 'short') {
      side = 'sell';
      tradeSide = 'open';
      console.log('🔴 SHORT Entry');
    } 
    else {
      console.log('❌ Unbekanntes Signal');
      return { status: 'ignored' };
    }

    const quantity = this.fixedQuantity;

    try {
      const orderData = {
        symbol: this.symbol,
        productType: this.productType,
        marginMode: "isolated",
        marginCoin: "USDT",
        side: side,
        orderType: "market",
        size: quantity.toString(),
        tradeSide: tradeSide
      };

      const result = await this._signedRequest('POST', '/api/v2/mix/order/place-order', orderData);

      const actionText = position === 'long' ? 'LONG' : 'SHORT';
      console.log(`[${new Date().toISOString()}] ✅ ${actionText} Entry platziert: ${quantity} XAG`);

      return { status: 'success', action: actionText, quantity, order: result };
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Bitget Fehler:`, error.response?.data || error.message);
      throw error;
    }
  }
}

const bitgetUtils = new BitgetFutures();
export { bitgetUtils };
export default bitgetUtils;