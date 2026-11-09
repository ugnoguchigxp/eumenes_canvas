#!/bin/bash
# invoke.sh <id> <title> <entry.js> <text|-> [changes] [dataRef]  （条件 C の制作担当）
# {action:"invoke", tool:"artwork.propose", arguments:{title, entry, changes?, dataRef?}, text?} を書く。text に - を渡すと text なし。
# reply・return・discard などほかの行動は fill.sh で書く。
. "$(dirname "$(realpath "$0")")/common.sh"
E=$(realpath "$3") || exit 1
jq -n --arg t "$2" --rawfile e "$E" --arg x "$4" --arg c "${5:-}" --arg d "${6:-}" \
  '{action:"invoke", tool:"artwork.propose", arguments:({title:$t, entry:$e} + (if $c=="" then {} else {changes:$c} end) + (if $d=="" then {} else {dataRef:$d} end))} + (if $x=="-" then {} else {text:$x} end)' \
  | atomic_write "$HZ/solo/gen" "$1"
