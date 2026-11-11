// Prompts and the public visual checkpoints are copied individually by the runner.
// Expected pixels and reference implementations are used only by the grader.
import type { ArtworkBody } from "../../src/contract/artwork";

type Group = "new" | "modify" | "repair" | "nongame";
type Action = string | number | { hold: string; ms: number };
type Pixel = [x: number, y: number, color: string];
type Check = { name: string; actions: Action[]; pixels: Pixel[] };
export interface VisionTask {
  id: string;
  group: Group;
  request: string;
  keys: string[];
  visual: string;
  reference: ArtworkBody;
  base?: ArtworkBody;
  negative?: ArtworkBody;
  checks: Check[];
}

const C = { black:"#000000", gray:"#808080", white:"#ffffff", red:"#ff0000", green:"#00ff00", blue:"#0000ff", yellow:"#ffff00", cyan:"#00ffff", magenta:"#ff00ff", orange:"#ff8000", won:"#003000" } as const;
const { black, gray, white, red, green, blue, yellow, cyan, magenta, orange, won } = C;
const colors = `const {black,gray,white,red,green,blue,yellow,cyan,magenta,orange,won}=${JSON.stringify(C)};`;
const art = (title: string, code: string): ArtworkBody => ({
  title,
  entry: `canvasApp.start(api=>{
    ${colors}
    const c=api.ctx;
    const rect=(color,x,y,w=40,h=w)=>{c.fillStyle=color;c.fillRect(x,y,w,h)};
    const bg=(color=black)=>rect(color,0,0,api.width,api.height);
    const tile=(x,y,color)=>rect(color,60+x*48,100+y*48);
    const hud=(i,color)=>rect(color,20+i*20,20,12,12);
    ${code}
  });`,
});
const at = (x: number,y: number,color: string): Pixel => [x,y,color];
const t = (x: number,y: number,color: string) => at(80+x*48,120+y*48,color);
const h = (i: number,color: string) => at(25+i*20,25,color);
const b = (color: string) => at(5,5,color);
const p = (name: string, actions: Action[], ...pixels: Pixel[]): Check => ({ name, actions, pixels });
const U = "ArrowUp", D = "ArrowDown", L = "ArrowLeft", R = "ArrowRight", S = "Space", reset = "KeyR";
const board = "背景は黒 #000000。マスの左上は (60+48×列番号, 100+48×行番号)、番号は0始まり、各40×40pxで隙間は黒。";
const hud = "表示マスは左上 (20+20×番号,20) の12×12px、番号は0始まり。";
const code = (parts: string[]) => parts.join(" ");
const play = (state: string, draw: string, input: string, tick = "") => code([
  state, `return {frame(t,dt){${tick}${draw}},input(e){${input}}};`,
]);
const down = 'if(e.type!=="keydown")return;const k=e.code;';
const edit = (title: string, initial: string, from: string, to: string) => {
  if (!initial.includes(from)) throw new Error(`対照の置換元がない: ${title}`);
  return { base: art(title,initial), reference: art(title,initial.replace(from,to)) };
};

const slide = play(
  'const start=[0,1,2,5,3,4],palette=[red,green,blue,orange,magenta,gray];let a=start.slice(),finished=false;',
  'bg(finished?won:black);a.forEach((v,i)=>tile(i%3,Math.floor(i/3),palette[v]));',
  down + 'if(k==="KeyR"){a=start.slice();finished=false;return}if(finished)return;const i=a.indexOf(5);let j=-1;if(k==="ArrowLeft"&&i%3>0)j=i-1;if(k==="ArrowRight"&&i%3<2)j=i+1;if(k==="ArrowUp"&&i>=3)j=i-3;if(k==="ArrowDown"&&i<3)j=i+3;if(j<0)return;[a[i],a[j]]=[a[j],a[i]];finished=a.every((v,n)=>v===n);',
);
const charge = play(
  'let time=0,held=false,result=0;',
  'bg(result===1?won:result===-1?"#400000":black);for(let i=0;i<3;i++)hud(i,time>=(i+1)*200?yellow:gray);tile(0,0,cyan);',
  'if(e.type==="keydown"&&e.code==="KeyR"){time=0;held=false;result=0;return}if(e.code!=="Space"||result)return;if(e.type==="keydown")held=true;if(e.type==="keyup"&&held){held=false;result=time>=600?1:-1}',
  'if(held&&!result)time=Math.min(600,time+dt);',
);
const mirror = play(
  'let a=false,b=false,wonGame=false;',
  'bg(wonGame?won:black);tile(0,0,a?cyan:gray);tile(1,0,b?cyan:gray);tile(2,0,a&&b?yellow:a||b?orange:gray);',
  down + 'if(k==="KeyR"){a=b=wonGame=false;return}if(wonGame)return;if(k==="Digit1")a=!a;if(k==="Digit2")b=!b;if(k==="Enter"&&a&&b)wonGame=true;',
);
const columns = play(
  'let a=Array(12).fill(0),turn=1,win=0;const color=[gray,red,blue];',
  'bg(win?won:black);a.forEach((v,i)=>tile(i%4,Math.floor(i/4),color[v]));hud(0,color[win||turn]);',
  down + 'if(k==="KeyR"){a.fill(0);turn=1;win=0;return}if(win)return;const x=Number(k.slice(-1))-1;if(!/^Digit[1-4]$/.test(k))return;let y=2;while(y>=0&&a[y*4+x])y--;if(y<0)return;a[y*4+x]=turn;for(let i=0;i<12;i++)for(const [dx,dy] of [[1,0],[0,1],[1,1],[-1,1]]){const xx=i%4,yy=Math.floor(i/4),xx2=xx+2*dx,yy2=yy+2*dy;if(xx2>=0&&xx2<4&&yy2<3&&[0,1,2].every(n=>a[(yy+n*dy)*4+xx+n*dx]===turn))win=turn}if(!win)turn=3-turn;',
);
const undoBase = play(
  'let x=0,a=false,b=false,history=[];',
  'bg(x===4?won:black);for(let i=0;i<5;i++)tile(i,0,gray);if(!a)tile(1,0,red);if(!b)tile(3,0,blue);tile(x,0,green);hud(0,a?red:gray);hud(1,b?blue:gray);',
  down + 'if(k==="KeyR"){x=0;a=b=false;history=[];return}if(x===4)return;let n=x+(k==="ArrowRight"?1:k==="ArrowLeft"?-1:0);if(n===x||n<0||n>4||(n===4&&!(a&&b)))return;history.push([x,a,b]);x=n;if(x===1)a=true;if(x===3)b=true;',
);
const rover = play(
  'let x=60,d=1,paused=false;',
  'bg();rect(green,x,100,30,30);hud(0,gray);',
  down + 'if(k==="KeyR"){x=60;d=1;paused=false;}',
  'x+=d*dt/10;if(x>=300){x=300;d=-1}if(x<=60){x=60;d=1}',
);
const slots = play(
  'const palette=[red,blue,cyan];let a=[0,1,2],i=0,copy=null;',
  'bg();a.forEach((v,j)=>tile(j,0,palette[v]));hud(i,yellow);',
  down + 'if(k==="KeyR"){a=[0,1,2];i=0;copy=null;return}if(k==="ArrowRight")i=(i+1)%3;if(k==="ArrowLeft")i=(i+2)%3;if(k==="Space")a[i]=(a[i]+1)%3;',
);
const door = play(
  'let x=0,remaining=0;',
  'bg();for(let i=0;i<4;i++)tile(i,0,gray);tile(2,0,remaining>0?cyan:red);tile(x,0,green);',
  down + 'if(k==="KeyR"){x=0;remaining=0;return}if(k==="Space"&&x===1)remaining=500;const n=x+(k==="ArrowRight"?1:k==="ArrowLeft"?-1:0);if(n>=0&&n<=3&&(n!==2||remaining>0))x=n;',
  'remaining=Math.max(0,remaining-dt);',
);
const tanks = play(
  'let a=3,b=1;',
  'bg();for(let i=0;i<3;i++){hud(i,i<a?cyan:gray);hud(i+4,i<b?magenta:gray)}',
  down + 'if(k==="KeyR"){a=3;b=1}if(k==="ArrowRight"&&a>0){a--;b=Math.min(3,b+1)}if(k==="ArrowLeft"&&b>0&&a<3){b--;a++}',
);
const portals = play(
  'let x=0,turns=0;',
  'bg();for(let i=0;i<6;i++)tile(i,0,i===1||i===4?cyan:gray);tile(x,0,green);for(let i=0;i<Math.min(5,turns);i++)hud(i,white);',
  down + 'if(k==="KeyR"){x=0;turns=0;return}const n=x+(k==="ArrowRight"?1:k==="ArrowLeft"?-1:0);if(n<0||n>5||n===x)return;turns++;x=n;if(x===1)x=4;if(x===4)x=1;',
);
const shield = play(
  'let hp=3,paused=false,acc=0;',
  'bg();for(let i=0;i<3;i++)hud(i,i<hp?green:gray);tile(0,0,paused?yellow:cyan);',
  down + 'if(k==="KeyR"){hp=3;acc=0;paused=false;}if(k==="KeyP")paused=!paused;',
  'acc+=dt;if(acc>=500){const n=Math.floor(acc/500);acc%=500;hp=Math.max(0,hp-n)}',
);
const exit = play(
  'let x=0,key=false,wonGame=false;',
  'bg(wonGame?won:black);for(let i=0;i<5;i++)tile(i,0,gray);if(!key)tile(1,0,yellow);tile(3,0,red);tile(4,0,cyan);tile(x,0,green);hud(0,key?yellow:gray);',
  down + 'if(k==="KeyR"){x=0;key=wonGame=false;return}if(wonGame)return;let n=x+(k==="ArrowRight"?1:k==="ArrowLeft"?-1:k==="ArrowUp"&&x===2?2:0);if(n<0||n>4||n===x)return;if(n===3){key=false;return}if(n===4&&!key)return;x=n;if(x===1)key=true;if(x===4){key=false;wonGame=true}',
);
const chart = play(
  'let order=[0,1,2],sorted=false,selected=0;const heights=[50,140,90],palette=[red,cyan,yellow];',
  'bg(white);order.forEach((id,i)=>{rect(palette[id],60+i*85,250-heights[id],45,heights[id]);if(id===selected)rect(black,60+i*85,258,45,5)});',
  down + 'if(k==="Digit1")selected=0;if(k==="Digit2")selected=1;if(k==="Digit3")selected=2;if(k==="KeyS"){sorted=!sorted;order=sorted?[1,2,0]:[0,1,2];}',
);

export const TASKS: VisionTask[] = [
  {id:"H-N1-slide",group:"new",request:`5枚のスライドパズル。${board} 上段は赤 #ff0000、緑 #00ff00、青 #0000ff、下段は空き（灰 #808080）、橙 #ff8000、紫 #ff00ff。矢印は空きマスをその方向へ1つ動かし、隣接タイルと交換する。端の外への入力は無視。上段が初期順で、下段が橙、紫、空きになったら背景を濃緑 #003000 にし、操作を止める。Rで初期化。`,
    keys:[L,R,R],visual:"下段は左から橙、紫、灰色で、背景は濃い緑。",reference:art("スライド",slide),
    negative:art("スライド不良",slide.replace('if(k==="ArrowRight"&&i%3<2)','if(k==="ArrowRight"&&i%3<1)')),
    checks:[p("初期",[L],t(0,0,red),t(1,0,green),t(2,0,blue),t(0,1,gray),t(1,1,orange),t(2,1,magenta)),p("縦移動",[U],t(0,0,gray),t(0,1,red)),p("逆操作",[D,R],b(black),t(0,1,orange),t(1,1,gray)),p("解決",[R],b(won),t(0,1,orange),t(1,1,magenta),t(2,1,gray)),p("終了固定と再開",[L],t(2,1,gray)),p("リセット",[reset],b(black),t(0,1,gray))]},
  {id:"H-N2-charge",group:"new",request:`Spaceの長押しで充電するゲーム。${board}${hud} 水色 #00ffff のマーカーを(0,0)に置く。表示マス0〜2は未充電なら灰 #808080。押し始めから200、400、600msに1つずつ黄 #ffff00 になる。離した時に600ms以上なら背景は濃緑 #003000、未満なら暗赤 #400000 にする。離した時点の表示を固定し、Rを押すまで操作を止める。Rは初期状態に戻す。時間はフレームのdtを使う。`,
    keys:[S],visual:"短いSpace入力のあと、背景が暗い赤で、左上の充電マス3つは灰色。",reference:art("充電",charge),
    negative:art("充電不良",charge.replace("time>=600?1:-1","time>=200?1:-1")),
    checks:[p("開始",[],b(black),h(0,gray),h(2,gray),t(0,0,cyan)),p("中途失敗",[{hold:S,ms:450}],b("#400000"),h(0,yellow),h(1,yellow),h(2,gray)),p("結果の固定",[{hold:S,ms:750}],b("#400000"),h(2,gray)),p("満充電",[reset,{hold:S,ms:650}],b(won),h(0,yellow),h(1,yellow),h(2,yellow)),p("再初期化",[reset],b(black),h(0,gray),h(2,gray))]},
  {id:"H-N3-mirror",group:"new",request:`2枚の鏡を合わせる光学パズル。${board} 横3マスの左2つは鏡、右はセンサー。初期はすべて灰 #808080。数字1と2でそれぞれの鏡を灰と水色 #00ffff の間で切り替える。センサーは水色の鏡が0、1、2枚のとき順に灰、橙 #ff8000、黄 #ffff00。Enterは鏡が2枚とも水色のときだけ成功し、背景を濃緑 #003000 にして鏡の入力を止める。Rで初期化。`,
    keys:["Digit1","Enter","Digit2","Enter","Digit1"],visual:"成功後の画面で背景が濃緑、鏡2枚が水色、センサーが黄色。",reference:art("鏡",mirror),
    negative:art("鏡不良",mirror.replace('k==="Enter"&&a&&b','k==="Enter"&&(a||b)')),
    checks:[p("片側は成功しない",["Digit2","Enter"],b(black),t(0,0,gray),t(1,0,cyan),t(2,0,orange)),p("反転と途中表示",["Digit2"],t(2,0,gray)),p("揃えるだけでは終了しない",["Digit1","Digit2"],b(black),t(2,0,yellow)),p("成功と固定",["Enter","Digit1","Digit2"],b(won),t(0,0,cyan),t(1,0,cyan),t(2,0,yellow)),p("再開",[reset],b(black),t(0,0,gray),t(2,0,gray))]},
  {id:"H-N4-columns",group:"new",request:`2人で遊ぶ三目落とし。${board} 4列×3行。未使用は灰 #808080、先手は赤 #ff0000、後手は青 #0000ff。数字1〜4で対応する列の最下段の空きに置く。満杯の列では手番を変えない。縦・横・斜めに同じ色が3枚連続すると背景を濃緑 #003000 にし、Rまで置けない。${hud} 0番は通常は次の手番、勝利後は勝者の色。Rで盤面と手番を初期化。`,
    keys:["Digit1","Digit2","Digit1","Digit2","Digit1"],visual:"第1列の3枚が赤で勝利し、背景が濃緑、左上の表示も赤。",reference:art("三目落とし",columns),
    negative:art("斜めなし",columns.replace("[[1,0],[0,1],[1,1],[-1,1]]","[[1,0],[0,1]]")),
    checks:[p("重力と手番",["Digit1","Digit2"],t(0,2,red),t(1,2,blue),h(0,red)),p("縦勝ちと停止",["Digit1","Digit2","Digit1","Digit4"],b(won),t(0,0,red),t(3,2,gray),h(0,red)),p("満杯の無視",[reset,"Digit1","Digit1","Digit1","Digit1"],b(black),t(0,0,red),h(0,blue)),p("横勝ち",[reset,"Digit1","Digit4","Digit2","Digit4","Digit3"],b(won),t(0,2,red),t(1,2,red),t(2,2,red)),p("斜め勝ち",[reset,"Digit1","Digit2","Digit2","Digit3","Digit4","Digit3","Digit3"],b(won),t(0,2,red),t(1,1,red),t(2,0,red),h(0,red))]},
  {id:"H-M1-undo",group:"modify",request:"Zキーで1手ずつ取り消せるようにしてください。移動位置だけでなく、拾った赤と青の物と左上の表示も、最後の移動前に戻してください。取り消しは複数回でき、開始状態では無反応です。勝利後もZで勝利直前の状態へ戻れます。矢印の動き、拾い方、両方集めて出口に着くルール、Rは維持してください。",
    keys:[R,R,"KeyZ","KeyZ"],visual:"右を2回、Zを2回のあと、緑の自機は左端で、左上の2個の所持表示は灰色。",...edit("収集",undoBase,'if(x===4)return;', 'if(k==="KeyZ"){if(history.length)[x,a,b]=history.pop();return}if(x===4)return;'),
    checks:[p("拾う",[R,R,R],t(3,0,green),h(0,red),h(1,blue)),p("青を戻す",["KeyZ"],t(2,0,green),t(3,0,blue),h(0,red),h(1,gray)),p("赤を戻す",["KeyZ","KeyZ","KeyZ"],t(0,0,green),t(1,0,red),h(0,gray)),p("勝利",[R,R,R,R],b(won),t(4,0,green)),p("勝利を取り消す",["KeyZ"],b(black),t(3,0,green),h(1,blue)),p("Rで戻る",[reset],t(0,0,green),h(0,gray))]},
  {id:"H-M2-rover",group:"modify",request:"Pで移動を一時停止／再開し、停止中は位置を固定してください。左上の表示は停止中だけ黄 #ffff00、通常は灰色です。Spaceで進行方向を反転し、停止中に反転した場合は再開時にその方向に動いてください。速さ、両端の反射、初期位置、緑の形、Rでの初期化は維持してください。",
    keys:["KeyP",S],visual:"停止中の左上表示が黄色で、緑の四角は初期位置にある。",...edit("往復車",rover,
      'x+=d*dt/10;if(x>=300){x=300;d=-1}if(x<=60){x=60;d=1}bg();rect(green,x,100,30,30);hud(0,gray);},input(e){if(e.type!=="keydown")return;const k=e.code;',
      'if(!paused){x+=d*dt/10;if(x>=300){x=300;d=-1}if(x<=60){x=60;d=1}}bg();rect(green,x,100,30,30);hud(0,paused?yellow:gray);},input(e){if(e.type!=="keydown")return;const k=e.code;if(k==="KeyP")paused=!paused;if(k==="Space")d=-d;'),
    checks:[p("速度",[800],at(145,110,green),at(80,110,black)),p("停止",["KeyP",650],h(0,yellow),at(145,110,green)),p("停止中の反転",[S,400],h(0,yellow),at(145,110,green)),p("逆向きへ再開",["KeyP",500],h(0,gray),at(100,110,green),at(155,110,black)),p("リセット",[reset],at(65,110,green),h(0,gray))]},
  {id:"H-M3-copy",group:"modify",request:"Cで選択中の色をコピーし、Vで現在の選択マスへ貼り付けられるようにしてください。コピーは色の値を覚え、元のマスの色をSpaceで変えても覚えた色は変わりません。まだコピーしていないときのVは無視し、Rはコピーも消してください。矢印の循環、Spaceでの色変更、色と配置は維持してください。",
    keys:["KeyC",S,R,"KeyV",R,"KeyV"],visual:"左のマスは青、残り2つは赤、選択表示は3番目。",...edit("色のスロット",slots,'if(k==="Space")a[i]=(a[i]+1)%3;', 'if(k==="Space")a[i]=(a[i]+1)%3;if(k==="KeyC")copy=a[i];if(k==="KeyV"&&copy!==null)a[i]=copy;'),
    checks:[p("空の貼付",["KeyV"],t(0,0,red),t(1,0,blue),t(2,0,cyan)),p("値を保持",["KeyC",S,R,"KeyV"],t(0,0,blue),t(1,0,red),h(1,yellow)),p("複数回貼付",[R,"KeyV"],t(2,0,red),h(2,yellow)),p("循環",[R],h(0,yellow)),p("再開でコピー消去",[reset,R,"KeyV"],t(1,0,blue),t(2,0,cyan),h(1,yellow))]},
  {id:"H-M4-window",group:"modify",request:"Spaceで扉を開ける場所は今のまま、開いている時間を500msから900msに延長してください。開いたときは左上の(20,20)に黄色 #ffff00 の12×12pxの四角を表示し、閉まったら消してください。Spaceで開け直すとその時点から900msです。扉の色、開閉時の通行条件、矢印の操作、Rを維持してください。",
    keys:[R,S],visual:"左上に黄色の表示があり、緑の自機の右側に水色の開いた扉がある。",...edit("時限扉",door,
      'tile(2,0,remaining>0?cyan:red);tile(x,0,green);},input(e){if(e.type!=="keydown")return;const k=e.code;if(k==="KeyR"){x=0;remaining=0;return}if(k==="Space"&&x===1)remaining=500;',
      'tile(2,0,remaining>0?cyan:red);tile(x,0,green);if(remaining>0)hud(0,yellow);},input(e){if(e.type!=="keydown")return;const k=e.code;if(k==="KeyR"){x=0;remaining=0;return}if(k==="Space"&&x===1)remaining=900;'),
    checks:[p("閉鎖",[R,R],t(1,0,green),t(2,0,red),h(0,black)),p("延長",[S,650],t(2,0,cyan),h(0,yellow)),p("開け直す",[S,650,R,R],t(3,0,green),h(0,yellow)),p("期限後通れない",[350,L],t(3,0,green),t(2,0,red),h(0,black)),p("R",[reset],t(0,0,green),t(2,0,red))]},
  {id:"H-R1-tanks",group:"repair",request:"右のタンクが満杯でも右矢印を押すと左の量だけが減る不具合を直してください。受け側が満杯、または送り側が空なら、どちらの量も変えません。両方向に1回1目盛り、上限3、量を示す色と位置、Rで左3・右1に戻る動きを維持してください。",
    keys:[R,R,R],visual:"右を3回押したあと、左に水色が1目盛り、右に紫が3目盛り。",...edit("移送",tanks,'k==="ArrowRight"&&a>0','k==="ArrowRight"&&a>0&&b<3'),
    checks:[p("初期",[],h(2,cyan),h(4,magenta),h(5,gray)),p("満杯を越えない",[R,R,R],h(0,cyan),h(1,gray),h(4,magenta),h(6,magenta)),p("逆方向の満杯",[L,L,L],h(2,cyan),h(4,magenta),h(5,gray)),p("Rで戻る",[R,reset],h(2,cyan),h(5,gray))]},
  {id:"H-R2-portals",group:"repair",request:"左の水色の入口に入っても同じ手で右から左へ戻ってしまいます。矢印で水色のマスへ入ったら、反対側の水色のマスへ一度だけ移動するようにしてください。到着した次の矢印では普通に隣へ動けます。矢印1回の歩数表示は1だけ、表示の色、端、Rの初期化は維持してください。",
    keys:[R,R],visual:"右矢印2回のあと、緑の自機は6マスの右端にあり、白い歩数表示は2個。",...edit("転送口",portals,'if(x===1)x=4;if(x===4)x=1;','if(x===1)x=4;else if(x===4)x=1;'),
    checks:[p("左から右へ",[R],t(4,0,green),t(1,0,cyan),h(0,white),h(1,black)),p("到着後に進める",[R],t(5,0,green),h(1,white),h(2,black)),p("反対方向へ戻る",[L],t(1,0,green),h(2,white)),p("端の拒否",[L,L],t(0,0,green),h(3,white),h(4,black)),p("R",[reset],t(0,0,green),h(0,black))]},
  {id:"H-R3-shield",group:"repair",request:"Pで一時停止中にもシールドが減るので修正してください。停止中はシールドと次の減少までの残り時間を維持します。再開後は停止直前の残り時間から続けてください。通常は500msごとに1段減って0で止まり、停止の黄表示とRの初期化は維持してください。",
    keys:["KeyP"],visual:"停止中を示す黄色の四角と、緑のシールド3目盛りが見える。",...edit("シールド",shield,'acc+=dt;if(acc>=500)','if(!paused)acc+=dt;if(acc>=500)'),
    checks:[p("初期",[],t(0,0,cyan),h(2,green)),p("停止中固定",[350,"KeyP",1200],t(0,0,yellow),h(2,green)),p("再開直後はまだ3",["KeyP",80],t(0,0,cyan),h(2,green)),p("残りの時間だけ進める",[130],h(1,green),h(2,gray)),p("0下限",[1800],h(0,gray)),p("R",[reset],t(0,0,cyan),h(2,green))]},
  {id:"H-R4-exit",group:"repair",request:"赤い通れないマスに進もうとしたとき、移動できないのに所持した鍵だけ消える不具合を直してください。赤いマスは今までどおり通れず、鍵は水色の出口へ入れたときだけ消費します。矢印の動き、黄色い鍵の取得、所持表示、Rを維持してください。",
    keys:[R,R,R],visual:"赤い壁の左のマスに緑の自機が止まり、左上の鍵表示は黄色のまま。",...edit("出口の鍵",exit,'if(n===3){key=false;return}','if(n===3)return;'),
    checks:[p("鍵を拾う",[R],h(0,yellow),t(1,0,green)),p("移動拒否で鍵を保持",[R,R,R],h(0,yellow),t(2,0,green),t(3,0,red),t(4,0,cyan)),p("上矢印で壁を飛び越え出口で消費",[U],b(won),t(4,0,green),h(0,gray)),p("Rで初期化",[reset],b(black),h(0,gray),t(1,0,yellow),t(4,0,cyan))]},
  {id:"H-V1-order",group:"nongame",request:"Sで棒を高さの降順に切り替えるとき、選択の下線も同じ系列の移動先へ追従するようにしてください。さらにRで並びと選択の両方を初期状態に戻してください。数字キーによる系列の選択、降順と元の順序の切替、3本の色、高さ、背景は維持してください。",
    keys:["Digit3","KeyS"],visual:"白い背景。左から水色、黄色、赤の順で、黒い下線は中央の黄色に付く。",...edit("系列順",chart,'if(k==="Digit1")selected=0;','if(k==="KeyR"){sorted=false;order=[0,1,2];selected=0;return}if(k==="Digit1")selected=0;'),
    checks:[p("配置",[ "Digit3"],b(white),at(80,220,red),at(165,140,cyan),at(250,180,yellow),at(250,260,black)),p("並び替え",["KeyS"],at(80,140,cyan),at(165,180,yellow),at(250,220,red),at(165,260,black),at(250,260,white)),p("元の並びへ",["KeyS"],at(250,260,black)),p("再度並び替えてからR",["KeyS",reset],at(80,220,red),at(80,260,black),at(165,260,white),at(250,260,white))]},
];
