# Scripts-For-Bitburner

A personal collection of JavaScript scripts I write and use while playing [Bitburner](https://bitburner-official.github.io/). 
The scripts cover automated hacking (HWGW batching), server rooting, faction reputation grinding, and stock market trading.

> **Note on workflow:** These scripts are mostly written and tested *inside the game itself*, using Bitburner's built-in script editor (it's Vim mode), not in this repo directly. I don't clone/open this repo locally, branch, or PR against it mostly — it's simply a backup/showcase of scripts that are actively developed in-game. Because of that, some scripts here may be older or slightly out of sync with what I'm currently running, and there's no branch history to track iteration – just periodic pushes of whatever's working at the time (Currently Version 3.0.1).

## Folder overview

### `HWGW_Batcher/`
A continuous single-target Hack-Weaken-Grow-Weaken (HWGW) batching system.
- `hwgw-batcher.js` — main controller that times and launches batches against the single best target.
- `hack.js` — worker script that hacks a target after an optional delay.
- `grow.js` — worker script that grows a target's money after an optional delay.
- `weaken.js` — worker script that lowers a target's security after an optional delay.
- `root-servers.js` — scans the network and nukes every server it currently has the port-crackers for.

### `Multi-batch-runner/`
A multi-target batching system that runs several HWGW cycles concurrently instead of just one.
- `Multi-batch-runner_batch-runner.js` — main controller that pre-calculates thread counts and launches staggered batches across multiple targets.
- `Multi-batch-runner_batch-hack.js` — worker script that hacks a target for a percentage of its money.
- `Multi-batch-runner_batch-grow.js` — worker script that grows a target's server money.
- `Multi-batch-runner_batch-weaken.js` — worker script that lowers a target's security.

### `Drain-Hack/`
A simple, aggressive hacking script for quick cash grabs.
- `drain-hack.js` — repeatedly hacks one target for everything it has, ignoring security/grow, until the server's money is drained to ~$0.

### `Faction-Grind/`
Scripts for passively earning faction reputation using idle RAM.
- `share-network.js` — one-shot launcher that finds all currently free RAM across the rooted network and fills it with `share.js` threads for a reputation-gain bonus.
- `share.js` — the worker script that just calls `ns.share()` in a loop; launched by `share-network.js`.

## Root scripts

- `compare-targets.js` — diagnostic tool that lists every rooted, hackable server ranked by the same scoring formula the batchers use, along with the raw stats behind each score.
- `stock-trader.js` — a 4S-data-driven stock trading bot that goes long/short based on forecast confidence, with volatility filtering and capped position sizing.

After downloading a folder go into the Bitburner Terminal and run **"upload ."** or **" upload {name of folder/file}"**

## License
MIT — see [LICENSE](LICENSE).
