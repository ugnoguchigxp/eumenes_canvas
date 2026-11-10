#!/bin/bash
# make-runs.sh [root] : 直接生成の実行ディレクトリ <root>/D-r{1,2,3} を作る（既にあれば触らない）。
# 各ディレクトリ: RUN_NAME、PORT、READY.txt、tools/（応答の道具）、work/、solo/gen。
# 制作担当は各ディレクトリに 1 人ずつ割り当てる。課題の正解・判定・他の実行は見せない。
set -euo pipefail
ROOT=${1:-/workspace/canvas_p3}
SRC=$(dirname "$(realpath "$0")")
mkdir -p "$ROOT"
port=4701
for k in 1 2 3; do
  d="$ROOT/D-r$k"
  if [ -e "$d" ]; then echo "exists: $d"; port=$((port+2)); continue; fi
  mkdir -p "$d/tools" "$d/work" "$d/solo/gen"
  cp "$SRC"/responder/*.sh "$d/tools/" && chmod +x "$d/tools/"*.sh
  echo "p3-D-r$k" > "$d/RUN_NAME"; echo "$port" > "$d/PORT"
  sed -e "s|@DIR@|$d|g" -e "s|@COND@|D|g" "$SRC/ready/gen-common.txt" "$SRC/ready/gen-D.txt" > "$d/READY.txt"
  echo "made: $d (port $port)"
  port=$((port+2))
done
