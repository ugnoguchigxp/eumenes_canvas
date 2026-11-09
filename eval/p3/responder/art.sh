#!/bin/bash
# art.sh <id> <title> <entry.js> <changes> [dataRef] [unconfirmed.json]  （条件 D の制作担当）
# 作品の応答 {title, entry, dataRef?, changes, unconfirmed, reply} を書く。reply は changes と同じ文。
. "$(dirname "$(realpath "$0")")/common.sh"
E=$(realpath "$3") || exit 1
jq -n --arg t "$2" --rawfile e "$E" --arg c "$4" --arg d "${5:-}" --argjson u "${6:-[]}" \
  '{title:$t, entry:$e, changes:$c, unconfirmed:$u, reply:$c} + (if $d=="" then {} else {dataRef:$d} end)' | atomic_write "$HZ/solo/gen" "$1"
