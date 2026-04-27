// ============================================================
// RISK ENGINE v4.0 — Nur Trade Logging + Winrate Tracking
// Lot Size wird NICHT mehr hier berechnet — kommt aus Alert
// ============================================================
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const INITIAL_CAPITAL = parseFloat(process.env.INITIAL_CAPITAL || '5000')
const REDIS_KEY       = 'hybrid-bot:state'

let state = {
  tradeHistory:   [],
  initialCapital: INITIAL_CAPITAL,
  tradingBalance: INITIAL_CAPITAL,
  savingsBalance: 0,
}

// ============================================================
// STATE LADEN
// ============================================================
export async function loadState() {
  try {
    const saved = await redis.get(REDIS_KEY)
    console.log('[RISK] Redis raw:', JSON.stringify(saved))

    if (saved && typeof saved === 'object' && Array.isArray(saved.tradeHistory)) {
      state.tradeHistory   = saved.tradeHistory   ?? []
      state.tradingBalance = saved.tradingBalance ?? INITIAL_CAPITAL
      state.savingsBalance = saved.savingsBalance ?? 0
      state.initialCapital = INITIAL_CAPITAL
      console.log(`[RISK] State geladen — ${state.tradeHistory.length} Trades in History`)
      console.log(`[RISK] Trading Balance: $${state.tradingBalance}`)
    } else {
      console.log('[RISK] Kein State in Redis — frisch starten')
      state.tradeHistory   = []
      state.tradingBalance = INITIAL_CAPITAL
      state.savingsBalance = 0
      await saveState()
    }
  } catch (err) {
    console.error('[RISK] State laden Fehler:', err.message)
  }
}

// ============================================================
// STATE SPEICHERN
// ============================================================
async function saveState() {
  try {
    const toSave = {
      tradeHistory:   state.tradeHistory,
      tradingBalance: state.tradingBalance,
      savingsBalance: state.savingsBalance,
    }
    await redis.set(REDIS_KEY, JSON.stringify(toSave))
    console.log(`[RISK] State gespeichert — ${state.tradeHistory.length} Trades`)
  } catch (err) {
    console.error('[RISK] State speichern Fehler:', err.message)
  }
}

// ============================================================
// WINRATE HELPERS
// ============================================================
function calcWinrate(trades, n) {
  if (trades.length === 0) return 50
  const slice = trades.slice(-n)
  if (slice.length === 0) return 50
  const wins = slice.filter(t => t.result === 'WIN').length
  return (wins / slice.length) * 100
}

function smoothedWinrate(recentWinrate) {
  return 0.7 * recentWinrate + 0.3 * 50
}

// ============================================================
// STAGE 3 — EXTERNAL (letzte 60 Trades)
// ============================================================
export function getExternalWinrate() {
  if (state.tradeHistory.length < 60) return 50
  return calcWinrate(state.tradeHistory, 60)
}

// ============================================================
// STAGE 2 — COARSE (letzte 10–30 Trades)
// ============================================================
export function getCoarseWinrate() {
  const ext = getExternalWinrate()
  const n   = Math.round(10 + (ext / 100) * 20)
  if (state.tradeHistory.length < n) return 50
  return calcWinrate(state.tradeHistory, n)
}

// ============================================================
// STAGE 1 — FINE (letzte 2–5 Trades dynamisch)
// ============================================================
export function getFineTrades() {
  const ext = getExternalWinrate()
  const n   = 5 - 0.03 * ext
  return Math.min(5, Math.max(2, Math.round(n)))
}

export function getFineWinrate() {
  const fineTrades = getFineTrades()
  const raw        = calcWinrate(state.tradeHistory, fineTrades)
  return smoothedWinrate(raw)
}

// ============================================================
// TRADE LOG — in Render Logs ausgeben
// ============================================================
function printTradeLog() {
  const history    = state.tradeHistory
  const total      = history.length
  const last3      = history.slice(-3)
  const ext        = getExternalWinrate()
  const coarse     = getCoarseWinrate()
  const fine       = getFineWinrate()
  const fineTrades = getFineTrades()
  const pattern    = last3.map(t => t.result === 'WIN' ? 'WIN' : 'LOSE').join(' → ')
  const wins       = history.filter(t => t.result === 'WIN').length
  const totalWr    = total > 0 ? ((wins / total) * 100).toFixed(1) : '50.0'

  console.log('\n╔══════════════════════════════════════╗')
  console.log('║         TRADE LOG — NACH FLAT        ║')
  console.log('╠══════════════════════════════════════╣')
  console.log(`║ Letzte 3 Trades:  ${pattern.padEnd(20)}║`)
  console.log(`║ Total Trades:     ${String(total).padEnd(20)}║`)
  console.log(`║ Gesamt Winrate:   ${(totalWr + '%').padEnd(20)}║`)
  console.log('╠══════════════════════════════════════╣')
  console.log(`║ [S3] External WR: ${(ext.toFixed(1) + '%').padEnd(20)}║`)
  console.log(`║ [S2] Coarse WR:   ${(coarse.toFixed(1) + '%').padEnd(20)}║`)
  console.log(`║ [S1] Fine WR:     ${(fine.toFixed(1) + '% (' + fineTrades + ' Trades)').padEnd(20)}║`)
  console.log('╠══════════════════════════════════════╣')
  console.log(`║ Trading Balance:  $${state.tradingBalance.toFixed(2).padEnd(19)}║`)
  console.log(`║ Savings Balance:  $${state.savingsBalance.toFixed(2).padEnd(19)}║`)
  console.log('╚══════════════════════════════════════╝\n')
}

// ============================================================
// TRADE AUFZEICHNEN
// ============================================================
export async function recordTrade(result, profitAmount = 0, liveBalance = null) {
  state.tradeHistory.push({
    result,
    profit:    profitAmount,
    timestamp: new Date().toISOString(),
  })

  // Balance live übernehmen wenn verfügbar
  if (liveBalance !== null) {
    state.tradingBalance = liveBalance
  } else {
    if (result === 'WIN' && profitAmount > 0) {
      state.tradingBalance += profitAmount
    } else if (result === 'LOSS' && profitAmount < 0) {
      state.tradingBalance += profitAmount
    }
  }

  printTradeLog()
  await saveState()
}

// ============================================================
// STATE ABRUFEN
// ============================================================
export function getState() {
  const history = state.tradeHistory
  const total   = history.length
  const wins    = history.filter(t => t.result === 'WIN').length

  return {
    tradeCount:      total,
    totalWinrate:    total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 50,
    last3Trades:     history.slice(-3).map(t => t.result),
    last10Trades:    history.slice(-10),
    externalWinrate: parseFloat(getExternalWinrate().toFixed(1)),
    coarseWinrate:   parseFloat(getCoarseWinrate().toFixed(1)),
    fineWinrate:     parseFloat(getFineWinrate().toFixed(1)),
    fineTrades:      getFineTrades(),
    tradingBalance:  parseFloat(state.tradingBalance.toFixed(2)),
    savingsBalance:  parseFloat(state.savingsBalance.toFixed(2)),
  }
}
