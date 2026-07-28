#!/usr/bin/env bash
# Voyages as theorems:
#   solution: the trader bot (price-driven routes, aligned dockings) must reach 1000 cr in 12 jumps
#   null: a random-cargo random-route commander must NOT get rich (or dies)
#   ablate-economy: smart routes with blind cargo picks must NOT get rich — reading prices is load-bearing
#   duel: the combat bot must kill a pirate and live; null-gunner must die
#   dock-aligned must DOCK; dock-crooked must be REPELLED by the spinning hull
#   mech-*: prices by economy, fuel arithmetic, market invariants, laser, missile, bounty+rank,
#           wanted status, station rotation, and pitch+roll pursuit convergence
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-chromium}"
run() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --virtual-time-budget=600000 --dump-dom \
    "file://$DIR/index.html?verify=$1" 2>/dev/null | grep -o 'VERIFY:{[^<]*' | head -1
}
for m in solution null ablate-economy duel null-gunner dock-aligned dock-crooked mech-prices mech-fuel mech-market mech-laser mech-missile mech-bounty mech-rank mech-wanted mech-rotation mech-steer; do
  run "$m"
done
