import express from 'express'
import { handleSignal } from './utils/tradelocker.js'  // ← geändert

const app = express()
app.use(express.json())

app.post('/webhook', async (req, res) => {
  console.log('[WEBHOOK] Empfangen:', req.body)
  const { position } = req.body

  if (!position) {
    return res.status(400).json({ error: 'Kein position-Feld' })
  }

  await handleSignal(position)
  res.json({ ok: true })
})

app.listen(3000, () => console.log('[SERVER] Läuft auf Port 3000'))
