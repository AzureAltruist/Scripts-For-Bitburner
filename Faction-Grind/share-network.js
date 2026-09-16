/** @param {NS} ns
 *
 * One-shot launcher: It finds whatever RAM is CURRENTLY free across your whole
 * rooted network (home included) and  dedicates all of it to share.js threads 
 * for a constant faction-rep bonus.
 * 
 * Manually kill each process if you need to free up RAM for hacking, growth or weaken 
 */

const HOME = "home";
const SHARE_SCRIPT = "share.js";
const RESERVE_HOME_RAM = 8; // GB always left free on home for manual commands/other scripts

export async function main(ns) {
    if (!ns.fileExists(SHARE_SCRIPT, HOME)) {
        ns.tprint(`ERROR: ${SHARE_SCRIPT} not found on home. Copy it there first.`);
        return;
    }

    const scriptRam = ns.getScriptRam(SHARE_SCRIPT, HOME);
    const hosts = getExecutionHosts(ns, scriptRam);

    let totalThreads = 0;
    let usedHosts = 0;

    for (const { host, maxThreads } of hosts) {
        let threads = maxThreads;

        if (host === HOME) {
            const reserveThreads = Math.ceil(RESERVE_HOME_RAM / scriptRam);
            threads = Math.max(0, maxThreads - reserveThreads);
        }
        if (threads <= 0) continue;

        if (host !== HOME) {
            const copied = await ns.scp(SHARE_SCRIPT, host);
            if (!copied) continue;
        }

        const pid = ns.exec(SHARE_SCRIPT, host, threads);
        if (pid !== 0) {
            totalThreads += threads;
            usedHosts++;
            ns.tprint(`  ${host}: ${threads} share threads`);
        }
    }

    if (totalThreads === 0) {
        ns.tprint("share-network: no free RAM found to dedicate to sharing.");
        return;
    }

    ns.tprint(`share-network: launched ${totalThreads} share threads across ${usedHosts} server(s).`);
    ns.tprint(`This bonus will stay active continuously. Kill the share.js processes (per-server) to free that RAM back up for hacking.`);
}

// --- shared helper ---------------------

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
