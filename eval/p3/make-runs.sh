#!/bin/bash
# make-runs.sh [root] [D|A] : 実行ディレクトリ <root>/<cond>-r{1,2,3} を作る（既にあれば触らない）。既定は D（直接生成）。
# D の各ディレクトリ: RUN_NAME、PORT、READY.txt、tools/（応答の道具）、work/、solo/gen。
# A の各ディレクトリ: RUN_NAME、PORT、READY-gen.txt（制作担当）、READY-eval.txt（検証担当）、tools/、work/、work-eval/、solo/gen、solo/eval。
# 制作担当は各ディレクトリに 1 人ずつ割り当てる。条件 A では検証担当を別の 1 人にする。課題の正解・判定・他の実行は見せない。
set -euo pipefail
ROOT=${1:-/workspace/canvas_p3}
COND=${2:-D}
case "$COND" in D) port=4701 ;; A) port=4721 ;; *) echo "使い方: $0 [root] [D|A]" >&2; exit 1 ;; esac
SRC=$(dirname "$(realpath "$0")")
mkdir -p "$ROOT"
for k in 1 2 3; do
  d="$ROOT/$COND-r$k"
  if [ -e "$d" ]; then echo "exists: $d"; port=$((port+2)); continue; fi
  mkdir -p "$d/tools" "$d/work" "$d/solo/gen"
  cp "$SRC"/responder/*.sh "$d/tools/" && chmod +x "$d/tools/"*.sh
  echo "p3-$COND-r$k" > "$d/RUN_NAME"; echo "$port" > "$d/PORT"
  if [ "$COND" = A ]; then
    mkdir -p "$d/work-eval" "$d/solo/eval"
    sed -e "s|@DIR@|$d|g" -e "s|@COND@|A|g" "$SRC/ready/gen-common.txt" "$SRC/ready/gen-A.txt" > "$d/READY-gen.txt"
    sed -e "s|@DIR@|$d|g" -e "s|@COND@|A|g" "$SRC/ready/eval-A.txt" > "$d/READY-eval.txt"
  else
    sed -e "s|@DIR@|$d|g" -e "s|@COND@|D|g" "$SRC/ready/gen-common.txt" "$SRC/ready/gen-D.txt" > "$d/READY.txt"
  fi
  echo "made: $d (port $port)"
  port=$((port+2))
done
