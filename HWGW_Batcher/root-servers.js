/** @param {NS} ns
 *
 * Standard rooting pass: Scans the whole network and nukes anything it can
 * with currently-owned port crackers. Split out of hack-manager.js so the
 * main loop doesn't have to pay RAM for brutessh/ftpcrack/etc every cycle
 */
export async function main(ns) {
    for (const host of scanAll(ns)) {
        tryRoot(ns, host);
    }
}

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

function tryRoot(ns, host) {
    if (ns.hasRootAccess(host)) return;

    const portsNeeded = ns.getServerNumPortsRequired(host);
    let portsOpened = 0;

    if (ns.fileExists("BruteSSH.exe", "home")) { try { ns.brutessh(host); portsOpened++; } catch {} }
    if (ns.fileExists("FTPCrack.exe", "home")) { try { ns.ftpcrack(host); portsOpened++; } catch {} }
    if (ns.fileExists("relaySMTP.exe", "home")) { try { ns.relaysmtp(host); portsOpened++; } catch {} }
    if (ns.fileExists("HTTPWorm.exe", "home")) { try { ns.httpworm(host); portsOpened++; } catch {} }
    if (ns.fileExists("SQLInject.exe", "home")) { try { ns.sqlinject(host); portsOpened++; } catch {} }

    if (portsOpened >= portsNeeded) {
        try {
            ns.nuke(host);
            ns.print(`Rooted ${host}`);
        } catch {
            // not enough ports actually opened, or some other issue - skips silently
        }
    }
}