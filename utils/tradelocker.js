import axios from 'axios'
import { getLotSize, recordTrade, getState, loadState } from '../config/risk.js'
import {
  sendOpenNotification,
  sendTradeUpdate,
  sendDashboard,
  sendErrorNotification,
  sendStartupNotification,
} from './telegram.js'

const BASE_URL        = 'https://demo.tradelocker.com/backend-api'
const EMAIL           = process.env.TL_EMAIL
const PASSWORD        = process.env.TL_PASSWORD
const SERVER          = process.env.TL_SERVER
const INITIAL_CAPITAL = parseFloat(process.env.INITIAL_CAPITAL || '5000')

let accessToken = null
let accountId   = null
let accNum      = null

const instrumentMap = new Map()

async function login() {
  console.log('[TL] Logging in...')
  const res = await axios.post(`${BASE_URL}/auth/jwt/token`, {
    email: EMAIL, password: PASSWORD, server: SERVER,
  })
  accessToken = res.data.accessToken
  console.log('[TL] Login erfolgreich')
}

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

function authHeaders() {
  return { Authorization: `Bearer ${accessToken}`, accNum }
}

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

export async function getLiveBalance() {
  try {
    const res = await axios.get(`${BASE_URL}/auth/jwt/all-accounts`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    const accounts = res.data.accounts || []
    const account  = accounts.find(a => a.id === String(accountId)) || accounts[0]
    if (!account) return null
    const balance = parseFloat(account.accountBalance)
    console.log(`[TL] Live Balance: $${balance}`)
    return balance
  } catch (err) {
    console.error('[TL] Balance Fehler:', err.message)
    return null
  }
}

async function init() {
  await login()
  await loadAccount()
  await loadAllInstruments()
  await loadState()
  console.log('[TL] Initialisierung abgeschlossen')
  await sendStartupNotification()
}

function getInstrument(symbol) {
  const instrument = instrumentMap.get(symbol)
  if (!instrument) throw new Error(`[TL] Symbol ${symbol} nicht gefunden`)
  return instrument
}

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
  await sendOpenNotification(symbol, side, lots)
  return res.data
}

// ================================
// POSITION HOLEN — intern + export
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

// Export für server.js — einmalige Abfrage die gecacht wird
export async function getOpenPositionData(symbol) {
  try {
    if (!accessToken) await init()
    const pos = await getOpenPosition(symbol)
    console.log(`[TL] getOpenPositionData(${symbol}):`, pos ? `gefunden (${pos.id})` : 'keine')
    return pos
  } catch (err) {
    console.error('[TL] getOpenPositionData Fehler:', err.message)
    return null
  }
}

async function getLastPnL(symbol) {
  try {
    const { instrumentId } = getInstrument(symbol)
    const res = await axios.get(
      `${BASE_URL}/trade/accounts/${accountId}/ordersHistory`,
      { headers: authHeaders() }
    )

    const orders   = res.data.d?.ordersHistory || []
    const fields   = res.data.d?.fields        || []
    console.log('[TL] OrdersHistory Felder:', fields)

    const pnlNames = ['realizedPnL', 'pnl', 'profit', 'netProfit', 'closedPnL']
    let pnlIdx = -1
    for (const name of pnlNames) {
      const idx = fields.indexOf(name)
      if (idx !== -1) { pnlIdx = idx; break }
    }

    const instrIdx = fields.indexOf('tradableInstrumentId')
    if (pnlIdx === -1 || orders.length === 0) return null

    const match = [...orders]
      .reverse()
      .find(o => instrIdx !== -1
        ? String(o[instrIdx]) === String(instrumentId)
        : true)

    if (!match) return null

    const pnl = parseFloat(match[pnlIdx])
    console.log(`[TL] P&L: $${pnl.toFixed(4)}`)
    return pnl
  } catch (err) {
    console.error('[TL] P&L Fehler:', err.message)
    return null
  }
}

// ================================
// POSITION SCHLIESSEN — cachedPos optional
// ================================
async function closePosition(symbol, cachedPos = null) {
  // Gecachte Position nutzen wenn vorhanden — spart API Call
  const position = cachedPos ?? await getOpenPosition(symbol)

  if (!position) {
    console.log(`[TL] Keine offene Position für ${symbol}`)
    return false
  }

  console.log(`[TL] Schließe Position ${position.id} für ${symbol}`)

  await axios.delete(
    `${BASE_URL}/trade/positions/${position.id}`,
    { headers: authHeaders(), data: { qty: 0 } }
  )

  await new Promise(r => setTimeout(r, 2000))

  const pnl         = await getLastPnL(symbol)
  const liveBalance = await getLiveBalance()

  if (pnl !== null) {
    const result = pnl > 0 ? 'WIN' : 'LOSS'
    console.log(`[TL] Ergebnis: ${result} | P&L: $${pnl.toFixed(4)}`)
    await recordTrade(result, pnl, liveBalance)

    const s = getState()
    await sendTradeUpdate({
      symbol,
      side:           position.side,
      lots:           position.qty,
      pnl,
      result,
      totalTrades:    s.tradeCount,
      winrate:        s.totalWinrate,
      last3:          s.last3Trades,
      riskPercent:    s.currentRiskPercent,
      nextLots:       s.nextLotSize,
      hardCap:        s.hardCapActive,
      recoveryBoost:  s.recoveryBoostActive,
      tradingBalance: s.tradingBalance,
      savingsBalance: s.savingsBalance,
    })
  } else {
    console.log('[TL] P&L nicht verfügbar')
    await sendErrorNotification(
      'P&L konnte nicht ermittelt werden',
      `closePosition(${symbol})`
    )
  }

  return true
}

// ================================
// HAUPTFUNKTION — cachedPos weitergegeben
// ================================
export async function handleSignal(position, symbol, skipClose = false, cachedPos = null) {
  try {
    if (!accessToken) await init()

    console.log(`[TL] Signal: ${position} | Symbol: ${symbol} | skipClose: ${skipClose}`)

    if (position === 'long') {
      if (!skipClose) await closePosition(symbol, cachedPos)
      await placeOrder('buy', symbol)
    }
    else if (position === 'short') {
      if (!skipClose) await closePosition(symbol, cachedPos)
      await placeOrder('sell', symbol)
    }
    else if (position === 'flat') {
      await closePosition(symbol, cachedPos)  // cachedPos direkt nutzen
    }
    else {
      console.log(`[TL] Unbekanntes Signal: ${position}`)
    }

  } catch (err) {
    console.error('[TL] Fehler:', err.response?.data || err.message)
    await sendErrorNotification(err.message, `handleSignal(${position}, ${symbol})`)
    if (err.response?.status === 401) {
      accessToken = null
      await init()
      await handleSignal(position, symbol, skipClose, cachedPos)
    }
  }
}

export async function triggerDashboard() {
  if (!accessToken) await init()
  const liveBalance = await getLiveBalance()
  const state       = getState()
  await sendDashboard(liveBalance, INITIAL_CAPITAL, state)
}

export async function debugBalance() {
  if (!accessToken) await init()
  const results   = {}
  const endpoints = [
    `/trade/accounts/${accountId}/accountDetails`,
    `/trade/accounts/${accountId}`,
    `/trade/accounts/${accountId}/summary`,
    `/auth/jwt/all-accounts`,
  ]
  for (const ep of endpoints) {
    try {
      const res = await axios.get(`${BASE_URL}${ep}`, { headers: authHeaders() })
      results[ep] = res.data
    } catch (err) {
      results[ep] = { error: err.message, status: err.response?.status }
    }
  }
  return results
}

export async function debugHistory() {
  if (!accessToken) await init()
  const res = await axios.get(
    `${BASE_URL}/trade/accounts/${accountId}/ordersHistory`,
    { headers: authHeaders() }
  )
  return res.data
}

export async function getDebugInfo() {
  if (!accessToken) await init()
  const liveBalance = await getLiveBalance()
  return {
    accountId,
    accNum,
    liveBalance,
    totalInstruments: instrumentMap.size,
    riskState:        getState(),
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

init().catch(async err => {
  console.error('[TL] Init fehlgeschlagen:', err.message)
  await sendErrorNotification(err.message, 'init()')
})