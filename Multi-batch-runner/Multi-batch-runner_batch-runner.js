/**
 * HOW IT WORKS:
 * 1. Pre-calculation phase: Calculate exact threads needed for each server
 * 2. Execution phase: Start all scripts with staggered timing offsets
 * 3. Loop phase: Wait for all to complete, then restart
 * 
 */

export async function main(ns) {
  
  // CONFIGURATION
  const TARGETS = [
    'foodnstuff',
    'sigma-cosmetics',
    'joesguns'
  ];

  const TIMING_OFFSET = 50; // ms offset between each batch start
  const LOOP_COOLDOWN = 100; // ms between cycle completions (safety buffer)
  const LOG_INTERVAL = 10000; // Log every 10 seconds

  // INITIALIZATION
  
  ns.disableLog('sleep');
  ns.disableLog('exec');
  
  ns.tprint(`
==================================================================
|      MULTI-TARGET CONCURRENT BATCH RUNNER v3.1                 |
|                                                                |
|  Targets: foodnstuff, sigma-cosmetics, joesguns                |
|  Strategy: 3 concurrent independent HWGH cycles                |
|                                                                |
==================================================================
  `);

  // Kill any existing batch scripts
  for (const target of TARGETS) {
    ns.killall(target);
  }
  // ns.killall('home');
  await ns.sleep(500);

  // PHASE 1: PRE-CALCULATION
  ns.tprint('\n[INIT] Calculating thread requirements...');

  function getThreadsNeeded(target) {
    const server = ns.getServer(target);
    const player = ns.getPlayer();

    // HACK THREADS: Calculate how many threads to steal ~50% of money
    const hackPercent = ns.hackAnalyze(target);
    const hackThreads = Math.max(1, Math.ceil(0.5 / hackPercent));

    // WEAKEN THREADS (Post-Hack): Hack increases security by (hackThreads * 0.004)
    const hackSecurityIncrease = hackThreads * 0.004;
    const weakenThreads1 = Math.max(1, Math.ceil(hackSecurityIncrease / 0.05));

    // GROW THREADS: Restore money from 50% to 100%
    const growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(target, 2)));

    // WEAKEN THREADS (Post-Grow): Grow increases security by (growThreads * 0.004)
    const growSecurityIncrease = growThreads * 0.004;
    const weakenThreads2 = Math.max(1, Math.ceil(growSecurityIncrease / 0.05));

    return {
      hack: hackThreads,
      weaken1: weakenThreads1,
      grow: growThreads,
      weaken2: weakenThreads2,
      total: hackThreads + weakenThreads1 + growThreads + weakenThreads2
    };
  }

  const threadMap = {};
  for (const target of TARGETS) {
    threadMap[target] = getThreadsNeeded(target);
    ns.tprint(
      `${target}: H=${threadMap[target].hack} W1=${threadMap[target].weaken1} ` +
      `G=${threadMap[target].grow} W2=${threadMap[target].weaken2} ` +
      `(${threadMap[target].total} total)`
    );
  }

  // PHASE 2: EXECUTION LOOP
  
  ns.tprint('\n[RUN] Starting batch execution loop...\n');

  let cycleCount = 0;
  let totalMoneyEarned = 0;
  const startTime = Date.now();
  let lastLogTime = Date.now();

  while (true) {
    cycleCount++;
    const cycleStartTime = Date.now();

    // Start each target's batch offset by TIMING_OFFSET
    for (let i = 0; i < TARGETS.length; i++) {
      const target = TARGETS[i];
      const threads = threadMap[target];

      const delayBeforeStart = i * TIMING_OFFSET;

      // Hack phase
      await ns.sleep(delayBeforeStart);
      ns.exec('batch-hack.js', 'home', threads.hack, target);
      const hackTime = ns.getHackTime(target);

      // Wait for hack to finish, then weaken
      await ns.sleep(hackTime + 50);
      ns.exec('batch-weaken.js', 'home', threads.weaken1, target);
      const weakenTime = ns.getWeakenTime(target);

      // Wait for weaken, then grow
      await ns.sleep(weakenTime + 50);
      ns.exec('batch-grow.js', 'home', threads.grow, target);
      const growTime = ns.getGrowTime(target);

      // Wait for grow, then final weaken
      await ns.sleep(growTime + 50);
      ns.exec('batch-weaken.js', 'home', threads.weaken2, target);
      await ns.sleep(weakenTime + 50);
    }

    // Cycle complete
    const cycleDuration = (Date.now() - cycleStartTime) / 1000;

    // Estimate money earned this cycle
    const moneyPerHack = {};
    for (const target of TARGETS) {
      const server = ns.getServer(target);
      const hackPercent = ns.hackAnalyze(target);
      const hackThreads = threadMap[target].hack;
      moneyPerHack[target] = server.moneyMax * hackPercent * hackThreads;
    }
    const cycleEarnings = Object.values(moneyPerHack).reduce((a, b) => a + b, 0);
    totalMoneyEarned += cycleEarnings;

    // Log periodically
    const now = Date.now();
    if (now - lastLogTime >= LOG_INTERVAL) {
      const uptime = (now - startTime) / 1000; // seconds
      const avgRate = totalMoneyEarned / uptime;
      const projected24h = avgRate * 86400;

      ns.tprint(`
=======================================================
BATCH PERFORMANCE REPORT
Cycles completed: ${cycleCount}
Uptime: ${(uptime / 60).toFixed(1)}m
Total earned: $${ns.format.number(totalMoneyEarned)}
Average rate: $${ns.format.number(avgRate)}/s
Cycle time: ${cycleDuration.toFixed(1)}s
=======================================================
PROJECTIONS
24-hour total: $${ns.format.number(projected24h)}
18-hour total: $${ns.format.number(projected24h * 0.75)}
=======================================================
      `);

      lastLogTime = now;
    }

    await ns.sleep(LOOP_COOLDOWN);
  }
}
