# 応答者の道具の共通部。実行ディレクトリ（tools/ の親）とその RUN_NAME だけを使う。
HZ=$(dirname "$(dirname "$(realpath "${BASH_SOURCE[0]}")")")
RUN=$(cat "$HZ/RUN_NAME" 2>/dev/null)
role_dir() {
  if [ "$1" != gen ]; then
    echo "unknown role: $1 (gen)" >&2
    return 1
  fi
  echo "$HZ/solo/gen"
}
# atomic_write <dir> <id> : 標準入力の JSON を検証し、一時ファイル + mv で responses/<id>.json に置く。
atomic_write() {
  local d="$1/responses" id="$2" tmp
  [ -f "$1/requests/$id.json" ] || { echo "no such request: $id" >&2; return 1; }
  [ -e "$d/$id.json" ] && { echo "already answered: $id" >&2; return 1; }
  tmp="$d/.$id.$$.tmp"
  cat > "$tmp" && jq -e . "$tmp" >/dev/null || { echo "invalid JSON, not written" >&2; rm -f "$tmp"; return 1; }
  mv "$tmp" "$d/$id.json" && echo "written $id"
}
# defaults <request.json> : 要求の outputSchema の必須項目を、型ごとの空の値（null 可なら null、文字列 ""、配列 []、物 {}）で埋めた JSON。
defaults() {
  jq '.outputSchema as $s | def nullable: ((.type|type)=="array" and (.type|index("null"))) or ((.anyOf // []) | any(.type=="null"));
      def empty_of: if nullable then null else (if .type=="string" then "" elif .type=="array" then [] elif .type=="object" then {} elif .type=="boolean" then false elif (.type=="integer" or .type=="number") then 0 else null end) end;
      reduce ($s.required // [])[] as $k ({}; .[$k] = ($s.properties[$k] | empty_of))' "$1"
}
