import axios from 'axios';
import crypto from 'crypto';

class BitgetFutures {
  constructor() {
    this.baseURL = 'https://api.bitget.com';
    this.symbol = 'XAGUSDT';
    this.leverage = 1;                    // Immer 1x
    this.productType = 'USDT-FUTURES';
    this.marginMode = 'isolated';
    this.riskPercent = 95;                // 95% des verfügbaren USDT einsetzen
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

  async initLeverage() {
    console.log(`✅ XAGUSDT | 1x Leverage | Isolated Margin | ~95% All-in Modus`);
  }

  async placeMarketOrder(signal) {
    const action = (signal.action || '').toLowerCase().trim();
    const position = (signal.position || '').toLowerCase().trim();

    console.log(`🔍 Signal: Action="${action}" | Position="${position}"`);

    let side = 'buy';
    let tradeSide = 'open';

    if (position === 'flat') {
      console.log('🔄 EXIT SIGNAL → versuche Position zu schließen');
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
      console.log('❌ Unbekanntes Signal');
      return { status: 'ignored' };
    }

    try {
      // Aktuellen USDT Balance holen
      const balanceRes = await this._signedRequest('GET', `/api/v2/mix/account/account?symbol=${this.symbol}&marginCoin=USDT`);
      const availableUSDT = parseFloat(balanceRes.data?.available || 30);   // Fallback 30 USDT

      // Quantity berechnen: fast all-in mit 1x Leverage
      let quantity = (availableUSDT * this.riskPercent / 100) / 74;   // Silberpreis ca. 74$
      quantity = Math.max(quantity, 0.1); 
      quantity = parseFloat(quantity.toFixed(3));   // Precision für XAGUSDT

      console.log(`💰 Verfügbar: ${availableUSDT.toFixed(2)} USDT → Kaufe ${quantity} XAG (1x Leverage)`);

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
      console.log(`[${new Date().toISOString()}] ✅ ${actionText} Order platziert: ${quantity} XAG`);

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