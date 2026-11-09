#!/bin/bash
# fill.sh <gen|rev> <id> <partial.json> : 要求の出力の形の必須項目を空の値で埋め、partial.json の項目で上書きして書く。
# 空の値のままで良いかは自分で判断する（形の検査に落ちれば理由つきで同じ要求が -retry として戻る）。
. "$(dirname "$(realpath "$0")")/common.sh"
D=$(role_dir "$1") || exit 1
P=$(realpath "$3") || exit 1
jq -s '.[0] + .[1]' <(defaults "$D/requests/$2.json") "$P" | atomic_write "$D" "$2"
