// 性質の観測と検証担当の指摘。03 では型だけを置き、08 でほかを足す。

export interface ReviewFinding {
  source: "probe" | "evaluator";
  severity: "blocking" | "warning" | "info"; // blocking：直すべき。warning：直したほうがよい。info：参考
  id: string;
  message: string;
}
