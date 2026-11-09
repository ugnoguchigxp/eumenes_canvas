#!/bin/bash
# make-runs.sh [root] : P3 の実行ディレクトリ <root>/{D,C,P}-r{1,2,3} を作る（既にあれば触らない）。
# 各ディレクトリ: RUN_NAME、PORT、READY.txt（役割ごとの説明と立入禁止の範囲）、tools/（応答の道具）、work/（制作担当の作業場所）、solo/gen（P は solo/rev も）。
# 制作担当（gen）・検証担当（rev）は各ディレクトリに 1 人ずつ、新しい会話で割り当てる。課題の正解・判定・他の実行は見せない。
set -euo pipefail
ROOT=${1:-/workspace/canvas_p3}
SRC=$(dirname "$(realpath "$0")")
mkdir -p "$ROOT"
port=4701
for c in D C P; do for k in 1 2 3; do
  d="$ROOT/$c-r$k"
  if [ -e "$d" ]; then echo "exists: $d"; port=$((port+2)); continue; fi
  mkdir -p "$d/tools" "$d/work" "$d/solo/gen"
  [ "$c" = P ] && mkdir -p "$d/solo/rev"
  cp "$SRC"/responder/*.sh "$d/tools/" && chmod +x "$d/tools/"*.sh
  echo "p3-$c-r$k" > "$d/RUN_NAME"; echo "$port" > "$d/PORT"
  sed -e "s|@DIR@|$d|g" -e "s|@COND@|$c|g" "$SRC/ready/gen-common.txt" "$SRC/ready/gen-$c.txt" > "$d/READY.txt"
  [ "$c" = P ] && sed -e "s|@DIR@|$d|g" "$SRC/ready/rev-P.txt" > "$d/READY-rev.txt"
  echo "made: $d (port $port)"
  port=$((port+2))
done; done
