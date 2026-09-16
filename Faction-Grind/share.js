/** @param {NS} ns
 * Have "share-network.js" along with this script.
 */
export async function main(ns) {
    while (true) {
        await ns.share();
    }
}
