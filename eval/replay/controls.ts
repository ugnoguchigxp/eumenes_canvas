import type { ArtworkBody } from "../../src/contract/artwork";
import { starts } from "./suite";

const replace = (art: ArtworkBody, before: string, after: string): ArtworkBody => {
  if (!art.entry.includes(before)) throw new Error(`対照の置換元が見つからない: ${art.title}`);
  return { ...art, entry: art.entry.replace(before, after) };
};
const control = (title: string, source: string): ArtworkBody => ({
  title,
  entry: `canvasApp.start(api=>{
    const c=api.ctx;
    const draw=(color,x,y,w,h)=>{c.fillStyle=color;c.fillRect(x,y,w,h)};
    const bg=(color="#000000")=>draw(color,0,0,api.width,api.height);
    ${source}
  });`,
});

const lights = control("灯り", `
  const initial=[false,true,true,true,false];
  let lights=initial.slice();
  return {
    frame(){bg(lights.some(Boolean)?"#000000":"#003000");lights.forEach((on,i)=>draw(on?"#ffff00":"#808080",40+60*i,100,32,32))},
    input(e){if(e.type==="keydown"&&e.code==="KeyR")lights=initial.slice();
      if(e.type!=="pointerdown"||e.y<100||e.y>=132||!lights.some(Boolean))return;
      const i=Math.floor((e.x-40)/60);if(i<0||i>=5||e.x>=72+60*i)return;
      for(let j=Math.max(0,i-1);j<=Math.min(4,i+1);j++)lights[j]=!lights[j]}
  };`);
const order = control("順番", `
  const colors=["#ff0000","#00ff00","#0080ff","#00ffff"],order=[2,0,3,1];
  let n=0;
  return {
    frame(){bg(n===4?"#003000":"#000000");colors.forEach((color,i)=>draw(color,60+60*i,120,32,32));for(let i=0;i<n;i++)draw("#ffffff",20+14*i,20,10,10)},
    input(e){if(e.type==="keydown"&&e.code==="KeyR")n=0;
      if(e.type!=="pointerdown"||e.y<120||e.y>=152||n===4)return;
      const i=Math.floor((e.x-60)/60);if(i>=0&&i<4&&e.x<92+60*i)n=i===order[n]?n+1:0}
  };`);
const warehouse = control("倉庫", `
  let p=1,b=2;
  return {
    frame(){bg(b===4?"#003000":"#000000");for(let y=0;y<3;y++)for(let x=0;x<6;x++){
      const color=y!==1||x===0||x===5?"#ffffff":x===p?"#00ff00":x===b?"#ff8000":x===4?"#0080ff":"#808080";
      draw(color,60+x*36,80+y*36,36,36);
    }},
    input(e){if(e.type!=="keydown")return;if(e.code==="KeyR"){p=1;b=2;return}if(b===4)return;
      const d=e.code==="ArrowRight"?1:e.code==="ArrowLeft"?-1:0;
      const next=p+d;if(!d||next<1||next>4)return;
      if(next===b){if(b+d<1||b+d>4)return;b+=d}p=next}
  };`);
const reaction = control("反応", `
  let ms=0,result=null;
  return {
    frame(t,dt){if(!result)ms+=dt;bg(result||"#000000");draw(ms>=1000?"#00ff00":"#ff0000",100,90,60,60)},
    input(e){if(e.type!=="keydown")return;if(e.code==="KeyR"){ms=0;result=null}
      else if(e.code==="Space"&&!result)result=ms>=1000?"#003000":"#400000"}
  };`);
const clamped = replace(replace(starts.wrap,"(i+1)%5","Math.min(i+1,4)"),"(i+4)%5","Math.max(i-1,0)");
const cyan = replace(clamped,"#00ff00","#00ffff");

export const GOOD: Record<string, ArtworkBody[]> = {
  "F-N1-lights": [lights],
  "F-N2-order": [order],
  "F-N3-warehouse": [warehouse],
  "F-N4-reaction": [reaction],
  "F-M1-wrap": [cyan,replace(cyan,"#00ffff","#ffff00")],
  "F-M2-route": [replace(starts.route,'const n=i+', 'if(e.code==="KeyZ"){if(trail.length)i=trail.pop();return}const n=i+')],
  "F-M3-signal": [replace(replace(starts.signal,"let ms=0;", "let ms=0,paused=false;"),'frame(t,dt){ms+=dt;bg();rect(Math.floor(ms/500)%2===0?"#ff0000":"#00ff00",90,80,50,50);rect("#808080",150,80,50,50)}', 'frame(t,dt){if(!paused)ms+=dt;bg();rect(Math.floor(ms/500)%2===0?"#ff0000":"#00ff00",90,80,50,50);rect(paused?"#ffff00":"#808080",150,80,50,50)},input(e){if(e.type==="keydown"&&e.code==="Space")paused=!paused}')],
  "F-M4-flags": [replace(replace(starts.flags,'70+j*50,100,30,30)}', '70+j*50,100,30,30);for(let i=0;i<marked.size;i++)rect("#ffffff",20+14*i,20,10,10)}'), 'if(e.type!=="pointerdown"', 'if(e.type==="keydown"&&e.code==="Space")marked.clear();if(e.type!=="pointerdown"')],
  "F-R1-counter": [replace(starts.wheel,"remaining-=2","remaining=Math.max(0,remaining-1)")],
  "F-R2-pair": [replace(starts.pair,'if(e.type==="keyup"&&(e.code==="ArrowLeft"||e.code==="ArrowRight"))left=right=false', 'if(e.type==="keyup"){if(e.code==="ArrowLeft")left=false;if(e.code==="ArrowRight")right=false}')],
  "F-R3-barrier": [replace(starts.barrier,'if(e.code==="ArrowRight"&&p<3)p++;\n      if(e.code==="ArrowLeft"&&p>0)p--', 'if(e.code==="ArrowRight"&&p<3&&(p!==1||open))p++;if(e.code==="ArrowLeft"&&p>0&&(p!==3||open))p--')],
  "F-R4-checkpoint": [replace(starts.checkpoint,"p=saved;saved=0","p=saved")],
  "F-V1-status": [replace(replace(starts.status,'rect("#000000",45+100*i', 'rect(["#00ff00","#ffff00","#ff0000"][i],45+100*i'), 'if(e.type==="pointerdown"', 'if(e.type==="keydown"&&e.code==="KeyR")i=0;if(e.type==="pointerdown"')],
};

// An independently written alternative for a legal update implementation.
export const ALTERNATIVE = replace(replace(reaction,"let ms=0,result=null;","let now=0,elapsed=0,zero=0,result=null;"),
  'if(!result)ms+=dt;bg(result||"#000000");draw(ms>=1000',
  'now=t;if(!result)elapsed=t-zero;bg(result||"#000000");draw(elapsed>=1000');
ALTERNATIVE.entry = ALTERNATIVE.entry.replace("ms=0;result=null","zero=now;elapsed=0;result=null").replace("result=ms>=1000","result=elapsed>=1000");

export const BROKEN: Record<string, ArtworkBody> = {
  "F-N1-lights": replace(lights,"Math.max(0,i-1)","i"),
  "F-N2-order": replace(order,"n+1:0","n+1:n"),
  "F-N3-warehouse": replace(warehouse,"if(!d||next<1","if(!d||next<0"),
  "F-N4-reaction": replace(reaction,"ms>=1000","ms>=2000"),
};
