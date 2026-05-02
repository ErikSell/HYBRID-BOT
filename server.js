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
  let { position, symbol, qty } = req.body

  if (!position) return res.status(400).json({ error: 'Kein position-Feld' })
  if (!symbol)   return res.status(400).json({ error: 'Kein symbol-Feld' })

  // qty → Lots: 1.00 qty = 0.20 Lots (US30)
  // Immer auf 2 Stellen ABSCHNEIDEN (nicht runden), Minimum 0.01
  let lots = 0.01
  if (qty && parseFloat(qty) > 0) {
    const raw     = (parseFloat(qty) / 1.00) * 0.20
    const floored = Math.floor(raw * 100) / 100
    lots          = Math.max(0.01, floored)
  }
  console.log(`[WEBHOOK] qty: ${qty} → Lots: ${lots}`)

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

  console.log(`[WEBHOOK] Mapped: ${position} | Symbol: ${symbol} | Lots: ${lots} | skipClose: ${skipClose}`)
  res.json({ ok: true })

  handleSignal(position, symbol, skipClose, cachedPos, lots).catch(err => {
    console.error('[WEBHOOK] Async Fehler:', err.message)
  })
})

// ================================
// TELEGRAM COMMANDS + CALLBACKS
// ================================
app.post('/telegram', async (req, res) => {
  res.json({ ok: true })

  const body = req.body

  if (body.callback_query) {
    const query   = body.callback_query
    const data    = query.data || ''
    const queryId = query.id

    console.log('[TG] Callback:', data)

    if (data.startsWith('pnl_')) {
      const symbol = data.replace('pnl_', '')
      try {
        const pnlData = await getLivePositionPnL(symbol)
        if (pnlData) {
          const pnlStr = pnlData.pnl >= 0
            ? `+$${pnlData.pnl.toFixed(2)}`
            : `-$${Math.abs(pnlData.pnl).toFixed(2)}`
          const emoji = pnlData.pnl >= 0 ? '🟢' : '🔴'
          const dur   = pnlData.durationMin !== null
            ? `${Math.floor(pnlData.durationMin / 60)}h ${pnlData.durationMin % 60}min`
            : '—'
          await answerCallbackQuery(queryId,
            `${emoji} ${symbol} | P&L: ${pnlStr} | Preis: ${pnlData.currentPrice} | Dauer: ${dur}`
          )
        } else {
          await answerCallbackQuery(queryId, '⚠️ Keine offene Position gefunden')
        }
      } catch (err) {
        await answerCallbackQuery(queryId, '❌ Fehler beim Abrufen')
      }
    }
    return
  }

  const text = body?.message?.text || ''
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
Drücke den <b>📊 PnL</b> Button für einen Live-Snapshot.
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

app.get('/debug-pnl', async (req, res) => {
  try {
    const { debugRawPositions } = await import('./utils/tradelocker.js')
    res.json(await debugRawPositions())
  } catch (err) { res.json({ error: err.message }) }
})
