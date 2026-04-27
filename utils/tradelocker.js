import axios from 'axios'
import { getLotSize, recordTrade, getState, loadState } from '../config/risk.js'
import {
  sendOpenWithButton,
  sendTradeClose,
  sendTradeHistory,
  sendDashboard,
  sendErrorNotification,
  sendStartupNotification,
} from './telegram.js'

const BASE_URL        = 'https://demo.tradelocker.com/backend-api'
const EMAIL           = process.env.TL_EMAIL
const PASSWORD        = process.env.TL_PASSWORD
const SERVER          = process.env.TL_SERVER
const INITIAL_CAPITAL = parseFloat(process.env.INITIAL_CAPITAL || '5000')

const CONTRACT_SIZES = {
  US100:   1, NAS100: 1,
  US500:   1, SPX500: 1,
  US30:    1, DJ30:   1,
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
const activeTrades  = new Map()

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

// ================================
// LIVE BALANCE
// ================================
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

// ================================
// INIT
// ================================
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

  await new Promise(r => setTimeout(r, 1000))
  const openPos       = await getOpenPosition(symbol)
  const entryPrice    = openPos?.price ? parseFloat(openPos.price) : null
  const balanceAtOpen = await getLiveBalance()

  activeTrades.set(symbol, {
    entryPrice,
    side,
    lots,
    openTime:     Date.now(),
    contractSize: CONTRACT_SIZES[symbol] || CONTRACT_SIZES.DEFAULT,
    riskAmount:   INITIAL_CAPITAL * 0.02,
    balanceAtOpen,
  })

  await sendOpenWithButton(symbol, side, lots, entryPrice ?? '—')
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

export async function getOpenPositionData(symbol) {
  try {
    if (!accessToken) await init()
    const pos = await getOpenPosition(symbol)
    console.log(`[TL] getOpenPositionData(${symbol}):`, pos ? 'gefunden' : 'keine')
    return pos
  } catch (err) {
    console.error('[TL] getOpenPositionData Fehler:', err.message)
    return null
  }
}

// ================================
// LIVE PNL SNAPSHOT
// ================================
export async function getLivePositionPnL(symbol) {
  try {
    if (!accessToken) await init()

    const position = await getOpenPosition(symbol)
    if (!position) return null

    const tradeInfo    = activeTrades.get(symbol)
    const entryPrice   = tradeInfo?.entryPrice ?? parseFloat(position.price)
    const lots         = parseFloat(position.qty)
    const side         = position.side
    const contractSize = CONTRACT_SIZES[symbol] || CONTRACT_SIZES.DEFAULT
    const durationMin  = tradeInfo
      ? Math.round((Date.now() - tradeInfo.openTime) / 60000)
      : null

    let currentPrice = entryPrice
    let gotPrice     = false

    try {
      const { instrumentId } = getInstrument(symbol)
      const depthRes = await axios.get(
        `${BASE_URL}/trade/accounts/${accountId}/instruments/${instrumentId}/depth`,
        { headers: authHeaders() }
      )
      const bid = depthRes.data?.d?.bids?.[0]?.[0]
      const ask = depthRes.data?.d?.asks?.[0]?.[0]
      if (bid && ask) {
        currentPrice = side === 'buy' ? parseFloat(bid) : parseFloat(ask)
        gotPrice     = true
      }
    } catch {
      // Depth nicht verfügbar
    }

    if (gotPrice) {
      const priceDiff = side === 'buy'
        ? currentPrice - entryPrice
        : entryPrice - currentPrice
      const pnl = priceDiff * lots * contractSize
      return {
        pnl:          parseFloat(pnl.toFixed(2)),
        currentPrice: parseFloat(currentPrice.toFixed(2)),
        entryPrice,   side, lots,
        riskAmount:   tradeInfo?.riskAmount ?? 0,
        durationMin,
      }
    }

    // Fallback: Balance-Differenz
    if (tradeInfo?.balanceAtOpen) {
      const balanceNow = await getLiveBalance()
      if (balanceNow !== null) {
        const pnl = parseFloat((balanceNow - tradeInfo.balanceAtOpen).toFixed(2))
        return {
          pnl,
          currentPrice: 'N/A',
          entryPrice,   side, lots,
          riskAmount:   tradeInfo?.riskAmount ?? 0,
          durationMin,
        }
      }
    }

    return null
  } catch (err) {
    console.error('[TL] PnL Snapshot Fehler:', err.message)
    return null
  }
}

// ================================
// P&L AUS BALANCE DIFFERENZ
// ================================
async function calculatePnL(balanceBefore) {
  try {
    await new Promise(r => setTimeout(r, 1500))
    const balanceAfter = await getLiveBalance()
    if (balanceBefore === null || balanceAfter === null) return null
    const pnl = parseFloat((balanceAfter - balanceBefore).toFixed(4))
    console.log(`[TL] P&L: $${balanceBefore} → $${balanceAfter} = $${pnl}`)
    return { pnl, balanceAfter }
  } catch (err) {
    console.error('[TL] P&L Fehler:', err.message)
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

  const balanceBefore = await getLiveBalance()
  const tradeInfo     = activeTrades.get(symbol)
  const durationMin   = tradeInfo
    ? Math.round((Date.now() - tradeInfo.openTime) / 60000)
    : null

  console.log(`[TL] Balance vor Close: $${balanceBefore}`)
  console.log(`[TL] Schließe Position ${position.id} für ${symbol}`)

  await axios.delete(
    `${BASE_URL}/trade/positions/${position.id}`,
    { headers: authHeaders(), data: { qty: 0 } }
  )

  const pnlData = await calculatePnL(balanceBefore)

  if (pnlData !== null) {
    const { pnl, balanceAfter } = pnlData
    const result = pnl >= 0 ? 'WIN' : 'LOSS'
    console.log(`[TL] Ergebnis: ${result} | P&L: $${pnl}`)
    await recordTrade(result, pnl, balanceAfter)

    const s = getState()
    await sendTradeClose({
      symbol,
      side:           tradeInfo?.side       ?? position.side,
      lots:           tradeInfo?.lots       ?? position.qty,
      entryPrice:     tradeInfo?.entryPrice ?? '—',
      exitPrice:      balanceAfter?.toFixed(2) ?? '—',
      pnl,
      result,
      durationMin,
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

    activeTrades.delete(symbol)
  } else {
    console.log('[TL] P&L nicht verfügbar')
    await sendErrorNotification('P&L Berechnung fehlgeschlagen', `closePosition(${symbol})`)
  }

  return true
}

// ================================
// HAUPTFUNKTION
// FIX 1: cachedPos vom Webhook nutzen — kein extra API Call
// FIX 2: Nach Re-Login immer skipClose=false + cachedPos=null
// FIX 3: 429 Rate Limit Handler mit 3s Retry
// ================================
export async function handleSignal(position, symbol, skipClose = false, cachedPos = null) {
  try {
    if (!accessToken) await init()

    console.log(`[TL] Signal: ${position} | Symbol: ${symbol} | skipClose: ${skipClose}`)

    if (position === 'long') {
      // Cache nutzen wenn vorhanden, sonst nur abfragen wenn nötig
      const existing = cachedPos ?? (skipClose ? null : await getOpenPosition(symbol))
      if (existing) {
        console.log(`[TL] Bestehende Position gefunden — schließe zuerst`)
        await closePosition(symbol, existing)
      }
      await placeOrder('buy', symbol)
    }
    else if (position === 'short') {
      const existing = cachedPos ?? (skipClose ? null : await getOpenPosition(symbol))
      if (existing) {
        console.log(`[TL] Bestehende Position gefunden — schließe zuerst`)
        await closePosition(symbol, existing)
      }
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

    // 401 — Token abgelaufen → Re-Login + Retry mit frischem State
    if (err.response?.status === 401) {
      console.log('[TL] Token abgelaufen — neu einloggen...')
      accessToken = null
      await init()
      await handleSignal(position, symbol, false, null)
      return
    }

    // 429 — Rate Limit → 3 Sekunden warten + Retry
    if (err.response?.status === 429) {
      console.log('[TL] Rate limit — warte 3 Sekunden...')
      await new Promise(r => setTimeout(r, 3000))
      await handleSignal(position, symbol, skipClose, cachedPos)
      return
    }
  }
}

// ================================
// DASHBOARD
// ================================
export async function triggerDashboard() {
  if (!accessToken) await init()
  const liveBalance = await getLiveBalance()
  const state       = getState()
  await sendDashboard(liveBalance, INITIAL_CAPITAL, state)
}

// ================================
// TRADE HISTORY
// ================================
export async function triggerTradeHistory() {
  if (!accessToken) await init()
  const { last10Trades } = getState()
  await sendTradeHistory(last10Trades)
}

// ================================
// DEBUG
// ================================
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
    accountId, accNum, liveBalance,
    totalInstruments: instrumentMap.size,
    riskState:    getState(),
    activeTrades: Object.fromEntries(activeTrades),
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
