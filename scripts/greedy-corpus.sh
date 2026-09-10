#!/usr/bin/env bash
# Issue #3393 — the greedy-vs-search measurement, corpus half.
#
# Re-collects the decision-telemetry corpus (#1893's six pairings, fixed seeds,
# 400 iterations) with the greedy-concordance fields on every record, in three
# parallel shards that differ only by seed — the same sharding #1893 used.
# Shard A carries the blade corpus; B and C exclude it so a merge never
# double-counts it. Each shard writes one JSON under ladder-runs/.
#
# Usage:  bash scripts/greedy-corpus.sh [games-per-pairing=3]
# Cost:   ~4–8 min per game single-threaded; 3 games × 6 pairings per shard
#         ≈ 1.5–2.5 h wall-clock (the test file caps itself at 3 h) with the three shards in parallel.
set -euo pipefail
GAMES="${1:-3}"
STAMP="$(date +%Y-%m-%d-%H-%M)"
OUTDIR="ladder-runs"
mkdir -p "$OUTDIR"
run_shard() {
    local name="$1" seed="$2" blade="$3"
    DECISION_CORPUS=1 DECISION_CORPUS_GAMES="$GAMES" DECISION_CORPUS_SEED="$seed" \
    DECISION_CORPUS_BLADE="$blade" \
    DECISION_CORPUS_OUT="$OUTDIR/$STAMP-greedy-concordance-$name.json" \
        bunx vitest run src/lib/ai/selfplay/decisionCorpus.bot.test.ts \
        -t "collects the full corpus" \
        >"$OUTDIR/$STAMP-greedy-concordance-$name.log" 2>&1
    echo "shard $name exit=$?"
}
run_shard A 1893 1 &
run_shard B 2893 0 &
run_shard C 3893 0 &
wait
echo "done: $OUTDIR/$STAMP-greedy-concordance-{A,B,C}.json"
