/** @param {NS} ns
 * WIP (Work In Progress) Script
 * 
 * Requires hack.js, grow.js, weaken.js, root-servers.js on home alongside
 * this file.
 * 
 */

const HOME = "home";
const ROOT_SCRIPT = "root-servers.js";

const HACK_PERCENT = 0.25; // steals this fraction of max money per. batch.
const SPACER_MS = 50; // gap between each piece landing within a batch.
const LAUNCH_INTERVAL_MS = 250; // how often it tries launching a new batch.
const PREP_SECURITY_MARGIN = 1; // how tight to pull security in before batching starts.
const RETARGET_INTERVAL_MS = 60000; // how often to check if a greater target exists.
const CORRECTION_SECURITY_MARGIN = 15; // if security drifts "this" far above min, pause and fix it.

export async function main(ns) {
    ns.disableLog("ALL");
    ns.clearLog();

    while (true) {
        runRooterPass(ns);
        const target = pickBestTarget(ns);

        if (!target) {
            ns.print("No valid target found yet, waiting...");
            await ns.sleep(5000);
            continue;
        }

        ns.print(`=== Targeting ${target} ===`);
        await prepServer(ns, target, PREP_SECURITY_MARGIN);
        await runBatcher(ns, target, RETARGET_INTERVAL_MS);
        // runBatcher returns when it decides a better target exists it loop back around to re-pick and re-prep.
    }
}

// --- Network discovery -----------------------------------------------------

function scanAll(ns) {
    const visited = new Set(["home"]);
    const queue = ["home"];
    while (queue.length > 0) {
        const host = queue.shift();
        for (const neighbor of ns.scan(host)) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }
    visited.delete("home");
    return [...visited];
}

function runRooterPass(ns) {
    if (!ns.fileExists(ROOT_SCRIPT, HOME)) return;
    if (ns.isRunning(ROOT_SCRIPT, HOME)) return;
    ns.exec(ROOT_SCRIPT, HOME, 1);
}

// --- Target selection --------------------------------------------------

function scoreServer(ns, host) {
    const maxMoney = ns.getServerMaxMoney(host);
    const hackTimeSeconds = ns.getHackTime(host) / 1000;
    const hackChance = ns.hackAnalyzeChance(host);
    return (maxMoney * hackChance) / hackTimeSeconds;
}

function pickBestTarget(ns) {
    const playerHackLevel = ns.getHackingLevel();
    let best = null;
    let bestScore = -Infinity;

    for (const host of scanAll(ns)) {
        if (!ns.hasRootAccess(host)) continue;
        if (ns.getServerRequiredHackingLevel(host) > playerHackLevel) continue;
        if (ns.getServerMaxMoney(host) <= 0) continue;

        const score = scoreServer(ns, host);
        if (score > bestScore) {
            bestScore = score;
            best = host;
        }
    }
    return best;
}

// --- RAM / execution helpers -----------------------------------------------

function getExecutionHosts(ns, scriptRam) {
    const candidates = [HOME, ...scanAll(ns)];
    const seen = new Set();
    const hosts = [];

    for (const host of candidates) {
        if (seen.has(host)) continue;
        seen.add(host);
        if (!ns.hasRootAccess(host)) continue;
        const maxRam = ns.getServerMaxRam(host);
        if (maxRam <= 0) continue;

        const freeRam = maxRam - ns.getServerUsedRam(host);
        const maxThreads = Math.floor(freeRam / scriptRam);
        if (maxThreads > 0) hosts.push({ host, maxThreads });
    }

    return hosts.sort((a, b) => b.maxThreads - a.maxThreads);
}

function totalFreeRam(ns) {
    let total = 0;
    for (const host of [HOME, ...scanAll(ns)]) {
        if (!ns.hasRootAccess(host)) continue;
        const maxRam = ns.getServerMaxRam(host);
        if (maxRam <= 0) continue;
        total += maxRam - ns.getServerUsedRam(host);
    }
    return total;
}

// Blocker: Distributes threads across your network and WAITS for completion.
// Should be Used only during prep/correction, where it need the target settled before moving to the next
async function runActionBlocking(ns, script, target, threadsWanted) {
    const scriptRam = ns.getScriptRam(script, HOME);
    const hosts = getExecutionHosts(ns, scriptRam);
    if (hosts.length === 0) {
        await ns.sleep(2000);
        return;
    }

    let remaining = threadsWanted;
    const pids = [];
    for (const { host, maxThreads } of hosts) {
        if (remaining <= 0) break;
        const threads = Math.min(remaining, maxThreads);
        if (host !== HOME) {
            const copied = await ns.scp(script, host);
            if (!copied) continue;
        }
        const pid = ns.exec(script, host, threads, target);
        if (pid !== 0) {
            pids.push(pid);
            remaining -= threads;
        }
    }

    while (pids.some(pid => ns.isRunning(pid))) {
        await ns.sleep(200);
    }
}

// Non-blocker: Distributes threads across the network with a landing delay
// which is baked into each worker's args, fires them off, and returns immediately.
async function launchBatchPart(ns, script, target, delayMs, threadsWanted) {
    const scriptRam = ns.getScriptRam(script, HOME);
    const hosts = getExecutionHosts(ns, scriptRam);
    let remaining = threadsWanted;

    for (const { host, maxThreads } of hosts) {
        if (remaining <= 0) break;
        const threads = Math.min(remaining, maxThreads);
        if (host !== HOME) {
            const copied = await ns.scp(script, host);
            if (!copied) continue;
        }
        const pid = ns.exec(script, host, threads, target, Math.round(delayMs));
        if (pid !== 0) remaining -= threads;
    }

    return threadsWanted - remaining; // threads that actually launched
}

// --- Prep phase (blocking, gets the target to min security / max money) --

async function prepServer(ns, target, securityMargin) {
    ns.print(`${target}: prepping (weaken + grow to baseline)...`);
    while (true) {
        const security = ns.getServerSecurityLevel(target);
        const minSecurity = ns.getServerMinSecurityLevel(target);
        const money = ns.getServerMoneyAvailable(target);
        const maxMoney = ns.getServerMaxMoney(target);

        if (security > minSecurity + securityMargin) {
            const weakenPerThread = ns.weakenAnalyze(1);
            const threads = Math.max(1, Math.ceil((security - minSecurity) / weakenPerThread));
            ns.print(`${target}: prep weaken (${threads} threads)`);
            await runActionBlocking(ns, "weaken.js", target, threads);
        } else if (money < maxMoney * 0.99) {
            const currentMoney = Math.max(money, 1);
            const growthMultiplierNeeded = maxMoney / currentMoney;
            const threads = Math.max(1, Math.ceil(ns.growthAnalyze(target, growthMultiplierNeeded)));
            ns.print(`${target}: prep grow (${threads} threads)`);
            await runActionBlocking(ns, "grow.js", target, threads);
        } else {
            ns.print(`${target}: prep complete - security ${security.toFixed(2)}/${minSecurity.toFixed(2)}, money at max`);
            return;
        }
    }
}

// --- Continuous batching ---------------------------------------------------

async function runBatcher(ns, target, retargetIntervalMs) {
    const hackRam = ns.getScriptRam("hack.js", HOME);
    const growRam = ns.getScriptRam("grow.js", HOME);
    const weakenRam = ns.getScriptRam("weaken.js", HOME);
    const weakenPerThread = ns.weakenAnalyze(1);

    let batchesLaunched = 0;
    let lastRetargetCheck = Date.now();

    while (true) {
        // IF-statement to secure if has drifted off too far, pause and correct instead of digging deeper in the network.
        const currentSecurity = ns.getServerSecurityLevel(target);
        const minSecurity = ns.getServerMinSecurityLevel(target);
        if (currentSecurity > minSecurity + CORRECTION_SECURITY_MARGIN) {
            ns.print(`${target}: security drifted (${currentSecurity.toFixed(2)}/${minSecurity.toFixed(2)}) - correcting`);
            await prepServer(ns, target, PREP_SECURITY_MARGIN);
        }

        // Periodically checks whether a meaningfully "better" target has appeared
        if (Date.now() - lastRetargetCheck > retargetIntervalMs) {
            lastRetargetCheck = Date.now();
            const candidate = pickBestTarget(ns);
            if (candidate && candidate !== target && scoreServer(ns, candidate) > scoreServer(ns, target) * 1.2) {
                ns.print(`Better target found: ${candidate} - switching`);
                return;
            }
            runRooterPass(ns);
        }

        // Size one batch based on current server stats.
        const maxMoney = ns.getServerMaxMoney(target);
        const hackAmount = maxMoney * HACK_PERCENT;
        const hackThreads = Math.max(1, Math.ceil(ns.hackAnalyzeThreads(target, hackAmount)));
        const hackSecIncrease = ns.hackAnalyzeSecurity(hackThreads, target);
        const weaken1Threads = Math.max(1, Math.ceil(hackSecIncrease / weakenPerThread));

        const growMultiplier = 1 / (1 - HACK_PERCENT);
        const growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(target, growMultiplier)));
        const growSecIncrease = ns.growthAnalyzeSecurity(growThreads, target);
        const weaken2Threads = Math.max(1, Math.ceil(growSecIncrease / weakenPerThread));

        const ramNeeded =
            hackThreads * hackRam +
            weaken1Threads * weakenRam +
            growThreads * growRam +
            weaken2Threads * weakenRam;

        if (totalFreeRam(ns) >= ramNeeded) {
            const weakenTime = ns.getWeakenTime(target);
            const growTime = ns.getGrowTime(target);
            const hackTime = ns.getHackTime(target);

            // Delays chosen so completion order is: hack -> weaken1 -> grow -> weaken2,
            // each landing SPACER_MS apart.
            const hackDelay = Math.max(0, weakenTime - hackTime - SPACER_MS);
            const weaken1Delay = 0;
            const growDelay = Math.max(0, weakenTime - growTime + SPACER_MS);
            const weaken2Delay = 2 * SPACER_MS;

            await launchBatchPart(ns, "hack.js", target, hackDelay, hackThreads);
            await launchBatchPart(ns, "weaken.js", target, weaken1Delay, weaken1Threads);
            await launchBatchPart(ns, "grow.js", target, growDelay, growThreads);
            await launchBatchPart(ns, "weaken.js", target, weaken2Delay, weaken2Threads);

            batchesLaunched++;
            if (batchesLaunched % 10 === 0) {
                ns.print(`${target}: ${batchesLaunched} batches launched so far`);
            }
        }

        await ns.sleep(LAUNCH_INTERVAL_MS);
    }
}
