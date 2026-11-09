// 乾式の確認（dry-run.ts）で使う、JSON Schema を満たす最小の値。制作の中身は作らない。
export function fill(schema: any, hint = "確認"): unknown {
  if (!schema || typeof schema !== "object") return null;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf) return fill(schema.anyOf.find((s: any) => s.type !== "null") ?? schema.anyOf[0], hint);
  if (schema.oneOf) return fill(schema.oneOf[0], hint);
  const t = Array.isArray(schema.type) ? schema.type.find((x: string) => x !== "null") : schema.type;
  if (t === "object") {
    const o: Record<string, unknown> = {};
    for (const k of schema.required ?? []) o[k] = fill(schema.properties?.[k], hint);
    return o;
  }
  if (t === "array") return Array.from({ length: schema.minItems ?? 0 }, () => fill(schema.items, hint));
  if (t === "string") return hint.padEnd(schema.minLength ?? 1, "。");
  if (t === "integer" || t === "number") return schema.minimum ?? 0;
  if (t === "boolean") return false;
  return null;
}
