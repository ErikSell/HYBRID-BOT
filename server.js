import express from 'express'
import { handleSignal, triggerDashboard } from './utils/tradelocker.js'

const app = express()
app.use(express.json())

// ================================
// TRADINGVIEW WEBHOOK
// ================================
app.post('/webhook', async (req, res) => {
  console.log('[WEBHOOK] Empfangen:', req.body)
  const { position, symbol } = req.body

  if (!position) return res.status(400).json({ error: 'Kein position-Feld' })
  if (!symbol)   return res.status(400).json({ error: 'Kein symbol-Feld' })

  await handleSignal(position, symbol)
  res.json({ ok: true })
})

// ================================
// TELEGRAM COMMANDS
// ================================
app.post('/telegram', async (req, res) => {
  const text = req.body?.message?.text || ''
  console.log('[TELEGRAM] Command:', text)

  if (text === '/d') {
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

app.get('/risk', async (req, res) => {
  try {
    const { getState } = await import('./config/risk.js')
    res.json(getState())
  } catch (err) {
    res.json({ error: err.message })
  }
})

app.listen(3000, () => console.log('[SERVER] Läuft auf Port 3000'))
