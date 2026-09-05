/** @param {NS} ns
 * args: [target, delayMs (optional, default 0)]
 */
export async function main(ns) {
    const target = ns.args[0];
    const delay = ns.args[1] || 0;
    if (delay > 0) await ns.sleep(delay);
    await ns.hack(target);
}
