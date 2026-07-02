import * as THREE from 'three';
import { oceanField } from '@/lib/terrainField';
import type { DayState } from '@/lib/dayCycle';
import type { SceneCtx } from './types';

export interface Ocean {
  ocean: THREE.Mesh;
  oceanUniforms: {
    uTime: { value: number };
    uShallow: { value: THREE.Color };
    uDeep: { value: THREE.Color };
    uFoam: { value: THREE.Color };
  };
  waterBase: Float32Array;
}

// ---- ocean (animated swell + depth tint + rolling shoreline wave foam) ----
// Each vertex carries its `oField` (the same signed coast field the terrain
// uses): 0 at the waterline, growing seaward. The fragment shader turns that
// into a depth gradient plus a foam band whose position oscillates in and out
// over time — waves washing up and receding on the sand.
export const createOcean = (ctx: SceneCtx, cur: DayState): Ocean => {
  const oceanGeo = new THREE.PlaneGeometry(1500, 1500, 110, 110); oceanGeo.rotateX(-Math.PI / 2);
  const oPos = oceanGeo.attributes.position;
  const oField = new Float32Array(oPos.count);
  for (let i = 0; i < oPos.count; i++) oField[i] = oceanField(oPos.getX(i), oPos.getZ(i));
  oceanGeo.setAttribute('oField', new THREE.Float32BufferAttribute(oField, 1));
  const oceanUniforms = {
    uTime: { value: 0 },
    uShallow: { value: cur.water.clone().lerp(new THREE.Color(0xffffff), 0.25) },
    uDeep: { value: cur.water.clone().multiplyScalar(0.7) },
    uFoam: { value: new THREE.Color(0xeef4ff) },
  };
  const oceanMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.18, metalness: 0.25, transparent: true, opacity: 0.97, flatShading: true });
  oceanMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = oceanUniforms.uTime;
    sh.uniforms.uShallow = oceanUniforms.uShallow;
    sh.uniforms.uDeep = oceanUniforms.uDeep;
    sh.uniforms.uFoam = oceanUniforms.uFoam;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n attribute float oField;\n varying float vO;\n varying vec2 vXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vO = oField;\n vXZ = vec2(position.x, position.z);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n uniform float uTime;\n uniform vec3 uShallow;\n uniform vec3 uDeep;\n uniform vec3 uFoam;\n varying float vO;\n varying vec2 vXZ;')
      .replace('#include <color_fragment>', `#include <color_fragment>
         float depthT = smoothstep(0.0, 70.0, vO);
         vec3 wbase = mix(uShallow, uDeep, depthT);
         float wash = 8.0 + 5.0 * sin(uTime * 0.7 + vXZ.x * 0.03 + vXZ.y * 0.02);
         float swash = smoothstep(wash, wash - 5.0, vO) * smoothstep(-3.0, 1.5, vO);
         float ripple = 0.55 + 0.45 * sin(vO * 1.1 - uTime * 3.0 + vXZ.x * 0.05);
         float edge = (1.0 - smoothstep(0.0, 2.4, vO)) * 0.5;
         float foam = clamp(swash * ripple + edge, 0.0, 1.0);
         diffuseColor.rgb = mix(wbase, uFoam, foam);`);
  };
  const ocean = new THREE.Mesh(oceanGeo, oceanMat); ocean.position.y = -0.2; ocean.receiveShadow = true; ctx.world.add(ocean);
  const waterBase = (oceanGeo.attributes.position.array as Float32Array).slice();
  return { ocean, oceanUniforms, waterBase };
};
