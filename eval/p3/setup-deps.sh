#!/bin/bash
# P3 の依存（固定した commit）を /workspace/p3-deps/<名前>/ に展開して、依存を入れる。
# 既存の clone のブランチ・作業状態は変えない（fetch と git archive だけ）。clone が無ければ作り、push 先を無効にする。
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(jq -r .root "$HERE/deps.json")
mkdir -p "$ROOT"
for name in $(jq -r '.repos | keys[]' "$HERE/deps.json"); do
  url=$(jq -r ".repos[\"$name\"].url" "$HERE/deps.json")
  commit=$(jq -r ".repos[\"$name\"].commit" "$HERE/deps.json")
  clone=$(jq -r ".repos[\"$name\"].clone" "$HERE/deps.json")
  if [ ! -d "$clone/.git" ]; then git clone -q "$url" "$clone"; git -C "$clone" remote set-url --push origin DISABLED-no-push; fi
  git -C "$clone" cat-file -e "$commit^{commit}" 2>/dev/null || git -C "$clone" fetch -q origin
  dest="$ROOT/$name"
  if [ -f "$dest/.p3-commit" ] && [ "$(cat "$dest/.p3-commit")" = "$commit" ]; then echo "$name $commit（展開済み）"; continue; fi
  rm -rf "$dest"; mkdir -p "$dest"
  git -C "$clone" archive "$commit" | tar -x -C "$dest"
  (cd "$dest" && bun install --frozen-lockfile --production >/dev/null)
  echo "$commit" > "$dest/.p3-commit"
  echo "$name $commit を展開"
done
