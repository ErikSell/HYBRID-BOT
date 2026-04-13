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

let accessToken  = null
let accountId    = null
let accNum       = null
let instrumentId = null
let routeId      = null

// ================================
// AUTH
// ================================
async function login() {
  console.log('[TL] Logging in...')
  const res = await axios.post(`${BASE_URL}/auth/jwt/token`, {
    email:    EMAIL,
    password: PASSWORD,
    server:   SERVER,
  })
  accessToken = res.data.accessToken
  console.log('[TL] Login erfolgreich')
}

// ================================
// ACCOUNT LADEN
// ================================
async function loadAccount() {
  const res = await axios.get(`${BASE_URL}/auth/jwt/all-accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  const accounts = res.data.accounts
  if (!accounts || accounts.length === 0) {
    throw new Error('[TL] Keine Accounts gefunden')
  }

  accountId = accounts[0].id
  accNum    = accounts[0].accNum
  console.log(`[TL] Account: ${accountId} (accNum: ${accNum})`)
}

// ================================
// AUTH HEADERS
// ================================
function authHeaders() {
  return {
    Authorization: `Bearer ${accessToken}`,
    accNum:        accNum,
  }
}

// ================================
// INSTRUMENT ID LADEN
// ================================
async function loadInstrumentId() {
  const res = await axios.get(
    `${BASE_URL}/trade/accounts/${accountId}/instruments`,
    { headers: authHeaders() }
  )

  const instruments = res.data.d?.instruments || []
  const match = instruments.find(i => i.name === SYMBOL)

  if (!match) {
    const names = instruments.slice(0, 20).map(i => i.name)
    console.log('[TL] Verfügbare Instrumente (erste 20):', names)
    throw new Error(`[TL] Instrument ${SYMBOL} nicht gefunden`)
  }

  instrumentId = match.tradableInstrumentId
  routeId      = match.routes?.find(r => r.type === 'TRADE')?.id
               || match.routes?.[0]?.id
               || null

  console.log(`[TL] ${SYMBOL} → ID: ${instrumentId}, routeId: ${routeId}`)
}

// ================================
// INIT
// ================================
async function init() {
  await login()
  await loadAccount()
  await loadInstrumentId()
  console.log('[TL] Initialisierung abgeschlossen')
}

// ================================
// ORDER PLATZIEREN
// ================================
async function placeOrder(side) {
  console.log(`[TL] Order: ${side} | Lots: ${risk.lotSize}`)

  const res = await axios.post(
    `${BASE_URL}/trade/accounts/${accountId}/orders`,
    {
      tradableInstrumentId: instrumentId,
      routeId:              routeId,
      type:                 'market',
      side:                 side,
      qty:                  risk.lotSize,
      validity:             'IOC',
      price:                0,
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

  // Positionen kommen als Array von Arrays:
  // [id, instrumentId, routeId, side, qty, price, ...]
  const pos = positions[0]
  return {
    id:           pos[0],
    instrumentId: pos[1],
    routeId:      pos[2],
    side:         pos[3],
    qty:          pos[4],
    price:        pos[5],
  }
}

// ================================
// POSITION SCHLIESSEN
// ================================
async function closePosition() {
  const position = await getOpenPosition()

  if (!position) {
    console.log('[TL] Keine offene Position')
    return
  }

  console.log(`[TL] Schließe Position: ${position.id}`)

  const res = await axios.delete(
    `${BASE_URL}/trade/accounts/${accountId}/positions/${position.id}`,
    { headers: authHeaders() }
  )

  console.log(`[TL] Position geschlossen:`, res.data)
  return res.data
}

// ================================
// HAUPTFUNKTION
// ================================
export async function handleSignal(position) {
  try {
    if (!accessToken) await init()

    console.log(`[TL] Signal: ${position}`)

    if (position === 'long') {
      await closePosition()
      await placeOrder('buy')
    }
    else if (position === 'short') {
      await closePosition()
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

    if (err.response?.status === 401) {
      console.log('[TL] Token abgelaufen — neu einloggen...')
      accessToken = null
      await init()
      await handleSignal(position)
    }
  }
}

// ================================
// DEBUG
// ================================
export async function getDebugInfo() {
  if (!accessToken) await init()

  const res = await axios.get(
    `${BASE_URL}/trade/accounts/${accountId}/instruments`,
    { headers: authHeaders() }
  )

  const instruments = res.data.d?.instruments || []
  const silver = instruments.filter(i =>
    i.name?.includes('XAG') ||
    i.name?.includes('Silver') ||
    i.name?.includes('SILVER')
  )

  return {
    accountId,
    accNum,
    instrumentId,
    routeId,
    silverMatches: silver,
    totalInstruments: instruments.length,
    sample: instruments.slice(0, 10)
  }
}

export async function getPositionDebug() {
  if (!accessToken) await init()

  const res = await axios.get(
    `${BASE_URL}/trade/accounts/${accountId}/positions`,
    { headers: authHeaders() }
  )

  return res.data
}

// Beim Start initialisieren
init().catch(err => {
  console.error('[TL] Init fehlgeschlagen:', err.message)
})
