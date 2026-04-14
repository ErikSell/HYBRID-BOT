import axios from 'axios'
import risk from '../config/risk.js'

// ================================
// CONFIG
// ================================
const BASE_URL = 'https://demo.tradelocker.com/backend-api'
const EMAIL    = process.env.TL_EMAIL
const PASSWORD = process.env.TL_PASSWORD
const SERVER   = process.env.TL_SERVER

let accessToken  = null
let accountId    = null
let accNum       = null

// Map: symbol → { instrumentId, routeId }
// Wird beim Start mit allen 252 Instruments befüllt
const instrumentMap = new Map()

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
// ALLE INSTRUMENTE LADEN
// ================================
async function loadAllInstruments() {
  const res = await axios.get(
    `${BASE_URL}/trade/accounts/${accountId}/instruments`,
    { headers: authHeaders() }
  )

  const instruments = res.data.d?.instruments || []

  instruments.forEach(i => {
    const tradeRoute = i.routes?.find(r => r.type === 'TRADE')?.id
                    || i.routes?.[0]?.id
                    || null

    instrumentMap.set(i.name, {
      instrumentId: i.tradableInstrumentId,
      routeId:      tradeRoute,
    })
  })

  console.log(`[TL] ${instrumentMap.size} Instrumente geladen`)
}

// ================================
// INIT
// ================================
async function init() {
  await login()
  await loadAccount()
  await loadAllInstruments()
  console.log('[TL] Initialisierung abgeschlossen')
}

// ================================
// INSTRUMENT FÜR SYMBOL HOLEN
// ================================
function getInstrument(symbol) {
  const instrument = instrumentMap.get(symbol)
  if (!instrument) {
    throw new Error(`[TL] Symbol ${symbol} nicht gefunden. Verfügbar: ${[...instrumentMap.keys()].join(', ')}`)
  }
  return instrument
}

// ================================
// ORDER PLATZIEREN
// ================================
async function placeOrder(side, symbol) {
  const { instrumentId, routeId } = getInstrument(symbol)
  console.log(`[TL] Order: ${side} ${symbol} | Lots: ${risk.lotSize}`)

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
// OFFENE POSITION FÜR SYMBOL HOLEN
// ================================
async function getOpenPosition(symbol) {
  const res = await axios.get(
    `${BASE_URL}/trade/accounts/${accountId}/positions`,
    { headers: authHeaders() }
  )

  const positions = res.data.d?.positions || []
  if (positions.length === 0) return null

  // Instrument ID für dieses Symbol holen
  const { instrumentId } = getInstrument(symbol)

  // Position für dieses Symbol finden
  // Array Format: [id, instrumentId, routeId, side, qty, price, ...]
  const match = positions.find(pos => String(pos[1]) === String(instrumentId))
  if (!match) return null

  return {
    id:           match[0],
    instrumentId: match[1],
    routeId:      match[2],
    side:         match[3],
    qty:          match[4],
    price:        match[5],
  }
}

// ================================
// POSITION SCHLIESSEN
// ================================
async function closePosition(symbol) {
  const position = await getOpenPosition(symbol)

  if (!position) {
    console.log(`[TL] Keine offene Position für ${symbol}`)
    return
  }

  console.log(`[TL] Schließe Position ${position.id} für ${symbol}`)

  const res = await axios.delete(
    `${BASE_URL}/trade/positions/${position.id}`,
    {
      headers: authHeaders(),
      data: { qty: 0 }
    }
  )

  console.log(`[TL] Position geschlossen:`, res.data)
  return res.data
}

// ================================
// HAUPTFUNKTION
// ================================
export async function handleSignal(position, symbol) {
  try {
    if (!accessToken) await init()

    console.log(`[TL] Signal: ${position} | Symbol: ${symbol}`)

    if (position === 'long') {
      await closePosition(symbol)
      await placeOrder('buy', symbol)
    }
    else if (position === 'short') {
      await closePosition(symbol)
      await placeOrder('sell', symbol)
    }
    else if (position === 'flat') {
      await closePosition(symbol)
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
      await handleSignal(position, symbol)
    }
  }
}

// ================================
// DEBUG
// ================================
export async function getDebugInfo() {
  if (!accessToken) await init()

  return {
    accountId,
    accNum,
    totalInstruments: instrumentMap.size,
    instruments: [...instrumentMap.entries()].map(([name, data]) => ({
      name,
      ...data
    }))
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
