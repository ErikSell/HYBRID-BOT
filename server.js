import express from 'express'
import { handleSignal } from './utils/tradelocker.js'

const app = express()
app.use(express.json())

app.post('/webhook', async (req, res) => {
  console.log('[WEBHOOK] Empfangen:', req.body)
  const { position, symbol } = req.body

  if (!position) {
    return res.status(400).json({ error: 'Kein position-Feld' })
  }

  if (!symbol) {
    return res.status(400).json({ error: 'Kein symbol-Feld' })
  }

  await handleSignal(position, symbol)
  res.json({ ok: true })
})

app.get('/debug', async (req, res) => {
  try {
    const { getDebugInfo } = await import('./utils/tradelocker.js')
    const info = await getDebugInfo()
    res.json(info)
  } catch (err) {
    res.json({ error: err.message })
  }
})

app.get('/debug-positions', async (req, res) => {
  try {
    const { getPositionDebug } = await import('./utils/tradelocker.js')
    const info = await getPositionDebug()
    res.json(info)
  } catch (err) {
    res.json({ error: err.message })
  }
})

app.listen(3000, () => console.log('[SERVER] Läuft auf Port 3000'))
