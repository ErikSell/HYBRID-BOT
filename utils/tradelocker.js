import axios from 'axios'
import { getLotSize, recordTrade, getState } from '../config/risk.js'

const BASE_URL = 'https://demo.tradelocker.com/backend-api'
const EMAIL    = process.env.TL_EMAIL
const PASSWORD = process.env.TL_PASSWORD
const SERVER   = process.env.TL_SERVER

let accessToken = null
let accountId   = null
let accNum      = null

const instrumentMap = new Map()

// ================================
// AUTH
// ================================
async function login() {
  console.log('[TL] Logging in...')
  const res = await axios.post(`${BASE_URL}/auth/jwt/token`, {
    email: EMAIL, password: PASSWORD, server: SERVER,
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
  if (!accounts || accounts.length === 0) throw new Error('[TL] Keine Accounts')
  accountId = accounts[0].id
  accNum    = accounts[0].accNum
  console.log(`[TL] Account: ${accountId} (accNum: ${accNum})`)
}

// ================================
// AUTH HEADERS
// ================================
function authHeaders() {
  return { Authorization: `Bearer ${accessToken}`, accNum }
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
                    || i.routes?.[0]?.id || null
    instrumentMap.set(i.name, {
      instrumentId: i.tradableInstrumentId,
      routeId:      tradeRoute,
    })
  })
  console.log(`[TL] ${instrumentMap.size} Instrumente geladen`)
}

// ================================
// LIVE BALANCE ABRUFEN
// ================================
export async function getLiveBalance() {
  try {
    const res = await axios.get(
      `${BASE_URL}/trade/accounts/${accountId}/accountDetails`,
      { headers: authHeaders() }
    )

    const fields  = res.data.d?.fields        || []
    const details = res.data.d?.accountDetails || []

    // Alle Felder loggen damit wir sehen was verfügbar ist
    console.log('[TL] AccountDetails Felder:', fields)
    console.log('[TL] AccountDetails Werte:', details)

    const balIdx = fields.indexOf('balance')
    if (balIdx === -1) {
      console.log('[TL] Balance Feld nicht gefunden — nutze equity')
      const eqIdx = fields.indexOf('equity')
      if (eqIdx !== -1) return parseFloat(details[eqIdx])
      return null
    }

    const balance = parseFloat(details[balIdx])
    console.log(`[TL] Live Balance: $${balance}`)
    return balance

  } catch (err) {
    console.error('[TL] Balance Fehler:', err.message)
    return null
  }
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
// INSTRUMENT HOLEN
// ================================
function getInstrument(symbol) {
  const instrument = instrumentMap.get(symbol)
  if (!instrument) throw new Error(`[TL] Symbol ${symbol} nicht gefunden`)
  return instrument
}

// ================================
// ORDER PLATZIEREN
// ================================
async function placeOrder(side, symbol) {
  const { instrumentId, routeId } = getInstrument(symbol)
  const lots = getLotSize()

  console.log(`[TL] Order: ${side} ${symbol} | Lots: ${lots}`)

  const res = await axios.post(
    `${BASE_URL}/trade/accounts/${accountId}/orders`,
    {
      tradableInstrumentId: instrumentId,
      routeId,
      type:     'market',
      side,
      qty:      lots,
      validity: 'IOC',
      price:    0,
    },
    { headers: authHeaders() }
  )

  console.log(`[TL] Order platziert:`, res.data)
  return res.data
}

// ================================
// OFFENE POSITION HOLEN
// ================================
async function getOpenPosition(symbol) {
  const res = await axios.get(
    `${BASE_URL}/trade/accounts/${accountId}/positions`,
    { headers: authHeaders() }
  )

  const positions = res.data.d?.positions || []
  if (positions.length === 0) return null

  const { instrumentId } = getInstrument(symbol)
  const match = positions.find(pos => String(pos[1]) === String(instrumentId))
  if (!match) return null

  return {
    id:    match[0],
    side:  match[3],
    qty:   match[4],
    price: match[5],
  }
}

// ================================
// P&L AUS HISTORY HOLEN — FIX
// ================================
async function getLastPnL(symbol) {
  try {
    const { instrumentId } = getInstrument(symbol)

    const res = await axios.get(
      `${BASE_URL}/trade/accounts/${accountId}/ordersHistory`,
      { headers: authHeaders() }
    )

    const orders  = res.data.d?.ordersHistory || []
    const fields  = res.data.d?.fields        || []

    // Alle verfügbaren Felder loggen
    console.log('[TL] OrdersHistory Felder:', fields)

    // Mögliche P&L Feldnamen probieren
    const pnlFieldNames = ['realizedPnL', 'pnl', 'profit', 'netProfit', 'closedPnL']
    let pnlIdx = -1
    for (const name of pnlFieldNames) {
      const idx = fields.indexOf(name)
      if (idx !== -1) {
        pnlIdx = idx
        console.log(`[TL] P&L Feld gefunden: "${name}" (Index ${idx})`)
        break
      }
    }

    const instrIdx = fields.indexOf('tradableInstrumentId')

    if (pnlIdx === -1) {
      console.log('[TL] Kein P&L Feld gefunden. Verfügbare Felder:', fields)
      return null
    }

    if (orders.length === 0) {
      console.log('[TL] Keine Orders in History')
      return null
    }

    // Letzten abgeschlossenen Trade für dieses Symbol finden
    const match = [...orders]
      .reverse()
      .find(o => instrIdx !== -1 ? String(o[instrIdx]) === String(instrumentId) : true)

    if (!match) {
      console.log(`[TL] Kein Trade für ${symbol} in History gefunden`)
      return null
    }

    const pnl = parseFloat(match[pnlIdx])
    console.log(`[TL] P&L gefunden: $${pnl.toFixed(4)}`)
    return pnl

  } catch (err) {
    console.error('[TL] P&L Fetch Fehler:', err.response?.data || err.message)
    return null
  }
}

// ================================
// POSITION SCHLIESSEN + TRADE AUFZEICHNEN — FIX
// ================================
async function closePosition(symbol) {
  const position = await getOpenPosition(symbol)

  if (!position) {
    console.log(`[TL] Keine offene Position für ${symbol}`)
    return false
  }

  console.log(`[TL] Schließe Position ${position.id} für ${symbol}`)

  await axios.delete(
    `${BASE_URL}/trade/positions/${position.id}`,
    { headers: authHeaders(), data: { qty: 0 } }
  )

  console.log(`[TL] Position geschlossen — warte auf History Update...`)

  // Warten damit TradeLocker History aktualisiert
  await new Promise(r => setTimeout(r, 2000))

  // P&L aus History holen
  const pnl = await getLastPnL(symbol)

  // Live Balance holen
  const liveBalance = await getLiveBalance()

  if (pnl !== null) {
    // ← FIX: strikt prüfen — nur echte positive Zahlen sind WIN
    const result = pnl > 0 ? 'WIN' : 'LOSS'
    console.log(`[TL] Trade Ergebnis: ${result} | P&L: $${pnl.toFixed(4)}`)
    recordTrade(result, pnl, liveBalance)
  } else {
    console.log('[TL] P&L konnte nicht ermittelt werden — Trade nicht aufgezeichnet')
  }

  return true
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
  const liveBalance = await getLiveBalance()
  return {
    accountId,
    accNum,
    liveBalance,
    totalInstruments: instrumentMap.size,
    riskState: getState(),
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

init().catch(err => console.error('[TL] Init fehlgeschlagen:', err.message))
