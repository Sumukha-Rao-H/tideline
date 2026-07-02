import * as THREE from 'three';
import type { MutableRefObject } from 'react';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { AUTO_DAY_SPEED, DAY_STOPS, easeInOut, sampleDay, sunDirAt, type DayState, type TimeIdx } from '@/lib/dayCycle';
import type { HotspotKey } from '@/lib/hotspots';
import type { Sky } from './sky';
import type { Ocean } from './ocean';
import type { River } from './river';
import type { Lighthouse } from './lighthouse';
import type { CamTween, SceneRegistry } from './types';

export interface AnimateDeps {
  root: HTMLDivElement;
  mount: HTMLDivElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  composer: EffectComposer;
  sky: Sky;
  ocean: Ocean;
  river: River;
  lighthouse: Lighthouse;
  reg: SceneRegistry;
  anchors: Record<HotspotKey, THREE.Vector3>;
  cur: DayState;
  // Mutable bridges between React state and the render loop.
  dayRef: MutableRefObject<number>;
  dayTargetRef: MutableRefObject<number>;
  autoRef: MutableRefObject<boolean>;
  timeIdxRef: MutableRefObject<TimeIdx>;
  tweenRef: MutableRefObject<CamTween | null>;
  focusTargetRef: MutableRefObject<THREE.Vector3 | null>;
  setTimeIdx: (i: TimeIdx) => void;
}

// The per-frame loop: ocean swell, boat drift, the day/night clock, palette
// application, camera tweens and hotspot projection. Returns a stop function.
export const startAnimateLoop = (d: AnimateDeps): (() => void) => {
  const { root, mount, scene, camera, controls, composer, sky, reg, cur, river } = d;
  const { ocean, oceanUniforms, waterBase } = d.ocean;
  const { beamPivot, streakPivot, beamMat, streakMat, lhLight, lhSpot } = d.lighthouse;
  const { hemi, sun, starMat, sunSprite, moonSprite } = sky;

  let mounted = true;
  let raf = 0;

  const clock = new THREE.Clock();
  const tmpV = new THREE.Vector3();
  const sunVec = new THREE.Vector3();
  const moonVec = new THREE.Vector3();
  const wWhite = new THREE.Color(0xffffff);

  const animate = () => {
    if (!mounted) return;
    raf = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const et = clock.elapsedTime;

    // ocean: gentle vertex swell + shader-driven foam/depth tracking the day cycle
    const wpos = ocean.geometry.attributes.position as THREE.BufferAttribute;
    const warr = wpos.array as Float32Array;
    for (let i = 0; i < wpos.count; i++) { const ix = i * 3; const x = waterBase[ix], z = waterBase[ix + 2]; warr[ix + 1] = Math.sin(x * 0.05 + et * 0.9) * 0.12 + Math.cos(z * 0.06 + et * 0.7) * 0.12; }
    wpos.needsUpdate = true; ocean.geometry.computeVertexNormals();
    oceanUniforms.uTime.value = et;
    oceanUniforms.uShallow.value.copy(cur.water).lerp(wWhite, 0.25);
    oceanUniforms.uDeep.value.copy(cur.water).multiplyScalar(0.7);

    // river + lake water — same rippling treatment as the ocean
    for (const rw of river.riverWaters) {
      const pos = rw.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array, b = rw.base;
      for (let i = 0; i < pos.count; i++) { const ix = i * 3; arr[ix + 1] = b[ix + 1] + (Math.sin(b[ix] * 0.18 + et * 1.4) + Math.cos(b[ix + 2] * 0.22 + et * 1.1)) * 0.5 * rw.amp; }
      pos.needsUpdate = true;
      if (rw.lit) rw.mesh.geometry.computeVertexNormals();
    }

    // river flow streaks + waterfall foam + mist spray
    river.flowTex.offset.y -= dt * 0.45;
    river.fallTex.offset.y -= dt * 1.7;
    river.spray.forEach((m, i) => (m.opacity = 0.24 + 0.12 * Math.sin(et * 3 + i * 1.7)));
    river.riverMats.forEach((m) => m.color.copy(cur.water).lerp(river.riverTint, 0.12));

    // moving boats
    reg.movingBoats.forEach((b) => {
      const a = et * b.sp + b.ph;
      const x = b.cx + Math.cos(a) * b.rx, z = b.cz + Math.sin(a) * b.rz;
      const x2 = b.cx + Math.cos(a + 0.04) * b.rx, z2 = b.cz + Math.sin(a + 0.04) * b.rz;
      b.m.position.set(x, 0.7 + Math.sin(et * 1.5 + b.ph) * 0.06, z);
      b.m.rotation.y = Math.atan2(x2 - x, z2 - z);
    });

    // ---- advance the day/night clock ----
    let day = d.dayRef.current;
    if (d.autoRef.current) {
      day = (day + dt * AUTO_DAY_SPEED) % 1; // a full cycle when auto-running
      d.dayTargetRef.current = day;
      // keep the time pills lit on whichever preset is nearest
      let best = 0;
      let bd = 9;
      for (let i = 0; i < DAY_STOPS.length; i++) {
        let dd = Math.abs(DAY_STOPS[i] - day);
        dd = Math.min(dd, 1 - dd);
        if (dd < bd) { bd = dd; best = i; }
      }
      if (best !== d.timeIdxRef.current) { d.timeIdxRef.current = best as TimeIdx; d.setTimeIdx(best as TimeIdx); }
    } else {
      let diff = d.dayTargetRef.current - day;
      diff -= Math.round(diff); // travel the short way around the clock
      day = (day + diff * (1 - Math.exp(-dt * 1.5)) + 1) % 1;
    }
    d.dayRef.current = day;
    sampleDay(day, cur);

    // ---- place the sun & moon, light from whichever is up ----
    sunDirAt(day, sunVec);
    moonVec.copy(sunVec).negate();
    const keyVec = sunVec.y >= -0.04 ? sunVec : moonVec; // hand off near the horizon
    sun.position.copy(keyVec).multiplyScalar(200);
    sun.color.copy(cur.keyCol);
    sun.intensity = cur.keyI;

    // ---- apply the sampled palette ----
    root.style.background = 'linear-gradient(180deg,' + cur.sky0.getStyle() + ' 0%,' + cur.sky1.getStyle() + ' 76%)';
    hemi.color.copy(cur.hemiSky); hemi.groundColor.copy(cur.hemiGround); hemi.intensity = cur.hemiI;
    scene.fog!.color.copy(cur.fog);
    reg.lampMats.forEach((m) => (m.emissiveIntensity = cur.lamps * 1.4));
    reg.windowMats.forEach((m) => (m.emissiveIntensity = cur.lamps * 1.1));
    reg.glowSprites.forEach((m) => (m.opacity = cur.lamps * 0.9));
    starMat.opacity = cur.stars;
    lhLight.intensity = cur.lamps * 2.6;
    // sweep the lighthouse beam across the bay and fade it with the day cycle
    const beamSweep = 0.3 + Math.sin(et * 0.3) * 0.7;
    beamPivot.rotation.y = beamSweep;
    streakPivot.rotation.y = beamSweep;
    beamMat.opacity = cur.lamps * 0.7;
    streakMat.opacity = cur.lamps * 0.85;
    lhSpot.intensity = cur.lamps * 2.4;
    sunSprite.position.copy(sunVec).multiplyScalar(760);
    (sunSprite.material as THREE.SpriteMaterial).color.copy(cur.keyCol);
    (sunSprite.material as THREE.SpriteMaterial).opacity = cur.sunGlow;
    moonSprite.position.copy(moonVec).multiplyScalar(760);
    (moonSprite.material as THREE.SpriteMaterial).opacity = cur.moonGlow;

    // camera: intro/explore tween takes priority over hotspot focus
    const tw = d.tweenRef.current;
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const e = easeInOut(tw.t);
      camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
      controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
      if (tw.t >= 1) {
        d.tweenRef.current = null;
        tw.onDone?.();
      }
    } else if (d.focusTargetRef.current) {
      controls.target.lerp(d.focusTargetRef.current, 1 - Math.exp(-dt * 4));
      if (controls.target.distanceTo(d.focusTargetRef.current) < 0.05) d.focusTargetRef.current = null;
    }

    controls.update();
    composer.render();

    // project hotspots
    const cw = mount.clientWidth, ch = mount.clientHeight;
    const nodes = root.querySelectorAll<HTMLElement>('[data-hotspot]');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const key = el.dataset.hotspot as HotspotKey | undefined;
      if (!key) continue;
      const a = d.anchors[key];
      if (!a) continue;
      tmpV.copy(a).project(camera);
      const on = tmpV.z < 1 && tmpV.x >= -1.05 && tmpV.x <= 1.05 && tmpV.y >= -1.05 && tmpV.y <= 1.05;
      if (!on) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        continue;
      }
      el.style.opacity = '1';
      el.style.pointerEvents = '';
      el.style.transform = 'translate(' + (tmpV.x * 0.5 + 0.5) * cw + 'px,' + (-tmpV.y * 0.5 + 0.5) * ch + 'px)';
    }
  };
  animate();

  return () => {
    mounted = false;
    cancelAnimationFrame(raf);
  };
};
