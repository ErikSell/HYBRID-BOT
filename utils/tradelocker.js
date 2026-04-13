import axios from 'axios'
import risk from '../config/risk.js'

// ================================
// CONFIG
// ================================
const BASE_URL = 'https://demo.tradelocker.com/backend-api'
const EMAIL    = process.env.TL_EMAIL
const PASSWORD = process.env.TL_PASSWORD
const SERVER   = process.env.TL_SERVER
const SYMBOL   = 'XAGUSD'

// Token-Cache — wird nach Login befüllt
let accessToken  = null
let accountId    = null
let accNum       = null
let instrumentId = null

// ================================
// AUTH — JWT Token holen
// ================================
async function login() {
  console.log('[TL] Logging in...')
  const res = await axios.post(`${BASE_URL}/auth/jwt/token`, {
    email:    EMAIL,
    password: PASSWORD,
    server:   SERVER,
  })

  accessToken = res.data.accessToken
  console.log('[TL] Login successful')
}

// ================================
// ACCOUNT ID holen
// ================================
async function loadAccount() {
  const res = await axios.get(`${BASE_URL}/auth/jwt/all-accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  const accounts = res.data.accounts
  if (!accounts || accounts.length === 0) {
    throw new Error('[TL] Keine Accounts gefunden')
  }

  // Ersten Account nehmen
  accountId = accounts[0].id
  accNum    = 1
  console.log(`[TL] Account geladen: ${accountId} (accNum: ${accNum})`)
}

// ================================
// INSTRUMENT ID für XAGUSD holen
// ================================
async function loadInstrumentId() {
  const res = await axios.get(`${BASE_URL}/trade/instruments`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      accNum: accNum,
    }
  })

  const instruments = res.data.d?.instruments || []
  const match = instruments.find(i => i.name === SYMBOL)

  if (!match) {
    throw new Error(`[TL] Instrument ${SYMBOL} nicht gefunden`)
  }

  instrumentId = match.tradableInstrumentId
  console.log(`[TL] Instrument ID für ${SYMBOL}: ${instrumentId}`)
}

// ================================
// INIT — einmal beim Start aufrufen
// ================================
async function init() {
  await login()
  await loadAccount()
  await loadInstrumentId()
  console.log('[TL] Initialisierung abgeschlossen')
}

// ================================
// HILFSFUNKTION — Auth Header
// ================================
function authHeaders() {
  return {
    Authorization: `Bearer ${accessToken}`,
    accNum: accNum,
  }
}

// ================================
// ORDER PLATZIEREN
// ================================
async function placeOrder(side) {
  console.log(`[TL] Platziere Order: ${side} | Lots: ${risk.lotSize}`)

  const res = await axios.post(
    `${BASE_URL}/trade/accounts/${accountId}/orders`,
    {
      tradableInstrumentId: instrumentId,
      type:       'market',
      side:       side,        // 'buy' oder 'sell'
      qty:        risk.lotSize,
      validity:   'IOC',       // Market Orders müssen IOC sein
      price:      0,           // 0 bei Market Orders
    },
    { headers: authHeaders() }
  )

  console.log(`[TL] Order platziert:`, res.data)
  return res.data
}

// ================================
// OFFENE POSITION HOLEN
// ================================
async function getOpenPosition() {
  const res = await axios.get(
    `${BASE_URL}/trade/accounts/${accountId}/positions`,
    { headers: authHeaders() }
  )

  const positions = res.data.d?.positions || []
  if (positions.length === 0) return null

  // Erste offene Position zurückgeben
  return positions[0]
}

// ================================
// POSITION SCHLIESSEN
// ================================
async function closePosition() {
  const position = await getOpenPosition()

  if (!position) {
    console.log('[TL] Keine offene Position zum Schließen')
    return
  }

  const positionId = position.id
  const closeSide  = position.side === 'buy' ? 'sell' : 'buy'

  console.log(`[TL] Schließe Position ${positionId} mit ${closeSide}`)

  const res = await axios.delete(
    `${BASE_URL}/trade/accounts/${accountId}/positions/${positionId}`,
    { headers: authHeaders() }
  )

  console.log(`[TL] Position geschlossen:`, res.data)
  return res.data
}

// ================================
// HAUPTFUNKTION — vom Webhook aufgerufen
// ================================
export async function handleSignal(position) {
  try {
    // Token könnte abgelaufen sein → neu einloggen
    if (!accessToken) {
      await init()
    }

    console.log(`[TL] Signal empfangen: ${position}`)

    if (position === 'long') {
      await closePosition()  // Eventuell offene Short schließen
      await placeOrder('buy')
    }

    else if (position === 'short') {
      await closePosition()  // Eventuell offene Long schließen
      await placeOrder('sell')
    }

    else if (position === 'flat') {
      await closePosition()
    }

    else {
      console.log(`[TL] Unbekanntes Signal: ${position}`)
    }

  } catch (err) {
    console.error('[TL] Fehler:', err.response?.data || err.message)

    // Bei Auth-Fehler → neu einloggen und nochmal versuchen
    if (err.response?.status === 401) {
      console.log('[TL] Token abgelaufen — neu einloggen...')
      accessToken = null
      await init()
      await handleSignal(position) // Retry
    }
  }
}

// Beim Start direkt initialisieren
init().catch(err => {
  console.error('[TL] Init fehlgeschlagen:', err.message)
})
