import express from 'express'
import { handleSignal, hasOpenPosition } from './utils/tradelocker.js'

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

  if (position === 'buy' || position === 'sell') {
    const isOpen = await hasOpenPosition(symbol)
    if (isOpen) {
      position  = 'flat'
      skipClose = false
    } else {
      position  = position === 'buy' ? 'long' : 'short'
      skipClose = true  // Keine Position offen → kein Close nötig
    }
  }

  console.log(`[WEBHOOK] Mapped position: ${position} | Symbol: ${symbol} | skipClose: ${skipClose}`)

  // Sofort antworten
  res.json({ ok: true })

  // Rest async im Hintergrund
  handleSignal(position, symbol, skipClose).catch(err => {
    console.error('[WEBHOOK] Async Fehler:', err.message)
  })
})

// ================================
// TELEGRAM COMMANDS
// ================================
app.post('/telegram', async (req, res) => {
  const text = req.body?.message?.text || ''
  console.log('[TELEGRAM] Command:', text)
  if (text === '/d') {
    const { triggerDashboard } = await import('./utils/tradelocker.js')
    await triggerDashboard()
  }
  res.json({ ok: true })
})

// ================================
// DEBUG ROUTES
// ================================
app.get('/debug', async (req, res) => {
  try {
    const { getDebugInfo } = await import('./utils/tradelocker.js')
    res.json(await getDebugInfo())
  } catch (err) {
    res.json({ error: err.message })
  }
})

app.get('/debug-positions', async (req, res) => {
  try {
    const { getPositionDebug } = await import('./utils/tradelocker.js')
    res.json(await getPositionDebug())
  } catch (err) {
    res.json({ error: err.message })
  }
})

app.get('/debug-balance', async (req, res) => {
  try {
    const { debugBalance } = await import('./utils/tradelocker.js')
    res.json(await debugBalance())
  } catch (err) {
    res.json({ error: err.message })
  }
})

app.get('/debug-history', async (req, res) => {
  try {
    const { debugHistory } = await import('./utils/tradelocker.js')
    res.json(await debugHistory())
  } catch (err) {
    res.json({ error: err.message })
  }
})

app.get('/risk', async (req, res) => {
  try {
    const { getState } = await import('./config/risk.js')
    res.json(getState())
  } catch (err) {
    res.json({ error: err.message })
  }
})

app.listen(3000, () => console.log('[SERVER] Läuft auf Port 3000'))
