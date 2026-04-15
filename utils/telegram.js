import axios from 'axios'

const TOKEN   = process.env.TELEGRAM_TOKEN
const CHAT_ID = process.env.TELEGRAM_CHAT_ID

export async function sendMessage(text) {
  if (!TOKEN || !CHAT_ID) {
    console.log('[TG] Kein Token/ChatID — Nachricht übersprungen')
    return
  }

  try {
    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      chat_id:    CHAT_ID,
      text:       text,
      parse_mode: 'HTML',
    })
    console.log('[TG] Nachricht gesendet')
  } catch (err) {
    console.error('[TG] Fehler:', err.message)
  }
}

export async function sendTradeUpdate(data) {
  const {
    action, symbol, side, lots,
    pnl, result,
    totalTrades, winrate,
    last3, riskPercent, nextLots,
    hardCap, recoveryBoost,
    tradingBalance, savingsBalance,
  } = data

  const resultEmoji = result === 'WIN' ? '✅' : '❌'
  const pnlFormatted = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`
  const last3Str = last3.map(r => r === 'WIN' ? '✅' : '❌').join(' ')

  let statusLine = ''
  if (hardCap)       statusLine = '⚠️ <b>HARD CAP AKTIV</b>'
  else if (recoveryBoost) statusLine = '🚀 <b>RECOVERY BOOST AKTIV</b>'

  const msg = `
${resultEmoji} <b>TRADE GESCHLOSSEN</b>

📊 <b>Symbol:</b> ${symbol}
📈 <b>Side:</b> ${side?.toUpperCase() || '-'}
🔢 <b>Lots:</b> ${lots}
💰 <b>P&L:</b> ${pnlFormatted}
🏆 <b>Ergebnis:</b> ${result}

━━━━━━━━━━━━━━━━━━━━
📉 <b>Letzte 3 Trades:</b> ${last3Str}
🎯 <b>Winrate:</b> ${winrate}%
⚡ <b>Risk nächster Trade:</b> ${riskPercent}%
📦 <b>Nächste Lots:</b> ${nextLots}
${statusLine}

━━━━━━━━━━━━━━━━━━━━
💼 <b>Trading Balance:</b> $${tradingBalance}
🏦 <b>Savings Balance:</b> $${savingsBalance}
📋 <b>Total Trades:</b> ${totalTrades}
`.trim()

  await sendMessage(msg)
}

export async function sendOrderNotification(action, symbol, lots, side) {
  const emoji = side === 'buy' ? '🟢' : '🔴'
  const msg = `
${emoji} <b>ORDER PLATZIERT</b>

📊 <b>Symbol:</b> ${symbol}
📈 <b>Side:</b> ${side?.toUpperCase()}
🔢 <b>Lots:</b> ${lots}
⏰ <b>Zeit:</b> ${new Date().toLocaleTimeString('de-DE')}
`.trim()

  await sendMessage(msg)
}

export async function sendErrorNotification(error, context) {
  const msg = `
⚠️ <b>BOT FEHLER</b>

📍 <b>Kontext:</b> ${context}
❌ <b>Fehler:</b> ${error}
⏰ <b>Zeit:</b> ${new Date().toLocaleTimeString('de-DE')}
`.trim()

  await sendMessage(msg)
}

export async function sendStartupNotification() {
  const msg = `
🤖 <b>BOT GESTARTET</b>

✅ TradeLocker verbunden
✅ Risk Engine geladen
✅ Webhook aktiv

⏰ ${new Date().toLocaleString('de-DE')}
`.trim()

  await sendMessage(msg)
}
