#!/bin/bash
# start-runs.sh [root] [D] : 直接生成の実行器をバックグラウンドで起動する（DONE があるもの・動いているものは飛ばす）。
# 実行器のログは <root>/logs/<run>.log（制作担当の実行ディレクトリの外）。
set -euo pipefail
ROOT=${1:-/workspace/canvas_p3}; shift || true
if [ "$#" -gt 1 ] || [ "${1:-D}" != D ]; then
  echo "使い方: $0 [root] [D]" >&2
  exit 1
fi
REPO=$(cd "$(dirname "$(realpath "$0")")/../.." && pwd)
mkdir -p "$ROOT/logs"
for d in "$ROOT"/D-r*; do
  [ -d "$d" ] || continue
  [ -f "$d/host/DONE" ] && { echo "done: $d"; continue; }
  pgrep -f -- "--run-dir $d( |$)" >/dev/null && { echo "running: $d"; continue; }
  (cd "$REPO" && nohup bun eval/p3/run.ts --cond D --run-dir "$d" --host-port "$(cat "$d/PORT")" >> "$ROOT/logs/$(basename "$d").log" 2>&1 &)
  echo "started: $d"
done
