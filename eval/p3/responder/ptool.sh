#!/bin/bash
# ptool.sh <id> <title> <entry.js> <expectedStatus> <expectedObservation> <refutedIf> [whatChanged] [dataRef]  （条件 P の制作担当、propose）
# write_artwork を選ぶ propose 応答を書く。entry は text（道具の text field）で渡し、inputJson には title・dataRef だけを入れる。
# ほかの項目（findings・following・uses など）は空の値。必要なら fill.sh で全項目を自分で書く。
. "$(dirname "$(realpath "$0")")/common.sh"
D="$HZ/solo/gen"; E=$(realpath "$3") || exit 1
inp=$(jq -cn --arg t "$2" --arg d "${8:-}" '{title:$t} + (if $d=="" then {} else {dataRef:$d} end)')
jq -s '.[0] + .[1]' <(defaults "$D/requests/$1.json") \
  <(jq -n --arg i "$inp" --rawfile e "$E" --arg s "$4" --arg o "$5" --arg r "$6" --arg w "${7:-}" \
     '{kind:"tool", tool:"write_artwork", inputJson:$i, text:$e, expectedStatus:$s, expectedObservation:$o, refutedIf:$r, whatChanged:$w}') \
  | atomic_write "$D" "$1"
