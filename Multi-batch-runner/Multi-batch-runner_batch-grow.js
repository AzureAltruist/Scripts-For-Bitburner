/**
 * BATCH GROW SCRIPT
 * 
 * Called by multi-batch-manager.js to increase server money.
 * Each thread applies the server's growth multiplier.
 * 
 */

export async function main(ns) {
  const target = ns.args[0];
  
  if (!target) {
    ns.tprint('ERROR: No target specified');
    return;
  }

  await ns.grow(target);
  
  // Debugging: log for debugging
  // const server = ns.getServer(target);
  // ns.tprint(`Grew ${target}: money now $${ns.formatNumber(server.moneyAvailable)}`);
}
