/** @param {NS} ns
 *
 * Diagnostic: prints every rooted, currently-hackable server sorted by the
 * same score hack-manager.js uses, along with the raw numbers behind it.
 *
 */
export async function main(ns) {
    const playerHackLevel = ns.getHackingLevel();
    const servers = scanAll(ns);
    const rows = [];

    for (const host of servers) {
        if (!ns.hasRootAccess(host)) continue;
        const reqLevel = ns.getServerRequiredHackingLevel(host);
        const maxMoney = ns.getServerMaxMoney(host);
        if (maxMoney <= 0) continue;

        const hackTimeSec = ns.getHackTime(host) / 1000;
        const hackChance = reqLevel <= playerHackLevel ? ns.hackAnalyzeChance(host) : 0;
        const eligible = reqLevel <= playerHackLevel;
        const score = eligible ? (maxMoney * hackChance) / hackTimeSec : -1;

        rows.push({ host, reqLevel, eligible, maxMoney, hackChance, hackTimeSec, score });
    }

    rows.sort((a, b) => b.score - a.score);

    ns.tprint("=".repeat(100));
    ns.tprint(
        `${"HOST".padEnd(20)} ${"ELIGIBLE".padEnd(9)} ${"REQ LVL".padEnd(8)} ` +
        `${"MAX MONEY".padEnd(14)} ${"CHANCE".padEnd(8)} ${"HACK TIME".padEnd(10)} SCORE ($/s)`
    );
    ns.tprint("-".repeat(100));

    for (const r of rows) {
        ns.tprint(
            `${r.host.padEnd(20)} ${(r.eligible ? "yes" : "NO - lvl").padEnd(9)} ${String(r.reqLevel).padEnd(8)} ` +
            `${("$" + Math.floor(r.maxMoney).toLocaleString()).padEnd(14)} ` +
            `${(r.eligible ? (r.hackChance * 100).toFixed(1) + "%" : "-").padEnd(8)} ` +
            `${(r.eligible ? r.hackTimeSec.toFixed(1) + "s" : "-").padEnd(10)} ` +
            `${r.eligible ? "$" + r.score.toFixed(0) : "-"}`
        );
    }
    ns.tprint("=".repeat(100));
    ns.tprint(`Your hacking level: ${playerHackLevel}`);
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