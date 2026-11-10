// ホストが同梱する Three.js（固定版）。プレビューオリジンが IIFE に束ね、作品の前に連結する。
// 後処理のアドオン（EffectComposer・RenderPass・ShaderPass・UnrealBloomPass・OutputPass）を同じ束に入れ、THREE の名前で渡す（本体は 1 つ）。
// OrbitControls などは DOM の要素に聞き手を付けるので、Worker では動かない。入れない。
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
__canvasLibs.three = Object.assign({}, THREE, { EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass });
