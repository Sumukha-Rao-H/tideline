import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GammaCorrectionShader } from 'three/examples/jsm/shaders/GammaCorrectionShader.js';

// Camera framings: the scene opens looking straight down (a map) and zooms
// into a low, side-on three-quarter view when the visitor hits "Explore".
// Tuned to the large procedural coastline (terrain spans ~±460u; the lived-in
// coast sits around z≈24–86, mountains recede inland at negative z).
export const TOP_POS = new THREE.Vector3(16, 218, 50);
export const TOP_TARGET = new THREE.Vector3(0, 8, 22);
export const SIDE_POS = new THREE.Vector3(145, 58, 81);
export const SIDE_TARGET = new THREE.Vector3(0, 8, 22);

export interface RenderStack {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  composer: EffectComposer;
}

export const createRenderStack = (mount: HTMLDivElement): RenderStack => {
  const W = mount.clientWidth || window.innerWidth;
  const H = mount.clientHeight || window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(W, H);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.14; // golden-hour target (handover §1/§9)
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xe7b389, 200, 680); // distances for the big coastline; colour driven by the day cycle

  const camera = new THREE.PerspectiveCamera(42, W / H, 0.5, 3000);
  camera.position.copy(TOP_POS);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.copy(TOP_TARGET);
  controls.minDistance = 60;
  controls.maxDistance = 420;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = 1.45;
  controls.enablePan = false;
  controls.enabled = false; // locked during the top-down intro

  // ---- post-processing: bloom (handover §1, the biggest single lever) ----
  // THREE r128: no OutputPass / outputColorSpace, so the chain is
  // RenderPass → UnrealBloomPass → explicit sRGB gamma pass. RenderPass
  // tone-maps into a linear composer target; the GammaCorrectionShader
  // converts linear→sRGB. Threshold high / strength modest so only genuinely
  // bright things bloom (lamps, lighthouse lamp, sun glow, sun-kissed water).
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), 0.5, 0.55, 0.85);
  composer.addPass(bloomPass);
  composer.addPass(new ShaderPass(GammaCorrectionShader));

  return { renderer, scene, camera, controls, composer };
};
