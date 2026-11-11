// Evaluation only. Sample documented interiors, and use the same input schedule in both conditions.
import { blob, hex, type CheckResult, type EvalEnv } from "../lib/env";
import type { ReplayTask } from "./suite";

type Input = [key: "key" | "down" | "up", code: string] | [click: "click", x: number, y: number] | [wait: "wait", ms: number];
type Pixel = [x: number, y: number, color: string];
type Check = { name: string; after: Input[]; pixels: Pixel[]; center?: [color: string, x: number, tolerance: number] };
const k = (code: string): Input => ["key", code];
const click = (x: number, y: number): Input => ["click", x, y];
const wait = (ms: number): Input => ["wait", ms];
const left = k("ArrowLeft"), right = k("ArrowRight"), space = k("Space"), reset = k("KeyR");
const black = "#000000", gray = "#808080", green = "#00ff00", red = "#ff0000", blue = "#0080ff";
const cyan = "#00ffff", yellow = "#ffff00", white = "#ffffff", won = "#003000";
const at = (x: number, y: number, color: string): Pixel => [x, y, color];
const row = (x: number, y: number, step: number, colors: string[]): Pixel[] => colors.map((c, i) => at(x + i * step, y, c));
const box = (x: number, y: number, w: number, h: number, color: string, outside: string): Pixel[] => [
  at(x,y,color), at(x+w-1,y+h-1,color), at(x-1,y,outside), at(x+w,y+h-1,outside), at(x,y+h,outside),
];
const test = (name: string, after: Input[], pixels: Pixel[], center?: Check["center"]): Check => ({ name, after, pixels, center });
const light = (...colors: string[]) => row(56, 116, 60, colors);
const score = (...colors: string[]) => row(25, 25, 14, colors);
const route = (...colors: string[]) => row(54, 114, 60, colors);
const flags = (...colors: string[]) => row(85, 115, 50, colors);
const grid = (...colors: string[]) => row(78, 134, 36, colors);
const barrier = (...colors: string[]) => row(55, 135, 60, colors);
const bg = (color: string) => at(5, 5, color);
const choose = (...colors: string[]) => row(66, 145, 60, colors);
const initialOrder = [red, green, blue, cyan];
const order = (i: number) => click(76 + i * 60, 136);
const toggle = (i: number) => click(56 + i * 60, 116);

const wrap = (color: string) => [
  test("初期", [], choose(color, gray, gray, gray, gray)),
  test("左端の外へ回らない", [left], choose(color, gray, gray, gray, gray)),
  test("右へ1マス", [right], choose(gray, color, gray, gray, gray)),
  test("右端の外へ回らない", [right,right,right,right], choose(gray, gray, gray, gray, color)),
];

export const CHECKS: Record<string, Check[][]> = {
  "F-N1-lights": [[
    test("初期と背景", [], [bg(black), ...light(gray,yellow,yellow,yellow,gray), ...box(40,100,32,32,gray,black), ...box(100,100,32,32,yellow,black)]),
    test("外側のクリック", [click(14,40)], light(gray,yellow,yellow,yellow,gray)),
    test("端で反転しても外側へ回らない", [toggle(0)], light(yellow,gray,yellow,yellow,gray)),
    test("同じ操作で元に戻る", [toggle(0)], light(gray,yellow,yellow,yellow,gray)),
    test("中央でクリア", [toggle(2)], [bg(won),...light(gray,gray,gray,gray,gray)]),
    test("クリア後停止", [toggle(1)], [bg(won),...light(gray,gray,gray,gray,gray)]),
    test("Rで初期化", [reset], [bg(black),...light(gray,yellow,yellow,yellow,gray)]),
  ]],
  "F-N2-order": [[
    test("初期ボタンと進捗", [], [bg(black),...initialOrder.flatMap((c,i)=>box(60+i*60,120,32,32,c,black)),...score(black,black)]),
    test("3番の正解と外側無視", [order(2),click(15,70)], [...box(20,20,10,10,white,black),...score(white,black)]),
    test("1番で2手目", [order(0)], score(white,white,black)),
    test("順番を間違えたら0", [order(1)], [bg(black),...score(black,black)]),
    test("正しい順でクリア", [order(2),order(0),order(3),order(1)], [bg(won),...score(white,white,white,white)]),
    test("クリア後停止", [order(2)], [bg(won),...score(white,white,white,white)]),
    test("Rでリセット", [reset], [bg(black),...score(black,black)]),
  ]],
  "F-N3-warehouse": [[
    test("外周と初期配置", [], [bg(black),at(114,98,white),at(114,170,white),...grid(white,green,"#ff8000",gray,blue,white)]),
    test("壁を通れない", [k("ArrowUp"),left], grid(white,green,"#ff8000",gray,blue,white)),
    test("箱を1マス押す", [right], grid(white,gray,green,"#ff8000",blue,white)),
    test("箱がゴールでクリア", [right], [bg(won),...grid(white,gray,gray,green,"#ff8000",white)]),
    test("クリア後停止", [left], [bg(won),at(186,134,green)]),
    test("Rでリセット", [reset], [bg(black),...grid(white,green,"#ff8000",gray,blue,white)]),
  ]],
  "F-N4-reaction": [[
    test("初期", [], [bg(black),...box(100,90,60,60,red,black)]),
    test("赤で失敗", [wait(900),space], [bg("#400000"),at(120,110,red)]),
    test("失敗結果を保持", [wait(300),space], [bg("#400000"),at(120,110,red)]),
    test("Rで再開、まだ赤", [reset,wait(900)], [bg(black),at(120,110,red)]),
    test("1秒後に緑", [wait(200)], [bg(black),at(120,110,green)]),
    test("緑で成功", [space], [bg(won),at(120,110,green)]),
    test("成功後停止", [wait(1100),space], [bg(won),at(120,110,green)]),
  ]],
  "F-M1-wrap": [wrap(cyan),wrap(yellow)],
  "F-M2-route": [[
    test("初期と履歴なし", [k("KeyZ"),left], [bg(black),...route(green,gray,gray,gray,gray)]),
    test("往路を青で保持", [right,right], route(blue,blue,green,gray,gray)),
    test("1手戻る", [k("KeyZ")], route(blue,green,gray,gray,gray)),
    test("続けて戻れる", [k("KeyZ"),k("KeyZ")], route(green,gray,gray,gray,gray)),
    test("端で阻まれた操作を数えない", [right,right,right,right,right,k("KeyZ")], route(blue,blue,blue,green,gray)),
  ]],
  "F-M3-signal": [[
    test("開始時", [], [bg(black),at(115,100,red),at(175,100,gray)]),
    test("一時停止", [wait(350),space,wait(1100)], [at(115,100,red),at(175,100,yellow)]),
    test("再開直後は赤", [space,wait(70)], [at(115,100,red),at(175,100,gray)]),
    test("続きから緑へ", [wait(160)], [at(115,100,green),at(175,100,gray)]),
    test("周期を維持", [wait(500)], [at(115,100,red),at(175,100,gray)]),
  ]],
  "F-M4-flags": [[
    test("初期", [], [bg(black),...flags(gray,gray,gray,gray),...score(black,black)]),
    test("印と数が増える", [click(85,115),click(185,115)], [...flags(yellow,gray,yellow,gray),...score(white,white,black)]),
    test("クリックで外す", [click(85,115)], [...flags(gray,gray,yellow,gray),...score(white,black)]),
    test("Spaceで全消去", [space], [...flags(gray,gray,gray,gray),...score(black,black)]),
    test("消去後にも印をつけられる", [click(235,115)], [...flags(gray,gray,gray,yellow),...score(white,black)]),
  ]],
  "F-R1-counter": [[
    test("初期は3回で外側無視", [click(12,60)], [bg(black),at(100,125,gray),...score(yellow,yellow,yellow,black)]),
    test("1回のクリックで1つ", [click(100,125)], score(yellow,yellow,black)),
    test("次のクリック", [click(100,125)], score(yellow,black,black)),
    test("0で止まる", [click(100,125),click(100,125)], score(black,black,black)),
    test("Rで3回", [reset], score(yellow,yellow,yellow,black)),
  ]],
  "F-R2-pair": [[
    test("初期", [], [bg(black),...box(220,180,20,20,green,black)], [green,229.5,2]),
    test("両方で止まる", [["down","ArrowLeft"],["down","ArrowRight"],wait(200)], [], [green,229.5,3]),
    test("左だけ離して右へ動く", [["up","ArrowLeft"],wait(200)], [], [green,269.5,6]),
    test("両方を離して停止", [["up","ArrowRight"],wait(200)], [], [green,269.5,6]),
    test("今度は右を離して左へ動く", [["down","ArrowRight"],["down","ArrowLeft"],["up","ArrowRight"],wait(200)], [], [green,229.5,8]),
    test("左端の制限", [wait(1600),["up","ArrowLeft"]], [], [green,9.5,3]),
  ]],
  "F-R3-barrier": [[
    test("初期", [], [bg(black),...barrier(green,gray,red,gray)]),
    test("閉じた扉の手前で止まる", [right,right], barrier(gray,green,red,gray)),
    test("開く", [space], barrier(gray,green,cyan,gray)),
    test("開いた扉を通過できる", [right,right], barrier(gray,gray,cyan,green)),
    test("もう一度閉じると入れない", [left,left,space,right], barrier(gray,green,red,gray)),
  ]],
  "F-R4-checkpoint": [[
    test("初期", [], [bg(black),at(55,125,green),at(55,175,yellow)]),
    test("Spaceで設定", [right,right,space,right], [at(175,175,yellow),at(235,125,green)]),
    test("戻っても記録を保持", [reset], [at(175,125,green),at(175,175,yellow),at(55,175,gray)]),
    test("繰り返しても戻る", [left,reset], [at(175,125,green),at(175,175,yellow)]),
    test("設定を更新できる", [right,space,left,reset], [at(235,125,green),at(235,175,yellow),at(175,175,gray)]),
  ]],
  "F-V1-status": [[
    test("初期と配色", [], [bg(white),...box(45,80,80,40,green,white),...box(145,80,80,40,yellow,white),...box(245,80,80,40,red,white),...box(45,126,80,4,green,white)]),
    test("黄色に追従", [click(180,100)], [at(80,128,white),at(180,128,yellow)]),
    test("赤に追従", [click(280,100)], [at(180,128,white),at(280,128,red)]),
    test("Rで緑へ", [reset], [at(80,128,green),at(280,128,white)]),
  ]],
};

export async function gradeTurn(env: EvalEnv, task: ReplayTask, turn: number, entry: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  try {
    const ready = await env.start(entry, null, task.seed);
    if (ready.type !== "ready") return [{ id: "起動", kind: "start", pass: false, detail: JSON.stringify(ready) }];
    for (const check of CHECKS[task.id][turn]) {
      for (const step of check.after) {
        if (step[0] === "key") await env.press(step[1]);
        if (step[0] === "down") await env.down(step[1]);
        if (step[0] === "up") await env.up(step[1]);
        if (step[0] === "click") await env.click(step[1], step[2]);
        if (step[0] === "wait") await env.advance(step[1]);
      }
      await env.advance(0);
      const frame = await env.shot();
      const errors = check.pixels.flatMap(([x,y,color]) => {
        const offset = (y * frame.w + x) * 4;
        return hex(color).every((c,i) => Math.abs(frame.data[offset+i] - c) <= 12)
          ? [] : [`(${x},${y}) は #${frame.data.subarray(offset,offset+3).toString("hex")}、期待 ${color}`];
      });
      if (check.center) {
        const [color,x,tolerance] = check.center;
        const actual = blob(frame,hex(color),20).cx;
        if (!(Math.abs(actual-x) <= tolerance)) errors.push(`中心 x=${actual}、期待 ${x}±${tolerance}`);
      }
      results.push({ id: check.name, kind: "change", pass: errors.length === 0, ...(errors.length ? { detail: errors.join(" / ") } : {}) });
    }
    const errors = await env.collectErrors();
    if (errors.length) results.push({ id: "ブラウザエラー", kind: "retain", pass: false, detail: errors.join(" / ") });
    return results;
  } finally {
    await env.close();
  }
}
