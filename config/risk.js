// ============================================================
// RISK ENGINE v3.0 — Mit persistenter Trade History (Upstash)
// ============================================================
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const INITIAL_CAPITAL = parseFloat(process.env.INITIAL_CAPITAL || '5000')
const REDIS_KEY       = 'hybrid-bot:state'

// ============================================================
// STATE
// ============================================================
let state = {
  tradeHistory:           [],
  initialCapital:         INITIAL_CAPITAL,
  tradingBalance:         INITIAL_CAPITAL,
  savingsBalance:         0,
  hardCapActive:          false,
  hardCapTradesRemaining: 0,
  recoveryBoostActive:    false,
}

// ============================================================
// STATE LADEN AUS REDIS
// ============================================================
export async function loadState() {
  try {
    const saved = await redis.get(REDIS_KEY)
    console.log('[RISK] Redis raw:', JSON.stringify(saved))

    if (saved && typeof saved === 'object' && Array.isArray(saved.tradeHistory)) {
      // Sauber mergen — jeden Wert einzeln übernehmen
      state.tradeHistory           = saved.tradeHistory           ?? []
      state.tradingBalance         = saved.tradingBalance         ?? INITIAL_CAPITAL
      state.savingsBalance         = saved.savingsBalance         ?? 0
      state.hardCapActive          = saved.hardCapActive          ?? false
      state.hardCapTradesRemaining = saved.hardCapTradesRemaining ?? 0
      state.recoveryBoostActive    = saved.recoveryBoostActive    ?? false
      state.initialCapital         = INITIAL_CAPITAL

      console.log(`[RISK] State geladen — ${state.tradeHistory.length} Trades in History`)
      console.log(`[RISK] Trading Balance: $${state.tradingBalance}`)
    } else {
      console.log('[RISK] Kein gültiger State in Redis — Startzustand anlegen')

      // Bisherige Trades vorbelegen
      state.tradeHistory = [
        { result: 'LOSS', profit: -10, timestamp: '2026-04-10T00:00:00.000Z' },
        { result: 'LOSS', profit: -10, timestamp: '2026-04-10T01:00:00.000Z' },
        { result: 'LOSS', profit: -10, timestamp: '2026-04-10T02:00:00.000Z' },
        { result: 'LOSS', profit: -10, timestamp: '2026-04-10T03:00:00.000Z' },
        { result: 'LOSS', profit: -10, timestamp: '2026-04-10T04:00:00.000Z' },
        { result: 'WIN',  profit: 10,  timestamp: '2026-04-10T05:00:00.000Z' },
        { result: 'WIN',  profit: 10,  timestamp: '2026-04-10T06:00:00.000Z' },
      ]
      state.tradingBalance = 4966.14
      await saveState()
      console.log('[RISK] Startzustand gespeichert')
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
      tradeHistory:           state.tradeHistory,
      tradingBalance:         state.tradingBalance,
      savingsBalance:         state.savingsBalance,
      hardCapActive:          state.hardCapActive,
      hardCapTradesRemaining: state.hardCapTradesRemaining,
      recoveryBoostActive:    state.recoveryBoostActive,
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
// ADAPTIVE RISK %
// ============================================================
function calcAdaptiveRisk(fineWinrate) {
  const risk = 0.5 + 0.015 * fineWinrate
  return Math.min(2.0, Math.max(0.5, risk))
}

export function getRiskPercent() {
  if (state.recoveryBoostActive) return 2.0
  if (state.hardCapActive && state.hardCapTradesRemaining > 0) return 0.75
  return calcAdaptiveRisk(getFineWinrate())
}

// ============================================================
// LOT STUFEN
// ============================================================
export function getLotSize() {
  const risk = getRiskPercent()
  if (risk <= 0.75) return 0.01
  if (risk <= 1.0)  return 0.01
  if (risk <= 1.5)  return 0.02
  if (risk <= 1.75) return 0.03
  return 0.04
}

// ============================================================
// UMLAGE
// ============================================================
function getUmlage(profitAmount) {
  const fineWinrate   = getFineWinrate()
  const umlagePercent = Math.max(0, Math.min(100, 85 - 0.75 * fineWinrate))
  return profitAmount * (umlagePercent / 100)
}

// ============================================================
// HARD CAP
// ============================================================
function checkHardCap() {
  const last3   = state.tradeHistory.slice(-3)
  const allLoss = last3.length === 3 && last3.every(t => t.result === 'LOSS')

  if (allLoss && !state.hardCapActive) {
    state.hardCapActive          = true
    state.hardCapTradesRemaining = 2
    state.recoveryBoostActive    = false
    console.log('[RISK] ⚠️ HARD CAP AKTIVIERT!')
  }
}

// ============================================================
// RECOVERY
// ============================================================
function checkRecovery() {
  const threshold = state.initialCapital * 0.35
  const target    = state.initialCapital * 0.50

  if (state.tradingBalance <= threshold && state.savingsBalance > 0) {
    const needed   = target - state.tradingBalance
    const transfer = Math.min(needed, state.savingsBalance)
    state.tradingBalance += transfer
    state.savingsBalance -= transfer
    console.log(`[RISK] 🔄 RECOVERY — $${transfer.toFixed(2)} transferiert`)
  }
}

// ============================================================
// TRADE LOG
// ============================================================
function printTradeLog() {
  const history    = state.tradeHistory
  const total      = history.length
  const last3      = history.slice(-3)
  const ext        = getExternalWinrate()
  const coarse     = getCoarseWinrate()
  const fine       = getFineWinrate()
  const fineTrades = getFineTrades()
  const risk       = getRiskPercent()
  const lots       = getLotSize()
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
  console.log(`║ Aktueller Risk:   ${(risk.toFixed(2) + '%').padEnd(20)}║`)
  console.log(`║ Nächste Lots:     ${String(lots).padEnd(20)}║`)
  console.log(`║ Hard Cap:         ${(state.hardCapActive ? 'AKTIV (' + state.hardCapTradesRemaining + ' übrig)' : 'Inaktiv').padEnd(20)}║`)
  console.log(`║ Recovery Boost:   ${(state.recoveryBoostActive ? 'AKTIV' : 'Inaktiv').padEnd(20)}║`)
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

  if (liveBalance !== null) {
    state.tradingBalance = liveBalance
  } else {
    if (result === 'WIN' && profitAmount > 0) {
      const umlage = getUmlage(profitAmount)
      state.savingsBalance += umlage
      state.tradingBalance += (profitAmount - umlage)
    } else if (result === 'LOSS' && profitAmount < 0) {
      state.tradingBalance += profitAmount
      checkRecovery()
    }
  }

  if (state.hardCapActive && state.hardCapTradesRemaining > 0) {
    state.hardCapTradesRemaining--
    if (state.hardCapTradesRemaining === 0) {
      state.hardCapActive = false
      if (result === 'WIN') {
        state.recoveryBoostActive = true
        console.log('[RISK] 🚀 RECOVERY BOOST aktiviert!')
      }
    }
  }

  if (state.recoveryBoostActive) {
    state.recoveryBoostActive = false
    console.log('[RISK] Recovery Boost verbraucht')
  }

  checkHardCap()
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
    tradeCount:             total,
    totalWinrate:           total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 50,
    last3Trades:            history.slice(-3).map(t => t.result),
    externalWinrate:        parseFloat(getExternalWinrate().toFixed(1)),
    coarseWinrate:          parseFloat(getCoarseWinrate().toFixed(1)),
    fineWinrate:            parseFloat(getFineWinrate().toFixed(1)),
    fineTrades:             getFineTrades(),
    currentRiskPercent:     parseFloat(getRiskPercent().toFixed(2)),
    nextLotSize:            getLotSize(),
    hardCapActive:          state.hardCapActive,
    hardCapTradesRemaining: state.hardCapTradesRemaining,
    recoveryBoostActive:    state.recoveryBoostActive,
    tradingBalance:         parseFloat(state.tradingBalance.toFixed(2)),
    savingsBalance:         parseFloat(state.savingsBalance.toFixed(2)),
    last10Trades:           history.slice(-10),
  }
}
