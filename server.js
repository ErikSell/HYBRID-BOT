import express from 'express'
import { handleSignal, getOpenPositionData } from './utils/tradelocker.js'

const app = express()
app.use(express.json())

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

app.post('/telegram', async (req, res) => {
  const text = req.body?.message?.text || ''
  console.log('[TELEGRAM] Command:', text)
  if (text === '/d') {
    const { triggerDashboard } = await import('./utils/tradelocker.js')
    await triggerDashboard()
  }
  res.json({ ok: true })
})

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
