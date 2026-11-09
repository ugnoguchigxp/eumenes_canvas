#!/bin/bash
# make-runs.sh [root] [反復数=3] : general-v1 の実行ディレクトリ <root>/D-r{1..n} を作る（既にあれば触らない）。条件は直接生成（D）だけ。
# 各ディレクトリ: RUN_NAME、PORT、READY.txt（説明と立入禁止の範囲）、tools/（応答の道具、P3 と同じ）、work/、solo/gen。
# 制作担当は各ディレクトリに 1 人ずつ、新しい会話で割り当てる。課題の判定・参照作品・他の実行は見せない。
set -euo pipefail
ROOT=${1:-/workspace/canvas_general}
N=${2:-3}
SRC=$(dirname "$(realpath "$0")")
P3=$(cd "$SRC/../p3" && pwd)
mkdir -p "$ROOT"
port=4801
for k in $(seq 1 "$N"); do
  d="$ROOT/D-r$k"
  if [ -e "$d" ]; then echo "exists: $d"; port=$((port+2)); continue; fi
  mkdir -p "$d/tools" "$d/work" "$d/solo/gen"
  cp "$P3"/responder/*.sh "$d/tools/" && chmod +x "$d/tools/"*.sh
  echo "general-D-r$k" > "$d/RUN_NAME"; echo "$port" > "$d/PORT"
  sed -e "s|@DIR@|$d|g" -e "s|@COND@|D|g" -e "s|@ROOT@|$ROOT|g" "$SRC/ready/gen-common.txt" "$SRC/ready/gen-D.txt" > "$d/READY.txt"
  echo "made: $d (port $port)"
  port=$((port+2))
done
