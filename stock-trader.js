/**
 * 4S FORECAST STOCK TRADER v1.0
 *
 * THE CORE LOGIC:
 *   forecast > 0.5  → stock is trending UP  → go long (buy)
 *   forecast < 0.5  → stock is trending DOWN → go short (sell short), if unlocked
 *   forecast ≈ 0.5  → no edge → stay out / close position
 *
 * Doesn't trade right at 0.50 because it's basically a coin flip once you subtract commission ($100k per trade). 
 * Uses buffer thresholds
 * 
 * RISK MANAGEMENT:
 *   - Position sizing is capped as a % of net worth (default 10%)
 *   - High-volatility stocks are skipped — bigger price swings mean the
 *     forecast is less reliable and you can get stopped out for no reason.
 *   - Cash reserve is always kept so you're never fully deployed (keeps
 *     you liquid for other things such as batchers, augmentations, etc).
 */

export async function main(ns) {
  
  // CONFIGURATION
  const CONFIG = {
    // --- Entry/exit thresholds ---
    LONG_BUY_FORECAST: 0.62,     // Open long when forecast >= this
    LONG_SELL_FORECAST: 0.50,    // Close long when forecast drops below this
    SHORT_SELL_FORECAST: 0.38,   // Open short when forecast <= this (if enabled)
    SHORT_COVER_FORECAST: 0.50,  // Close short when forecast rises above this

    // --- Risk management ---
    MAX_VOLATILITY: 0.08,        // Skip stocks more volatile than 8% per tick
    POSITION_SIZE_PCT: 0.10,     // Max 10% of net worth per single stock
    CASH_RESERVE_PCT: 0.15,      // Always keep 15% of net worth as cash buffer
    MIN_ORDER_VALUE_MULT: 50,    // Order must be worth >= 50x commission (keeps fees < 2%)

    // --- Behavior ---
    ENABLE_SHORTS: true,         // Auto-disabled if short selling isn't unlocked yet
    TICK_MS: 6000,               // How often to check prices
    LOG_INTERVAL_TICKS: 10,      // Print a portfolio summary every N ticks
  };

  
  // INITIALIZATION
  ns.disableLog('ALL');
  ns.clearLog();
  ns.ui.openTail();

  ns.print(`
==================================================================
|           4S FORECAST STOCK TRADER v1.0 - STARTING             |
==================================================================
  `);

  // --- Preflight checks: confirm you actually have the access this script needs ---
  if (!ns.stock.hasWseAccount()) {
    ns.tprint('ERROR: No WSE Account. Buy one at the Stock Exchange (NYC) first.');
    return;
  }
  if (!ns.stock.hasTixApiAccess()) {
    ns.tprint('ERROR: No TIX API access. Buy it at the Stock Exchange first.');
    return;
  }
  if (!ns.stock.has4SDataTixApi()) {
    ns.tprint('ERROR: No 4S Market Data TIX API access. Buy it at the Stock Exchange first.');
    return;
  }

  const commission = ns.stock.getConstants().StockMarketCommission;

  // Zero-share test call and see if the game rejects it.
  if (CONFIG.ENABLE_SHORTS) {
    try {
      ns.stock.buyShort(ns.stock.getSymbols()[0], 0);
    } catch (e) {
      CONFIG.ENABLE_SHORTS = false;
      ns.print('Short selling not available yet (needs SF8.2) — running long-only.');
    }
  }

  ns.print(`Long-only: ${!CONFIG.ENABLE_SHORTS ? 'YES' : 'NO (shorts enabled)'}`);
  ns.print(`Tracking ${ns.stock.getSymbols().length} symbols. Trading loop starting...\n`);

  // HELPER FUNCTIONS
  // Calculate total net worth: cash + market value of all open positions.
  function getNetWorth(ns) {
    let total = ns.getPlayer().money;

    for (const sym of ns.stock.getSymbols()) {
      const [longShares, longAvgPx, shortShares, shortAvgPx] = ns.stock.getPosition(sym);

      if (longShares > 0) {
        // Long position value = what you'd get selling right now
        total += longShares * ns.stock.getBidPrice(sym);
      }
      if (shortShares > 0) {
        // Short position value = collateral + unrealized profit/loss
        // Profit on a short = (price you shorted at - current price)
        const unrealized = shortShares * (shortAvgPx - ns.stock.getAskPrice(sym));
        total += (shortShares * shortAvgPx) + unrealized;
      }
    }

    return total;
  }

  /**
   * Calculate how many shares to buy for a new position, respecting:
   * - the per-position size cap (% of net worth)
   * - available cash after reserve
   * - the exchange's max shares per stock
   * - Minimum order size
   */
  function calcBuyShares(ns, sym, availableCash, netWorth) {
    const price = ns.stock.getAskPrice(sym);
    const maxShares = ns.stock.getMaxShares(sym);
    const [longShares] = ns.stock.getPosition(sym);

    const positionBudget = Math.min(netWorth * CONFIG.POSITION_SIZE_PCT, availableCash);
    let shares = Math.floor(positionBudget / price);
    shares = Math.min(shares, maxShares - longShares);

    const orderValue = shares * price;
    if (orderValue < commission * CONFIG.MIN_ORDER_VALUE_MULT) return 0;

    return Math.max(0, shares);
  }

    // Same sizing logic, but opening a short position.
  function calcShortShares(ns, sym, availableCash, netWorth) {
    const price = ns.stock.getAskPrice(sym);
    const maxShares = ns.stock.getMaxShares(sym);
    const [, , shortShares] = ns.stock.getPosition(sym);

    const positionBudget = Math.min(netWorth * CONFIG.POSITION_SIZE_PCT, availableCash);
    let shares = Math.floor(positionBudget / price);
    shares = Math.min(shares, maxShares - shortShares);

    const orderValue = shares * price;
    if (orderValue < commission * CONFIG.MIN_ORDER_VALUE_MULT) return 0;

    return Math.max(0, shares);
  }

  // MAIN TRADING LOOP
  let tickCount = 0;
  let lastLogTick = 0;
  const startTime = Date.now();
  const startingNetWorth = getNetWorth(ns);

  while (true) {
    tickCount++;
    const netWorth = getNetWorth(ns);
    const cash = ns.getPlayer().money;
    const reserve = netWorth * CONFIG.CASH_RESERVE_PCT;
    let availableCash = Math.max(0, cash - reserve);

    const symbols = ns.stock.getSymbols();

    // PASS 1: Manage existing positions (exit first, frees up cash)
    for (const sym of symbols) {
      const [longShares, , shortShares] = ns.stock.getPosition(sym);
      const forecast = ns.stock.getForecast(sym);

      if (longShares > 0 && forecast < CONFIG.LONG_SELL_FORECAST) {
        ns.stock.sellStock(sym, longShares);
        ns.print(`SELL  ${sym}: closed ${longShares} long shares (forecast ${forecast.toFixed(2)})`);
      }

      if (CONFIG.ENABLE_SHORTS && shortShares > 0 && forecast > CONFIG.SHORT_COVER_FORECAST) {
        ns.stock.sellShort(sym, shortShares);
        ns.print(`COVER ${sym}: closed ${shortShares} short shares (forecast ${forecast.toFixed(2)})`);
      }
    }

    // PASS 2: Find new opportunities, ranked by edge/volatility
    const candidates = [];
    for (const sym of symbols) {
      const [longShares, , shortShares] = ns.stock.getPosition(sym);
      if (longShares > 0 || shortShares > 0) continue; // already in a position

      const forecast = ns.stock.getForecast(sym);
      const volatility = ns.stock.getVolatility(sym);
      if (volatility > CONFIG.MAX_VOLATILITY) continue; // too risky

      if (forecast >= CONFIG.LONG_BUY_FORECAST) {
        candidates.push({ sym, type: 'long', edge: (forecast - 0.5) / volatility });
      } else if (CONFIG.ENABLE_SHORTS && forecast <= CONFIG.SHORT_SELL_FORECAST) {
        candidates.push({ sym, type: 'short', edge: (0.5 - forecast) / volatility });
      }
    }

    candidates.sort((a, b) => b.edge - a.edge);

    for (const c of candidates) {
      if (availableCash < commission * CONFIG.MIN_ORDER_VALUE_MULT) break;

      const netWorthNow = getNetWorth(ns);

      if (c.type === 'long') {
        const shares = calcBuyShares(ns, c.sym, availableCash, netWorthNow);
        if (shares > 0) {
          const cost = ns.stock.buyStock(c.sym, shares);
          availableCash -= (shares * cost + commission);
          ns.print(`BUY   ${c.sym}: ${shares} shares @ $${ns.format.number(cost)} (edge score ${c.edge.toFixed(2)})`);
        }
      } else {
        const shares = calcShortShares(ns, c.sym, availableCash, netWorthNow);
        if (shares > 0) {
          const price = ns.stock.buyShort(c.sym, shares);
          availableCash -= (shares * price + commission);
          ns.print(`SHORT ${c.sym}: ${shares} shares @ $${ns.format.number(price)} (edge score ${c.edge.toFixed(2)})`);
        }
      }
    }

    // --- Periodic summary ---
    if (tickCount - lastLogTick >= CONFIG.LOG_INTERVAL_TICKS) {
      const uptime = (Date.now() - startTime) / 1000;
      const currentNetWorth = getNetWorth(ns);
      const profit = currentNetWorth - startingNetWorth;
      const rate = profit / Math.max(uptime, 1);

      let openPositions = 0;
      for (const sym of symbols) {
        const [l, , s] = ns.stock.getPosition(sym);
        if (l > 0 || s > 0) openPositions++;
      }

      ns.print(`
======================================================
STOCK PORTFOLIO REPORT (tick ${tickCount})
Uptime:        ${(uptime / 60).toFixed(1)}m
Net Worth:     $${ns.format.number(currentNetWorth)}
Cash:          $${ns.format.number(cash)}
Open positions:${openPositions}
Profit so far: $${ns.format.number(profit)}
Rate:          $${ns.format.number(rate)}/s
Projected 24h: $${ns.format.number(rate * 86400)}
======================================================
      `);

      lastLogTick = tickCount;
    }

    await ns.sleep(CONFIG.TICK_MS);
  }
}
