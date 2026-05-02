import axios from 'axios'
import { getState, recordTrade, loadState } from '../config/risk.js'
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
  BTCUSD:  1,
  ETHUSD:  1,
  EURUSD:  100000,
  GBPUSD:  100000,
  USDJPY:  100000,
  USDCHF:  100000,
  USDCAD:  100000,
  AUDUSD:  100000,
  NZDUSD:  100000,
  DEFAULT: 1,
}

let accessToken   = null
let accountId     = null
let accNum        = null
let tokenIssuedAt = null

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
  accessToken   = res.data.accessToken
  tokenIssuedAt = Date.now()
  console.log('[TL] Login erfolgreich')
}

async function ensureValidToken() {
  const fiftyMin = 50 * 60 * 1000
  if (!accessToken || !tokenIssuedAt || (Date.now() - tokenIssuedAt) > fiftyMin) {
    console.log('[TL] Token abgelaufen oder fehlt — erneuere...')
    await login()
  }
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
    await ensureValidToken()
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
async function placeOrder(side, symbol, lots) {
  await ensureValidToken()
  const { instrumentId, routeId } = getInstrument(symbol)
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
    balanceAtOpen,
  })

  await sendOpenWithButton(symbol, side, lots, entryPrice ?? '—')
  return res.data
}

// ================================
// OFFENE POSITION HOLEN
// ================================
async function getOpenPosition(symbol) {
  await ensureValidToken()
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
    await ensureValidToken()
    const pos = await getOpenPosition(symbol)
    console.log(`[TL] getOpenPositionData(${symbol}):`, pos ? 'gefunden' : 'keine')
    return pos
  } catch (err) {
    console.error('[TL] getOpenPositionData Fehler:', err.message)
    return null
  }
}

// ================================
// LIVE PNL SNAPSHOT — 3 Versuche
// ================================
export async function getLivePositionPnL(symbol) {
  try {
    await ensureValidToken()

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

    let currentPrice = null
    let gotPrice     = false

    // Versuch 1: Depth Endpoint
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
        console.log(`[TL] PnL Preis via depth: ${currentPrice}`)
      }
    } catch {
      // Depth nicht verfügbar
    }

    // Versuch 2: Preis aus roher Positions-Antwort
    if (!gotPrice) {
      try {
        const { instrumentId } = getInstrument(symbol)
        const posRes    = await axios.get(
          `${BASE_URL}/trade/accounts/${accountId}/positions`,
          { headers: authHeaders() }
        )
        const positions = posRes.data.d?.positions || []
        const match     = positions.find(pos => String(pos[1]) === String(instrumentId))
        if (match) {
          // Alle Indices loggen damit wir den richtigen finden
          console.log('[TL] Position raw array:', JSON.stringify(match))
          // Index 5 = entry price, suche nach einem anderen Preis-Wert
          const numericValues = match
            .map((v, i) => ({ i, v: parseFloat(v) }))
            .filter(x => !isNaN(x.v) && x.v > 100)
          console.log('[TL] Numerische Werte > 100:', JSON.stringify(numericValues))
          if (match[5] && parseFloat(match[5]) > 0) {
            currentPrice = parseFloat(match[5])
            gotPrice     = true
            console.log(`[TL] PnL Preis via positions[5]: ${currentPrice}`)
          }
        }
      } catch (e) {
        console.log('[TL] Positions Preis Fehler:', e.message)
      }
    }

    // Versuch 3: Balance-Differenz
    if (!gotPrice) {
      if (tradeInfo?.balanceAtOpen) {
        const balanceNow = await getLiveBalance()
        if (balanceNow !== null) {
          const pnl = parseFloat((balanceNow - tradeInfo.balanceAtOpen).toFixed(2))
          console.log(`[TL] PnL via Balance-Diff: ${pnl}`)
          return {
            pnl,
            currentPrice: 'N/A',
            entryPrice,   side, lots,
            durationMin,
          }
        }
      }
      return {
        pnl:          null,
        currentPrice: 'N/A',
        entryPrice,   side, lots,
        durationMin,
      }
    }

    const priceDiff = side === 'buy'
      ? currentPrice - entryPrice
      : entryPrice - currentPrice
    const pnl = priceDiff * lots * contractSize

    return {
      pnl:          parseFloat(pnl.toFixed(2)),
      currentPrice: parseFloat(currentPrice.toFixed(2)),
      entryPrice,   side, lots,
      durationMin,
    }

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
  await ensureValidToken()
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
// ================================
export async function handleSignal(position, symbol, skipClose = false, cachedPos = null, lots = 0.01, isRetry = false) {
  try {
    await ensureValidToken()

    if (isRetry && (position === 'long' || position === 'short')) {
      console.log(`[TL] Retry nach 401 — prüfe Position für ${symbol}`)
      const freshPos = await getOpenPosition(symbol)
      if (freshPos) {
        console.log(`[TL] Offene Position gefunden nach Re-Login → nur schließen`)
        await closePosition(symbol, freshPos)
        return
      }
      console.log(`[TL] Keine offene Position nach Re-Login → normaler Entry`)
    }

    console.log(`[TL] Signal: ${position} | Symbol: ${symbol} | Lots: ${lots} | skipClose: ${skipClose}`)

    if (position === 'long') {
      const existing = cachedPos ?? (skipClose ? null : await getOpenPosition(symbol))
      if (existing) {
        console.log(`[TL] Bestehende Position gefunden — schließe zuerst`)
        await closePosition(symbol, existing)
      }
      await placeOrder('buy', symbol, lots)
    }
    else if (position === 'short') {
      const existing = cachedPos ?? (skipClose ? null : await getOpenPosition(symbol))
      if (existing) {
        console.log(`[TL] Bestehende Position gefunden — schließe zuerst`)
        await closePosition(symbol, existing)
      }
      await placeOrder('sell', symbol, lots)
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
      console.log('[TL] 401 — Token force refresh...')
      accessToken   = null
      tokenIssuedAt = null
      await login()
      await handleSignal(position, symbol, false, null, lots, true)
      return
    }

    if (err.response?.status === 429) {
      console.log('[TL] Rate limit — warte 3 Sekunden...')
      await new Promise(r => setTimeout(r, 3000))
      await handleSignal(position, symbol, skipClose, cachedPos, lots, isRetry)
      return
    }
  }
}

// ================================
// DASHBOARD
// ================================
export async function triggerDashboard() {
  await ensureValidToken()
  const liveBalance = await getLiveBalance()
  const state       = getState()
  await sendDashboard(liveBalance, INITIAL_CAPITAL, state)
}

// ================================
// TRADE HISTORY
// ================================
export async function triggerTradeHistory() {
  await ensureValidToken()
  const { last10Trades } = getState()
  await sendTradeHistory(last10Trades)
}

// ================================
// DEBUG
// ================================
export async function debugBalance() {
  await ensureValidToken()
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
  await ensureValidToken()
  const res = await axios.get(
    `${BASE_URL}/trade/accounts/${accountId}/ordersHistory`,
    { headers: authHeaders() }
  )
  return res.data
}

export async function getDebugInfo() {
  await ensureValidToken()
  const liveBalance = await getLiveBalance()
  return {
    accountId, accNum, liveBalance,
    totalInstruments: instrumentMap.size,
    riskState:    getState(),
    activeTrades: Object.fromEntries(activeTrades),
  }
}

export async function getPositionDebug() {
  await ensureValidToken()
  const res = await axios.get(
    `${BASE_URL}/trade/accounts/${accountId}/positions`,
    { headers: authHeaders() }
  )
  return res.data
}

// ================================
// DEBUG RAW POSITIONS — temporär für PnL Debugging
// Zeigt komplette rohe Position-Daten mit allen Indices
// ================================
export async function debugRawPositions() {
  await ensureValidToken()
  const res = await axios.get(
    `${BASE_URL}/trade/accounts/${accountId}/positions`,
    { headers: authHeaders() }
  )
  const raw       = res.data
  const positions = raw.d?.positions || []

  // Jeden Index mit Wert auflisten für alle Positionen
  const parsed = positions.map(pos => {
    const indexed = {}
    pos.forEach((val, i) => { indexed[`[${i}]`] = val })
    return indexed
  })

  return {
    raw,
    parsed,
    activeTrades: Object.fromEntries(activeTrades),
  }
}

// ================================
// START
// ================================
init().catch(async err => {
  console.error('[TL] Init fehlgeschlagen:', err.message)
  await sendErrorNotification(err.message, 'init()')
})
