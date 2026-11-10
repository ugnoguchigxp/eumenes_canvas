#!/bin/bash
# write.sh gen <id> [file.json] : 応答をそのまま書く（JSON を検証し、一時ファイル + mv。二重回答・不明 id は拒否）。
. "$(dirname "$(realpath "$0")")/common.sh"
D=$(role_dir "$1") || exit 1
if [ -n "$3" ]; then atomic_write "$D" "$2" < "$(realpath "$3")"; else atomic_write "$D" "$2"; fi
