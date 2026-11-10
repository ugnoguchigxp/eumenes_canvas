#!/bin/bash
# verdict.sh <id> <verdict.json>  （条件 A の検証担当：判定の応答 {"verdicts":[…],"issues":[…],"summary":"…"}）。write.sh eval <id> <file> と同じ動き。
. "$(dirname "$(realpath "$0")")/common.sh"
F=$(realpath "$2") || exit 1
jq -e '(.verdicts|type)=="array"' "$F" >/dev/null || { echo "判定の形ではない（verdicts が配列の JSON の物）" >&2; exit 1; }
atomic_write "$HZ/solo/eval" "$1" < "$F"
