import axios from 'axios';
import crypto from 'crypto';

class BitgetFutures {
  constructor() {
    this.baseURL = 'https://api.bitget.com';
    this.symbol = 'ARBUSDT';
    this.fixedQuantity = 100;           // ≈ 10 USDT bei aktuellem Preis ~0.10$
    this.leverage = 1;
    this.productType = 'USDT-FUTURES';
    this.marginMode = 'isolated';
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
    console.log(`⚠️ Leverage auf 1x + Isolated Margin (manuell prüfen)`);
  }

  async placeMarketOrder(signal) {
    const action = (signal.action || '').toLowerCase().trim();
    const position = (signal.position || '').toLowerCase().trim();

    console.log(`🔍 Signal verarbeitet → Action: "${action}" | Position: "${position}" | Contracts from TV: ${signal.contracts}`);

    let side = 'buy';
    let tradeSide = 'open';

    if (position === 'flat') {
      console.log('🔄 EXIT SIGNAL erkannt → Position wird geschlossen');
      tradeSide = 'close';
    } 
    else if (action === 'buy' || position === 'long') {
      side = 'buy';
      tradeSide = 'open';
      console.log('🟢 LONG Signal erkannt');
    } 
    else if (action === 'sell' || position === 'short') {
      side = 'sell';
      tradeSide = 'open';
      console.log('🔴 SHORT Signal erkannt');
    } 
    else {
      console.log('❌ Unbekanntes Signal ignoriert');
      return { status: 'ignored' };
    }

    const quantity = this.fixedQuantity;   // Immer feste Größe verwenden

    try {
      const orderData = {
        symbol: this.symbol,
        productType: this.productType,
        marginMode: this.marginMode,
        marginCoin: 'USDT',
        side: side,
        orderType: 'market',
        size: quantity.toString(),
        tradeSide: tradeSide,
        leverage: this.leverage.toString()
      };

      const result = await this._signedRequest('POST', '/api/v2/mix/order/place-order', orderData);

      const actionText = position === 'flat' ? 'CLOSE' : (side === 'buy' ? 'LONG' : 'SHORT');
      console.log(`[${new Date().toISOString()}] ✅ ${actionText} Order (Isolated 1x) platziert: ${quantity} ARB`);

      return { 
        status: 'success', 
        action: actionText, 
        quantity, 
        order: result 
      };
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Bitget Order Fehler:`, error.response?.data || error.message);
      throw error;
    }
  }
}

const bitgetUtils = new BitgetFutures();
export { bitgetUtils };
export default bitgetUtils;
