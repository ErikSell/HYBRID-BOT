import axios from 'axios'

const TOKEN   = process.env.TELEGRAM_TOKEN
const CHAT_ID = process.env.TELEGRAM_CHAT_ID
const API     = `https://api.telegram.org/bot${TOKEN}`

function getGermanTime() {
  return new Date().toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    day:      '2-digit',
    month:    '2-digit',
    year:     'numeric',
    hour:     '2-digit',
    minute:   '2-digit',
    second:   '2-digit',
  })
}

// ================================
// BASIS SEND
// ================================
export async function sendMessage(text, extra = {}) {
  if (!TOKEN || !CHAT_ID) return
  try {
    const res = await axios.post(`${API}/sendMessage`, {
      chat_id:    CHAT_ID,
      text:       text,
      parse_mode: 'HTML',
      ...extra,
    })
    console.log('[TG] Nachricht gesendet')
    return res.data?.result
  } catch (err) {
    console.error('[TG] Fehler:', err.message)
  }
}

// ================================
// CALLBACK QUERY ANTWORTEN
// Zeigt als Popup über dem Button
// ================================
export async function answerCallbackQuery(queryId, text) {
  if (!TOKEN) return
  try {
    await axios.post(`${API}/answerCallbackQuery`, {
      callback_query_id: queryId,
      text:              text,
      show_alert:        true,  // Zeigt als Modal-Popup statt kurzer Toast
    })
    console.log('[TG] Callback beantwortet')
  } catch (err) {
    console.error('[TG] Callback Fehler:', err.message)
  }
}

// ================================
// TRADE GEÖFFNET — mit PnL Button
// ================================
export async function sendOpenWithButton(symbol, side, lots, entryPrice) {
  const emoji    = side === 'buy' ? '🟢' : '🔴'
  const sideText = side === 'buy' ? 'LONG' : 'SHORT'

  const msg = `
${emoji} <b>TRADE GEÖFFNET</b>

📊 <b>Symbol:</b> ${symbol}
📈 <b>Side:</b> ${sideText}
🔢 <b>Lots:</b> ${lots}
💵 <b>Entry:</b> ${entryPrice}
⏰ ${getGermanTime()}
`.trim()

  // Inline Keyboard Button für PnL Snapshot
  const keyboard = {
    inline_keyboard: [[
      {
        text:          '📊 PnL abrufen',
        callback_data: `pnl_${symbol}`,
      }
    ]]
  }

  return await sendMessage(msg, { reply_markup: keyboard })
}

// ================================
// TRADE GESCHLOSSEN — detaillierte Übersicht
// ================================
export async function sendTradeClose(data) {
  const {
    symbol, side, lots,
    entryPrice, exitPrice,
    pnl, result,
    totalTrades, winrate,
    last3, riskPercent, nextLots,
    hardCap, recoveryBoost,
    savingsBalance,
    liveBalance,
    initialCapital,
    durationMin,
  } = data

  const resultEmoji  = result === 'WIN' ? '✅' : '❌'
  const sideText     = side === 'buy' ? 'LONG' : 'SHORT'
  const pnlFormatted = pnl >= 0
    ? `+$${pnl.toFixed(2)}`
    : `-$${Math.abs(pnl).toFixed(2)}`

  const accSize     = liveBalance ?? 0
  const totalPnl    = accSize - initialCapital
  const pnlPct      = ((totalPnl / initialCapital) * 100).toFixed(2)
  const totalPnlStr = totalPnl >= 0
    ? `+$${totalPnl.toFixed(2)} (+${pnlPct}%)`
    : `-$${Math.abs(totalPnl).toFixed(2)} (${pnlPct}%)`

  const last3Str = last3.length > 0
    ? last3.map(r => r === 'WIN' ? '✅' : '❌').join(' ')
    : '—'

  let statusLine = ''
  if (hardCap)            statusLine = '\n⚠️ <b>HARD CAP AKTIV</b>'
  else if (recoveryBoost) statusLine = '\n🚀 <b>RECOVERY BOOST AKTIV</b>'

  const durationStr = durationMin
    ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}min`
    : '—'

  const msg = `
${resultEmoji} <b>TRADE GESCHLOSSEN — ${result}</b>

📊 <b>Symbol:</b> ${symbol}
📈 <b>Side:</b> ${sideText}
🔢 <b>Lots:</b> ${lots}
💵 <b>Entry:</b> ${entryPrice ?? '—'}
🏁 <b>Exit:</b> ${exitPrice ?? '—'}
⏱ <b>Dauer:</b> ${durationStr}
💰 <b>Trade P&L:</b> ${pnlFormatted}
📉 <b>Gesamt P&L:</b> ${totalPnlStr}${statusLine}

━━━━━━━━━━━━━━━━━━━━
${last3Str} <i>Letzte 3 Trades</i>
🎯 <b>Winrate:</b> ${winrate}%
⚡ <b>Nächster Risk:</b> ${riskPercent}%
📦 <b>Nächste Lots:</b> ${nextLots}

━━━━━━━━━━━━━━━━━━━━
💼 <b>Account Size:</b> $${accSize.toFixed(2)}
🏦 <b>Savings:</b> $${savingsBalance}
📋 <b>Trades gesamt:</b> ${totalTrades}
⏰ ${getGermanTime()}
`.trim()

  await sendMessage(msg)
}

// ================================
// TRADE HISTORY — /trades Command
// ================================
export async function sendTradeHistory(trades) {
  if (!trades || trades.length === 0) {
    await sendMessage('📋 <b>Noch keine Trades aufgezeichnet.</b>')
    return
  }

  const last10 = trades.slice(-10).reverse()
  let rows = ''
  let wins = 0
  let losses = 0

  for (const t of last10) {
    const emoji = t.result === 'WIN' ? '✅' : '❌'
    const pnlStr = t.profit >= 0
      ? `+$${t.profit.toFixed(2)}`
      : `-$${Math.abs(t.profit).toFixed(2)}`
    const date = t.timestamp ? new Date(t.timestamp).toLocaleDateString('de-DE') : '—'
    rows += `${emoji} ${pnlStr} <i>${date}</i>\n`
    if (t.result === 'WIN') wins++
    else losses++
  }

  const wr = last10.length > 0 ? ((wins / last10.length) * 100).toFixed(1) : 0

  const msg = `
📋 <b>LETZTE ${last10.length} TRADES</b>

${rows}
━━━━━━━━━━━━━━━━━━━━
✅ Wins: ${wins} | ❌ Losses: ${losses}
🎯 Winrate: ${wr}%
⏰ ${getGermanTime()}
`.trim()

  await sendMessage(msg)
}

// ================================
// DASHBOARD
// ================================
export async function sendDashboard(liveBalance, initialCapital, state) {
  const balance      = liveBalance ?? state.tradingBalance
  const pnl          = balance - initialCapital
  const pnlPercent   = ((pnl / initialCapital) * 100).toFixed(2)
  const pnlFormatted = pnl >= 0
    ? `+$${pnl.toFixed(2)} <i>(+${pnlPercent}%)</i>`
    : `-$${Math.abs(pnl).toFixed(2)} <i>(${pnlPercent}%)</i>`

  const last3Str = state.last3Trades.length > 0
    ? state.last3Trades.map(r => r === 'WIN' ? '✅' : '❌').join(' ')
    : '—'

  let statusLine = ''
  if (state.hardCapActive)            statusLine = '\n⚠️ <b>HARD CAP AKTIV</b>'
  else if (state.recoveryBoostActive) statusLine = '\n🚀 <b>RECOVERY BOOST AKTIV</b>'

  const msg = `
📊 <b>ACCOUNT ÜBERSICHT</b>

💼 <b>Account Size:</b> $${balance.toFixed(2)}
📈 <b>P&L:</b> ${pnlFormatted}

━━━━━━━━━━━━━━━━━━━━
🎯 <b>Winrate:</b> ${state.totalWinrate}%
📋 <b>Trades gesamt:</b> ${state.tradeCount}
${last3Str} <i>Letzte 3 Trades</i>

⚡ <b>Aktueller Risk:</b> ${state.currentRiskPercent}%
📦 <b>Nächste Lots:</b> ${state.nextLotSize}${statusLine}

━━━━━━━━━━━━━━━━━━━━
💰 <b>Trading Balance:</b> $${state.tradingBalance}
🏦 <b>Savings Balance:</b> $${state.savingsBalance}

⏰ ${getGermanTime()}
`.trim()

  await sendMessage(msg)
}

// ================================
// STARTUP
// ================================
export async function sendStartupNotification() {
  const msg = `🤖 <b>BOT GESTARTET</b>\n\n✅ TradeLocker verbunden\n✅ Risk Engine geladen\n✅ Webhook aktiv\n\n<i>/help für alle Commands</i>\n⏰ ${getGermanTime()}`
  await sendMessage(msg)
}

// ================================
// FEHLER
// ================================
export async function sendErrorNotification(error, context) {
  const msg = `⚠️ <b>BOT FEHLER</b>\n\n📍 <b>Kontext:</b> ${context}\n❌ <b>Fehler:</b> ${error}\n⏰ ${getGermanTime()}`
  await sendMessage(msg)
}