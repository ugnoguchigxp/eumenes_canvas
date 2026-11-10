#!/bin/bash
# start-runs.sh [root] [D|A] [review] : 実行器をバックグラウンドで起動する（DONE があるもの・動いているものは飛ばす）。
# 条件 A では review（probes|judge|full、既定 full）を渡す。課題の組は環境変数 SUITE（heldout|general|render、既定 heldout）。
# 実行器のログは <root>/logs/<run>.log（制作担当の実行ディレクトリの外）。
set -euo pipefail
ROOT=${1:-/workspace/canvas_p3}; shift || true
COND=${1:-D}; shift || true
REVIEW=${1:-full}; shift || true
SUITE=${SUITE:-heldout}
if [ "$#" -gt 0 ] || { [ "$COND" != D ] && [ "$COND" != A ]; } || { [ "$COND" = A ] && [[ ! "$REVIEW" =~ ^(probes|judge|full)$ ]]; }; then
  echo "使い方: [SUITE=heldout|general|render] $0 [root] [D|A] [probes|judge|full]" >&2
  exit 1
fi
REPO=$(cd "$(dirname "$(realpath "$0")")/../.." && pwd)
mkdir -p "$ROOT/logs"
for d in "$ROOT"/"$COND"-r*; do
  [ -d "$d" ] || continue
  [ -f "$d/host/DONE" ] && { echo "done: $d"; continue; }
  pgrep -f -- "--run-dir $d( |$)" >/dev/null && { echo "running: $d"; continue; }
  if [ "$COND" = A ]; then
    (cd "$REPO" && nohup bun eval/p3/run.ts --suite "$SUITE" --cond A --review "$REVIEW" --run-dir "$d" --host-port "$(cat "$d/PORT")" >> "$ROOT/logs/$(basename "$d").log" 2>&1 &)
  else
    (cd "$REPO" && nohup bun eval/p3/run.ts --suite "$SUITE" --cond D --run-dir "$d" --host-port "$(cat "$d/PORT")" >> "$ROOT/logs/$(basename "$d").log" 2>&1 &)
  fi
  echo "started: $d"
done
