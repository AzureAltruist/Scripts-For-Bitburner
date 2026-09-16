/** @param {NS} ns
 *
 * Pure drain: Repeatedly hacks ONE target for everything it currently has,
 * ignoring security/weaken/grow entirely, until its money hits ~$0.
 * Run with: run drain-hack.js <target>
 * e.g.:     run drain-hack.js foodnstuff
 */

const HOME = "home";

export async function main(ns) {
    const target = ns.args[0];

    if (!target) {
        ns.tprint("ERROR: specify a target. Usage: run drain-hack.js <hostname>");
        return;
    }
    if (!ns.serverExists(target)) {
        ns.tprint(`ERROR: server '${target}' does not exist`);
        return;
    }
    if (!ns.hasRootAccess(target)) {
        ns.tprint(`ERROR: no root access on '${target}' yet`);
        return;
    }

    ns.disableLog("ALL");
    ns.clearLog();

    const startMoney = ns.getServerMoneyAvailable(target);
    ns.print(`Draining ${target} - starting money: $${Math.floor(startMoney).toLocaleString()}`);
    let totalStolen = 0;

    while (true) {
        const money = ns.getServerMoneyAvailable(target);
        if (money < 1) {
            ns.print(`${target} is drained ($${Math.floor(money)} left).`);
            break;
        }

        // Threads needed to steal everything currently on the server, at
        // the server's CURRENT security level (recalculated every pass).
        const threadsNeeded = Math.max(1, Math.ceil(ns.hackAnalyzeThreads(target, money)));
        ns.print(`${target}: $${Math.floor(money).toLocaleString()} left -> hacking (${threadsNeeded} threads wanted)`);

        const before = ns.getServerMoneyAvailable(target);
        await runAction(ns, "hack.js", target, threadsNeeded);
        const after = ns.getServerMoneyAvailable(target);
        totalStolen += Math.max(0, before - after);
    }

    ns.tprint(`Done draining ${target}. Total stolen: ~$${Math.floor(totalStolen).toLocaleString()}`);
}

// --- Network helpers ---

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

    if (remaining > 0 && Number.isFinite(remaining)) {
        ns.print(`${target}: only found RAM for ${threadsWanted - remaining}/${threadsWanted} threads of ${script} across ${hosts.length} server(s)`);
    }

    while (pids.some(pid => ns.isRunning(pid))) {
        await ns.sleep(200);
    }
}
