#!/bin/bash
# show.sh [gen|rev] : この役割のいちばん古い未回答の要求を 1 件表示する（最大約 110 秒待つ）。
# 表示するのは: ホストからの通知（前の課題の結果。gen のみ）、要求の id・目的・再提出の理由・system・prompt・出力の形。
# ほかの役割や実行の記録は表示しない。待っても無ければ "no request yet"、実行器が終わっていれば "runner exited"。
. "$(dirname "$(realpath "$0")")/common.sh"
ROLE=${1:-gen}; D=$(role_dir "$ROLE") || exit 1
if [ "$ROLE" = gen ]; then
  for n in $(ls "$D"/notices/*.txt 2>/dev/null | sort); do
    b=$(basename "$n"); grep -qx "$b" "$D/.notices_seen" 2>/dev/null && continue
    echo "== notice (前の課題の結果)"; cat "$n"; echo; echo "$b" >> "$D/.notices_seen"
  done
fi
for i in $(seq 1 55); do
  for f in $(ls -tr "$D"/requests/*.json 2>/dev/null); do
    id=$(basename "$f" .json); [ -f "$D/responses/$id.json" ] && continue
    echo "== $id $(jq -r .purpose "$f")   (要求ファイル: $f)"
    if [ "$(jq -r '.retryOf // empty' "$f")" ]; then echo "-- RETRY of $(jq -r .retryOf "$f"): 前の応答は次の理由で受け付けられなかった:"; jq -c .previousError "$f"; fi
    echo "-- system"; jq -r '.system // empty' "$f"
    echo "-- prompt"; jq -r .prompt "$f"
    echo "-- 出力の形 (outputSchema)"; jq -c '.outputSchema|del(."$schema")' "$f"
    exit 0
  done
  if ! pgrep -f -- "--run-dir $HZ( |$)" >/dev/null; then echo "runner exited"; exit 0; fi
  sleep 2
done
echo "no request yet"
