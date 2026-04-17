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

// Contract sizes pro Lot pro Symbol
const CONTRACT_SIZES = {
  US100:   1,
  NAS100:  1,
  XAUUSD:  100,
  XAGUSD:  5000,
  EURUSD:  100000,
  GBPUSD:  100000,
  DEFAULT: 1,
}

let accessToken = null
let accountId   = null
let accNum      = null

const instrumentMap = new Map()

// Speichert Balance vor Trade für P&L Berechnung
let balanceBeforeTrade = null

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

export async function getOpenPositionData(symbol) {
  try {
    if (!accessToken) await init()
    const pos = await getOpenPosition(symbol)
    console.log(`[TL] getOpenPositionData(${symbol}):`, pos ? `gefunden` : 'keine')
    return pos
  } catch (err) {
    console.error('[TL] getOpenPositionData Fehler:', err.message)
    return null
  }
}

// ================================
// P&L BERECHNUNG — aus Balance Differenz
// Einfachste und zuverlässigste Methode
// ================================
async function calculatePnL(balanceBefore) {
  try {
    await new Promise(r => setTimeout(r, 1500))
    const balanceAfter = await getLiveBalance()
    if (balanceBefore === null || balanceAfter === null) return null
    const pnl = parseFloat((balanceAfter - balanceBefore).toFixed(4))
    console.log(`[TL] P&L berechnet: $${balanceBefore} → $${balanceAfter} = $${pnl}`)
    return { pnl, balanceAfter }
  } catch (err) {
    console.error('[TL] P&L Berechnung Fehler:', err.message)
    return null
  }
}

// ================================
// POSITION SCHLIESSEN
// ================================
async function closePosition(symbol, cachedPos = null) {
  const position = cachedPos ?? await getOpenPosition(symbol)

  if (!position) {
    console.log(`[TL] Keine offene Position für ${symbol}`)
    return false
  }

  // Balance VOR dem Close speichern
  const balanceBefore = await getLiveBalance()
  console.log(`[TL] Balance vor Close: $${balanceBefore}`)
  console.log(`[TL] Schließe Position ${position.id} für ${symbol}`)

  await axios.delete(
    `${BASE_URL}/trade/positions/${position.id}`,
    { headers: authHeaders(), data: { qty: 0 } }
  )

  // P&L aus Balance-Differenz berechnen
  const pnlData = await calculatePnL(balanceBefore)

  if (pnlData !== null) {
    const { pnl, balanceAfter } = pnlData
    const result = pnl >= 0 ? 'WIN' : 'LOSS'
    console.log(`[TL] Ergebnis: ${result} | P&L: $${pnl}`)
    await recordTrade(result, pnl, balanceAfter)

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
      liveBalance:    balanceAfter,
      initialCapital: INITIAL_CAPITAL,
    })
  } else {
    console.log('[TL] P&L konnte nicht berechnet werden')
    await sendErrorNotification(
      'P&L Berechnung fehlgeschlagen',
      `closePosition(${symbol})`
    )
  }

  return true
}

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
      await closePosition(symbol, cachedPos)
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
