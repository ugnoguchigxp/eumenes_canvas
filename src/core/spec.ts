// 制作担当の宣言（要件と操作）。03 では型だけを置き、06 で正規化の関数を足す。

export interface Requirement { id: string; text: string }
export interface Control { kind: "key" | "pointer"; input: string; action: string; always: boolean }
export interface MakerSpec { requirements: Requirement[]; controls: Control[] }
