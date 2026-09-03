/** @param {NS} ns
 * Requires weaken.js, grow.js, hack.js and root-servers.js to be present on
 * home alongside this file.
 */

const HOME = "home";
const ROOT_SCRIPT = "root-servers.js";

export async function main(ns) {
    ns.disableLog("ALL");
    ns.clearLog();

    const REEVALUATE_INTERVAL = 10; // reconsider target / re-root every N loop iterations
    const SWITCH_THRESHOLD = 1.15;   // new target must score 15% better to steal focus
    const SECURITY_MARGIN = 5;      // tolerate security up to (min + this) before weakening
    const MONEY_THRESHOLD = 0.45;   // only hack once money is >= N% of max

    let currentTarget = null;
    let loopCount = 0;

    while (true) {
        if (loopCount % REEVALUATE_INTERVAL === 0) {
            runRooterPass(ns);
        }

        if (loopCount % REEVALUATE_INTERVAL === 0 || currentTarget === null) {
            const allServers = scanAll(ns);
            const best = pickBestTarget(ns, allServers, currentTarget, SWITCH_THRESHOLD);
            if (best !== currentTarget) {
                ns.print(`Switching target: ${currentTarget ?? "none"} -> ${best}`);
                currentTarget = best;
            }
        }
        loopCount++;

        if (currentTarget === null) {
            ns.print("No valid target found yet, waiting...");
            await ns.sleep(5000);
            continue;
        }

        await farm(ns, currentTarget, SECURITY_MARGIN, MONEY_THRESHOLD);
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
    if (!ns.fileExists(ROOT_SCRIPT, HOME)) {
        ns.print(`WARNING: ${ROOT_SCRIPT} not found on home - auto-rooting disabled`);
        return;
    }
    if (ns.isRunning(ROOT_SCRIPT, HOME)) return; // already running from a previous pass
    ns.exec(ROOT_SCRIPT, HOME, 1);
}

// --- Target selection --------------------------------------------------

function pickBestTarget(ns, servers, currentTarget, switchThreshold) {
    const playerHackLevel = ns.getHackingLevel();
    let best = null;
    let bestScore = -Infinity;

    for (const host of servers) {
        if (!ns.hasRootAccess(host)) continue;
        if (ns.getServerRequiredHackingLevel(host) > playerHackLevel) continue;
        if (ns.getServerMaxMoney(host) <= 0) continue;

        const score = scoreServer(ns, host);
        if (score > bestScore) {
            bestScore = score;
            best = host;
        }
    }

    if (currentTarget && ns.hasRootAccess(currentTarget) && ns.getServerMaxMoney(currentTarget) > 0) {
        const currentScore = scoreServer(ns, currentTarget);
        if (bestScore < currentScore * switchThreshold) {
            return currentTarget;
        }
    }

    return best;
}

function scoreServer(ns, host) {
    const maxMoney = ns.getServerMaxMoney(host);
    const hackTimeSeconds = ns.getHackTime(host) / 1000;
    const hackChance = ns.hackAnalyzeChance(host);
    return (maxMoney * hackChance) / hackTimeSeconds;
}

// --- Farming loop --------------------------------------------------------

async function farm(ns, target, securityMargin, moneyThreshold) {
    const security = ns.getServerSecurityLevel(target);
    const minSecurity = ns.getServerMinSecurityLevel(target);
    const money = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);

    if (security > minSecurity + securityMargin) {
        const weakenPerThread = ns.weakenAnalyze(1);
        const threadsNeeded = Math.max(1, Math.ceil((security - minSecurity) / weakenPerThread));
        ns.print(`${target}: security ${security.toFixed(2)}/${minSecurity.toFixed(2)} -> weaken (${threadsNeeded} threads needed)`);
        await runAction(ns, "weaken.js", target, threadsNeeded);
    } else if (money < maxMoney * moneyThreshold) {
        const currentMoney = Math.max(money, 1);
        const growthMultiplierNeeded = maxMoney / currentMoney;
        const threadsNeeded = Math.max(1, Math.ceil(ns.growthAnalyze(target, growthMultiplierNeeded)));
        ns.print(`${target}: money ${Math.floor(money).toLocaleString()}/${Math.floor(maxMoney).toLocaleString()} -> grow (${threadsNeeded} threads needed)`);
        await runAction(ns, "grow.js", target, threadsNeeded);
    } else {
        const hackPercentPerThread = ns.hackAnalyze(target);
        const threadsNeeded = hackPercentPerThread > 0
            ? Math.max(1, Math.floor(0.5 / hackPercentPerThread))
            : 1;
        ns.print(`${target}: hacking (${threadsNeeded} threads needed)`);
        await runAction(ns, "hack.js", target, threadsNeeded);
    }
}

// Finds every rooted server with spare RAM (/home/ included), and sorted by how
// many threads of `scriptRam` size they can each afford, largest (GB)server first.
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

// Spreads "threadsWanted" threads of "script" across as many rooted servers
// as it takes, then waits for every launched instance to finish.
async function runAction(ns, script, target, threadsWanted) {
    const scriptRam = ns.getScriptRam(script, HOME);
    const hosts = getExecutionHosts(ns, scriptRam);

    if (hosts.length === 0) {
        ns.print(`No free RAM anywhere to run ${script} - waiting`);
        await ns.sleep(5000);
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

    if (remaining > 0) {
        ns.print(`${target}: only found RAM for ${threadsWanted - remaining}/${threadsWanted} threads of ${script} across ${hosts.length} server(s)`);
    }

    while (pids.some(pid => ns.isRunning(pid))) {
        await ns.sleep(200);
    }
}