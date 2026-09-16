/**
 * BATCH WEAKEN SCRIPT
 * 
 * Called by multi-batch-manager.js to reduce server security.
 * Each thread reduces security by 0.05.
 * 
 */

export async function main(ns) {
  const target = ns.args[0];
  
  if (!target) {
    ns.tprint('ERROR: No target specified');
    return;
  }

  await ns.weaken(target);
  
  // Debugging: log for debugging
  // const server = ns.getServer(target);
  // ns.tprint(`Weakened ${target}: security now ${server.hackDifficulty.toFixed(2)}`);
}
