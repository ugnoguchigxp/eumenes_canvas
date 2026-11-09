#!/bin/bash
# start-runs.sh [root] [cond...] : 各実行ディレクトリの実行器をバックグラウンドで起動する（DONE があるもの・動いているものは飛ばす）。
# 実行器のログは <root>/logs/<run>.log（制作担当の実行ディレクトリの外）。
set -euo pipefail
ROOT=${1:-/workspace/canvas_p3}; shift || true
CONDS=${*:-D C P}
REPO=$(cd "$(dirname "$(realpath "$0")")/../.." && pwd)
mkdir -p "$ROOT/logs"
for c in $CONDS; do for d in "$ROOT/$c"-r*; do
  [ -d "$d" ] || continue
  [ -f "$d/host/DONE" ] && { echo "done: $d"; continue; }
  pgrep -f -- "--run-dir $d( |$)" >/dev/null && { echo "running: $d"; continue; }
  (cd "$REPO" && nohup bun eval/p3/run.ts --cond "$c" --run-dir "$d" --host-port "$(cat "$d/PORT")" >> "$ROOT/logs/$(basename "$d").log" 2>&1 &)
  echo "started: $d"
done; done
