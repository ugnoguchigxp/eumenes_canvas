// ホストが同梱するライブラリの固定版（実行契約 canvas-artwork/1 の任意項目 `libraries`）。
// 作品は使うライブラリを版付きの id で宣言し、プレビューは宣言されたものだけを作品の前に連結する。
// 通信・動的 import では読まない。版を上げるときは新しい id を足し、古い id は保存済み作品のために残す。

export interface HostLibrary {
  /** 作品が宣言する id（名前@版）。 */
  id: string;
  /** npm のパッケージ名と固定版（package.json は exact で固定）。 */
  pkg: string;
  version: string;
  /** 作品の関数本体に渡す引数名。 */
  param: string;
  /** プレビューが束ねる shim（src/preview/libs/ からの相対）。 */
  shim: string;
}

export const HOST_LIBRARIES: readonly HostLibrary[] = Object.freeze([
  { id: "three@0.187.0", pkg: "three", version: "0.187.0", param: "THREE", shim: "three.js" },
  { id: "cannon-es@0.20.0", pkg: "cannon-es", version: "0.20.0", param: "CANNON", shim: "cannon-es.js" },
]);

export const MAX_LIBRARIES = 4;

export function libraryById(id: string): HostLibrary | undefined {
  return HOST_LIBRARIES.find((l) => l.id === id);
}

/** 宣言の順ではなく登録の順に並べる（連結順と引数の順を宣言の書き方によらず一定にする）。 */
export function resolveLibraries(ids: readonly string[] | undefined): HostLibrary[] {
  if (!ids || !ids.length) return [];
  return HOST_LIBRARIES.filter((l) => ids.includes(l.id));
}
