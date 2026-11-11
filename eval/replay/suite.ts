// Fresh acceptance suite. Only task requests, starting works, and public datasets reach the maker.
import type { ArtworkBody } from "../../src/contract/artwork";

type Group = "new" | "modify" | "repair" | "nongame";
export interface ReplayTask {
  id: string;
  group: Group;
  seed: number;
  turns: string[];
  start?: ArtworkBody;
}

const art = (title: string, code: string): ArtworkBody => ({
  title,
  entry: `canvasApp.start(api => {
    const c=api.ctx;
    const rect=(color,x,y,w,h)=>{c.fillStyle=color;c.fillRect(x,y,w,h)};
    const bg=(color="#000000")=>rect(color,0,0,api.width,api.height);
    ${code}
  });`,
});

export const starts = {
  wrap: art("トークンの選択", `
    let i=0;
    return {
      frame(){bg();for(let j=0;j<5;j++)rect(j===i?"#00ff00":"#808080",50+j*60,130,32,32)},
      input(e){if(e.type==="keydown"){if(e.code==="ArrowRight")i=(i+1)%5;if(e.code==="ArrowLeft")i=(i+4)%5}}
    };`),
  route: art("経路の記録", `
    let i=0;const trail=[];
    return {
      frame(){bg();for(let j=0;j<5;j++)rect("#808080",40+j*60,100,28,28);for(const j of trail)rect("#0080ff",40+j*60,100,28,28);rect("#00ff00",40+i*60,100,28,28)},
      input(e){if(e.type!=="keydown")return;const n=i+(e.code==="ArrowRight"?1:e.code==="ArrowLeft"?-1:0);if(n===i||n<0||n>4)return;trail.push(i);i=n}
    };`),
  signal: art("信号機", `
    let ms=0;
    return {frame(t,dt){ms+=dt;bg();rect(Math.floor(ms/500)%2===0?"#ff0000":"#00ff00",90,80,50,50);rect("#808080",150,80,50,50)}};
  `),
  flags: art("マスの印", `
    const marked=new Set();
    return {
      frame(){bg();for(let j=0;j<4;j++)rect(marked.has(j)?"#ffff00":"#808080",70+j*50,100,30,30)},
      input(e){if(e.type!=="pointerdown"||e.y<100||e.y>=130)return;const j=Math.floor((e.x-70)/50);if(j>=0&&j<4&&e.x<100+j*50){if(marked.has(j))marked.delete(j);else marked.add(j)}}
    };`),
  wheel: art("残り回数", `
    let remaining=3;
    return {
      frame(){bg();rect("#808080",80,100,60,50);for(let i=0;i<remaining;i++)rect("#ffff00",20+i*14,20,10,10)},
      input(e){if(e.type==="pointerdown"&&e.x>=80&&e.x<140&&e.y>=100&&e.y<150)remaining-=2;if(e.type==="keydown"&&e.code==="KeyR")remaining=3}
    };`),
  pair: art("左右のキー", `
    let x=220;let left=false,right=false;
    return {
      frame(t,dt){x=Math.max(0,Math.min(api.width-20,x+(Number(right)-Number(left))*dt*0.2));bg();rect("#00ff00",x,180,20,20)},
      input(e){if(e.type==="keydown"){if(e.code==="ArrowLeft")left=true;if(e.code==="ArrowRight")right=true}
      if(e.type==="keyup"&&(e.code==="ArrowLeft"||e.code==="ArrowRight"))left=right=false}
    };`),
  barrier: art("扉の通行", `
    let p=0,open=false;
    return {
      frame(){bg();for(let i=0;i<4;i++)rect("#808080",40+i*60,120,30,30);rect(open?"#00ffff":"#ff0000",160,120,30,30);rect("#00ff00",40+p*60,120,30,30)},
      input(e){if(e.type!=="keydown")return;if(e.code==="Space"&&p===1)open=!open;
      if(e.code==="ArrowRight"&&p<3)p++;
      if(e.code==="ArrowLeft"&&p>0)p--}
    };`),
  checkpoint: art("チェックポイント", `
    let p=0,saved=0;
    return {
      frame(){bg();for(let i=0;i<5;i++)rect(i===saved?"#ffff00":"#808080",40+60*i,160,30,30);rect("#00ff00",40+60*p,110,30,30)},
      input(e){if(e.type!=="keydown")return;if(e.code==="ArrowRight")p=Math.min(4,p+1);
      if(e.code==="ArrowLeft")p=Math.max(0,p-1);if(e.code==="Space")saved=p;if(e.code==="KeyR"){p=saved;saved=0}}
    };`),
  status: art("稼働状態", `
    let i=0;
    return {
      frame(){bg("#ffffff");rect("#00ff00",45,80,80,40);rect("#ffff00",145,80,80,40);rect("#ff0000",245,80,80,40);rect("#000000",45+100*i,126,80,4)},
      input(e){if(e.type==="pointerdown"&&e.y>=80&&e.y<120){for(let j=0;j<3;j++)if(e.x>=45+100*j&&e.x<125+100*j)i=j}}
    };`),
};

export const REPLAY_TASKS: ReplayTask[] = [
  { id:"F-N1-lights", group:"new", seed:101, turns:[
    "横一列のライト消しゲームを作って。背景は黒 #000000。ライトは5個で各32×32px、左上は順に (40,100)、(100,100)、(160,100)、(220,100)、(280,100)。点灯は黄 #ffff00、消灯は灰 #808080。初期は2〜4番目だけ点灯。点灯・消灯にかかわらずライトをクリックするとそのライトと左右の隣だけを反転する。端は外側に回り込まない。全部消えたら背景を濃緑 #003000 にし、以後クリックを受け付けない。Rで初期状態に戻す。ライト以外のクリックは何も起こさない。",
  ]},
  { id:"F-N2-order", group:"new", seed:102, turns:[
    "順番当てゲームを作って。黒背景に32×32pxのボタン4個を左から (60,120)、(120,120)、(180,120)、(240,120) に描く。各左上座標。色は順に赤 #ff0000、緑 #00ff00、青 #0080ff、水色 #00ffff。クリックの正解順は左から3番、1番、4番、2番。正しいボタンを押すごとに、画面上端20px・左端20pxから白 #ffffff の10×10pxの四角を14pxピッチで1個ずつ追加。間違えたら途中の進捗を0に戻し、そのクリックは正解として数えない。4個そろったら背景を #003000 にしてクリックを止める。Rで初期に戻る。ボタン外クリックは無視。",
  ]},
  { id:"F-N3-warehouse", group:"new", seed:103, turns:[
    "箱押しの1面を作って。背景は黒。各36×36pxのマスを横6列・縦3行で隙間なし、左上は (60,80)。床を灰 #808080、外周の壁を白 #ffffff。中央の行の左から2番目に緑 #00ff00 の自機、3番目に橙 #ff8000 の箱、5番目に青 #0080ff のゴール。矢印キーを1回押すと1マス移動し、壁は通れない。箱を押すと箱の次のマスが空いている場合だけ箱と自機が1マス動く。箱がゴールに入ったら背景を #003000 にし、移動を止める。Rで最初から。箱と自機は各マス全体を塗る。",
  ]},
  { id:"F-N4-reaction", group:"new", seed:104, turns:[
    "反応ゲームを作って。黒背景。画面 (100,90) を左上とする60×60pxの信号が最初は赤 #ff0000、開始1秒後に緑 #00ff00 になる。赤のうちにSpaceを押したら失敗で背景を #400000。緑になってからSpaceを押したら成功で背景を #003000。結果が出たら信号の色はそのまま、Spaceを無視し、Rで赤・黒に戻して再開から1秒後に緑になる。",
  ]},
  { id:"F-M1-wrap", group:"modify", seed:111, start:starts.wrap, turns:[
    "左右端では反対側に回らず、その端にとどまるようにして。選択中の色は水色 #00ffff にして。他の表示や操作はそのまま。",
    "選択中の色だけ黄 #ffff00 にして。左右端でとどまる変更は維持して。",
  ]},
  { id:"F-M2-route", group:"modify", seed:112, start:starts.route, turns:[
    "Zキーで最後の移動1回を取り消して、位置と青の経路表示を移動前に戻せるようにして。何回か続けて取り消せる。取り消す履歴がないときは何も起こらない。矢印での移動と、描画の色・位置はそのまま。端で阻まれた移動は取り消しに含めない。",
  ]},
  { id:"F-M3-signal", group:"modify", seed:113, start:starts.signal, turns:[
    "Spaceを押すたびに、左の信号を一時停止・再開できるようにして。停止中は色と経過時間を固定し、再開後は停止直前の進み具合から続ける。500msの切り替え間隔と左の色は維持。右の灰色の四角は一時停止中だけ黄色 #ffff00 にして。",
  ]},
  { id:"F-M4-flags", group:"modify", seed:114, start:starts.flags, turns:[
    "Spaceを押したら4マスすべての印を消せるようにして。さらに印の数を左上 (20,20) から右へ14px間隔で、白 #ffffff の10×10pxの四角を1個ずつ並べて表示して。マスのクリックで印をつけたり外したりする動き、色、位置はそのまま。",
  ]},
  { id:"F-R1-counter", group:"repair", seed:121, start:starts.wheel, turns:[
    "灰色のボタンを1回クリックすると残り回数が2つ減ってしまう。1回に1つだけ減るように直して。残りが0のときはクリックしても0のままにする。ボタン外は無視。黄色い回数表示とRで3回に戻る動きはそのまま。",
  ]},
  { id:"F-R2-pair", group:"repair", seed:122, start:starts.pair, turns:[
    "左右を同時に押して片方だけ離すと、まだ押している方まで止まる。離したキーだけ解除し、押し続けている方に動くようにして。両方が押されている間に停止する動き、速度、端の制限、描画はそのまま。",
  ]},
  { id:"F-R3-barrier", group:"repair", seed:123, start:starts.barrier, turns:[
    "閉まっている赤い扉のマスにも移動できてしまう。扉が閉まっている間は入れず、開いて水色なら通れるように直して。Spaceは今までどおり左から2番目のマスで扉を切り替える。矢印で1マス動くことと、位置・色は維持。",
  ]},
  { id:"F-R4-checkpoint", group:"repair", seed:124, start:starts.checkpoint, turns:[
    "Rでチェックポイントに戻った直後にチェックポイント自体が消えてしまう。Rを何回押しても最後にSpaceで設定した地点へ戻るようにして。Spaceで別の地点に更新する動き、矢印移動、緑と黄の表示の位置・色は維持。",
  ]},
  { id:"F-V1-status", group:"nongame", seed:131, start:starts.status, turns:[
    "各ステータスの選択を示す黒い下線を、選んだ色の四角と同じ色にして。さらに R キーで左の緑に選択を戻せるようにして。白背景・3色の配置・四角の位置と大きさ、クリックによる選択、下線の位置と大きさは今のまま。",
  ]},
];
