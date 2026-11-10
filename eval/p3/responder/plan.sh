#!/bin/bash
# plan.sh <id> <plan.json>  （条件 A の検証担当：台本の応答 {"scripts":[…]}）。write.sh eval <id> <file> と同じ動き。
. "$(dirname "$(realpath "$0")")/common.sh"
F=$(realpath "$2") || exit 1
jq -e '(.scripts|type)=="array"' "$F" >/dev/null || { echo "台本の形ではない（scripts が配列の JSON の物）" >&2; exit 1; }
atomic_write "$HZ/solo/eval" "$1" < "$F"
