#!/bin/bash
# art2.sh <id> <title> <entry.js> <meta.json>  （条件 A の制作担当）
# meta.json は {"spec":{"requirements":[…],"controls":[…]},"changes":"…","unconfirmed":[…],"reply":"…","libraries":[…],"dataRef":"…"}
# （libraries・dataRef・reply は省略できる。reply が無ければ changes と同じ文）。{title, entry（ファイルの中身）} と合わせて書く。
. "$(dirname "$(realpath "$0")")/common.sh"
E=$(realpath "$3") || exit 1
M=$(realpath "$4") || exit 1
jq -e 'type=="object"' "$M" >/dev/null || { echo "meta.json が JSON の物ではない" >&2; exit 1; }
jq -n --arg t "$2" --rawfile e "$E" --slurpfile m "$M" \
  '($m[0]) as $m | {title:$t, entry:$e} + $m + {reply: ($m.reply // $m.changes // "")}' | atomic_write "$HZ/solo/gen" "$1"
