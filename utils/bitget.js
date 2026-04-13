import axios from 'axios';
import crypto from 'crypto';

class BitgetFutures {
  constructor() {
    this.baseURL = 'https://api.bitget.com';
    this.symbol = 'XAGUSDT';           // ← Jetzt Silver Perpetual
    this.leverage = 1;                 // 1x wie gewünscht
    this.productType = 'USDT-FUTURES';
    this.marginMode = 'isolated';
    this.riskPercent = 95;             // 95% des verfügbaren USDT → fast all-in
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
    console.log(`✅ Silver (XAGUSDT) | 1x Leverage | Isolated Margin | ~95% All-in Modus`);
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
      console.log('❌ Unbekanntes Signal ignoriert');
      return { status: 'ignored' };
    }

    try {
      // Hole aktuellen USDT Balance
      const balanceRes = await this._signedRequest('GET', '/api/v2/mix/account/account?symbol=XAGUSDT&marginCoin=USDT');
      const usdtBalance = parseFloat(balanceRes.data?.available || 0);

      // Berechne Quantity basierend auf ~95% des Balances (fast all-in bei 1x)
      let quantity = (usdtBalance * this.riskPercent / 100) / 30;   // grobe Schätzung für Silver (Preis ~30$)
      quantity = Math.max(quantity, 0.1);   // Mindestgröße
      quantity = parseFloat(quantity.toFixed(2)); // Precision für XAGUSDT

      console.log(`💰 Balance: ${usdtBalance.toFixed(2)} USDT → Quantity: ${quantity} XAG`);

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
      console.log(`[${new Date().toISOString()}] ✅ ${actionText} Order (1x Isolated) platziert: ${quantity} XAG`);

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