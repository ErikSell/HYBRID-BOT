import express from 'express'
import { handleSignal, getOpenPositionData, getLivePositionPnL } from './utils/tradelocker.js'
import { answerCallbackQuery, sendMessage } from './utils/telegram.js'

const app = express()
app.use(express.json())

// ================================
// TRADINGVIEW WEBHOOK
// ================================
app.post('/webhook', async (req, res) => {
  console.log('[WEBHOOK] Empfangen:', req.body)
  let { position, symbol } = req.body

  if (!position) return res.status(400).json({ error: 'Kein position-Feld' })
  if (!symbol)   return res.status(400).json({ error: 'Kein symbol-Feld' })

  let skipClose = false
  let cachedPos = null

  if (position === 'buy' || position === 'sell') {
    cachedPos    = await getOpenPositionData(symbol)
    const isOpen = cachedPos !== null
    if (isOpen) {
      position  = 'flat'
      skipClose = false
    } else {
      position  = position === 'buy' ? 'long' : 'short'
      skipClose = true
    }
  }

  console.log(`[WEBHOOK] Mapped: ${position} | Symbol: ${symbol} | skipClose: ${skipClose}`)
  res.json({ ok: true })

  handleSignal(position, symbol, skipClose, cachedPos).catch(err => {
    console.error('[WEBHOOK] Async Fehler:', err.message)
  })
})

// ================================
// TELEGRAM COMMANDS + CALLBACKS
// ================================
app.post('/telegram', async (req, res) => {
  res.json({ ok: true })

  const body = req.body

  // Callback Query — Button gedrückt
  if (body.callback_query) {
    const query    = body.callback_query
    const data     = query.data || ''
    const queryId  = query.id
    const chatId   = query.message?.chat?.id
    const msgId    = query.message?.message_id

    console.log('[TG] Callback:', data)

    // PnL Snapshot Button: pnl_SYMBOL
    if (data.startsWith('pnl_')) {
      const symbol = data.replace('pnl_', '')
      try {
        const pnlData = await getLivePositionPnL(symbol)
        if (pnlData) {
          const pnlStr  = pnlData.pnl >= 0
            ? `+$${pnlData.pnl.toFixed(2)}`
            : `-$${Math.abs(pnlData.pnl).toFixed(2)}`
          const emoji   = pnlData.pnl >= 0 ? '🟢' : '🔴'
          const pct     = ((pnlData.pnl / pnlData.riskAmount) * 100).toFixed(1)

          await answerCallbackQuery(queryId,
            `${emoji} ${symbol} | P&L: ${pnlStr} (${pct}% des Risks) | Preis: ${pnlData.currentPrice}`
          )
        } else {
          await answerCallbackQuery(queryId, '⚠️ Keine offene Position gefunden')
        }
      } catch (err) {
        await answerCallbackQuery(queryId, '❌ Fehler beim Abrufen')
      }
      return
    }

    return
  }

  // Text Commands
  const text   = body?.message?.text || ''
  const chatId = body?.message?.chat?.id
  console.log('[TG] Command:', text)

  if (text === '/d') {
    const { triggerDashboard } = await import('./utils/tradelocker.js')
    await triggerDashboard()
  }

  if (text === '/trades') {
    const { triggerTradeHistory } = await import('./utils/tradelocker.js')
    await triggerTradeHistory()
  }

  if (text === '/help') {
    await sendMessage(`
🤖 <b>BOT COMMANDS</b>

/d — Account Dashboard
/trades — Letzte 10 Trades
/help — Diese Übersicht

<i>Während ein Trade offen ist:</i>
Drücke den <b>📊 PnL</b> Button unter der Entry-Nachricht für einen Live-Snapshot.
`.trim())
  }
})

// ================================
// DEBUG ROUTES
// ================================
app.get('/debug', async (req, res) => {
  try {
    const { getDebugInfo } = await import('./utils/tradelocker.js')
    res.json(await getDebugInfo())
  } catch (err) { res.json({ error: err.message }) }
})

app.get('/debug-positions', async (req, res) => {
  try {
    const { getPositionDebug } = await import('./utils/tradelocker.js')
    res.json(await getPositionDebug())
  } catch (err) { res.json({ error: err.message }) }
})

app.get('/debug-balance', async (req, res) => {
  try {
    const { debugBalance } = await import('./utils/tradelocker.js')
    res.json(await debugBalance())
  } catch (err) { res.json({ error: err.message }) }
})

app.get('/debug-history', async (req, res) => {
  try {
    const { debugHistory } = await import('./utils/tradelocker.js')
    res.json(await debugHistory())
  } catch (err) { res.json({ error: err.message }) }
})

app.get('/risk', async (req, res) => {
  try {
    const { getState } = await import('./config/risk.js')
    res.json(getState())
  } catch (err) { res.json({ error: err.message }) }
})

app.listen(3000, () => console.log('[SERVER] Läuft auf Port 3000'))