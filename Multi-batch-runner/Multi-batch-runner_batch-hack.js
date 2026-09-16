/**
 * BATCH HACK SCRIPT
 * 
 * Called by multi-batch-manager.js to execute hack operations.
 * Removes a percentage of target server's money.
 * 
 */

export async function main(ns) {
  const target = ns.args[0];
  
  if (!target) {
    ns.tprint('ERROR: No target specified');
    return;
  }

  const stolen = await ns.hack(target);
  
  // Debugging: log for debugging
  // ns.tprint(`Hacked ${target}: stole $${ns.formatNumber(stolen)}`);
}
