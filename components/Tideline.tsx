'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createDayState, sampleDay, DAY_STOPS, type TimeIdx } from '@/lib/dayCycle';
import { sampleHeight, shoreZ } from '@/lib/terrainField';
import { createRng, SCENE_SEED } from '@/lib/rng';
import type { HotspotKey } from '@/lib/hotspots';
import { createRenderStack, SIDE_POS, SIDE_TARGET } from '@/scene/setup';
import { createSky } from '@/scene/sky';
import { createSharedMats } from '@/scene/materials';
import { createTerrain } from '@/scene/terrain';
import { createOcean } from '@/scene/ocean';
import { createRiver } from '@/scene/river';
import { createVegetation } from '@/scene/vegetation';
import { createStructures } from '@/scene/structures';
import { createLighthouse } from '@/scene/lighthouse';
import { createBeachProps } from '@/scene/beachProps';
import { startAnimateLoop } from '@/scene/animate';
import { createRegistry, type CamTween, type SceneCtx } from '@/scene/types';
import Nav from './ui/Nav';
import Hero from './ui/Hero';
import Hotspots from './ui/Hotspots';
import TimeControls from './ui/TimeControls';

export default function Tideline() {
  const [activeHotspot, setActiveHotspot] = useState<HotspotKey | null>(null);
  const [timeIdx, setTimeIdx] = useState<TimeIdx>(2);
  const [auto, setAuto] = useState(false);
  const [explored, setExplored] = useState(false);
  const [heroIn, setHeroIn] = useState(false);

  // Fade the hero in on mount (transition-driven, so the same opacity channel
  // can later fade it out smoothly in sync with the camera dive).
  useEffect(() => {
    const id = requestAnimationFrame(() => setHeroIn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Mutable bridges between React state and the render loop.
  const dayRef = useRef(DAY_STOPS[2]); // current day fraction (starts at Evening)
  const dayTargetRef = useRef(DAY_STOPS[2]); // where the clock is easing toward
  const focusTargetRef = useRef<THREE.Vector3 | null>(null);
  const anchorsRef = useRef<Record<HotspotKey, THREE.Vector3> | null>(null);
  const tweenRef = useRef<CamTween | null>(null);
  const exploreRef = useRef<() => void>(() => {});
  const autoRef = useRef(false);
  const timeIdxRef = useRef<TimeIdx>(2);

  useEffect(() => {
    autoRef.current = auto;
  }, [auto]);

  const setTime = useCallback((i: TimeIdx) => {
    timeIdxRef.current = i;
    setTimeIdx(i);
    dayTargetRef.current = DAY_STOPS[i];
  }, []);

  const startExplore = useCallback(() => {
    setExplored(true);
    setActiveHotspot('marina');
    exploreRef.current();
  }, []);

  // ===================== THREE.JS SCENE =====================
  useEffect(() => {
    const mount = mountRef.current;
    const root = rootRef.current;
    if (!mount || !root) return;

    const { renderer, scene, camera, controls, composer } = createRenderStack(mount);

    const cur = createDayState();
    sampleDay(dayRef.current, cur);

    const reg = createRegistry();
    const sky = createSky(scene, cur, dayRef.current, reg);

    // ===================== WORLD (procedural coastline — design map) =====================
    const world = new THREE.Group();
    scene.add(world);
    const ctx: SceneCtx = {
      world,
      dummy: new THREE.Object3D(),
      rng: createRng(SCENE_SEED),
      reg,
      mats: createSharedMats(reg),
      addGlow: sky.addGlow,
    };

    createTerrain(ctx);
    const ocean = createOcean(ctx, cur);
    createVegetation(ctx);
    const structures = createStructures(ctx);
    const lighthouse = createLighthouse(ctx);
    const river = createRiver(ctx, cur);
    createBeachProps(ctx);

    // ---- hotspot anchors ----
    const anchors: Record<HotspotKey, THREE.Vector3> = {
      marina: new THREE.Vector3(-36, 4, structures.pz + 6),
      lighthouse: new THREE.Vector3(70, 9, lighthouse.lz),
      promenade: new THREE.Vector3(12, sampleHeight(12, shoreZ(12) - 5) + 3, shoreZ(12) - 5),
      grove: new THREE.Vector3(structures.grove.gx, structures.grove.gy + 4.6, structures.grove.gz),
      falls: river.fallsAnchor.clone(),
    };
    anchorsRef.current = anchors;

    // Kick off the cinematic zoom from the top-down map into the side view.
    exploreRef.current = () => {
      if (tweenRef.current) return;
      controls.enabled = false;
      focusTargetRef.current = null;
      tweenRef.current = {
        fromPos: camera.position.clone(),
        toPos: SIDE_POS.clone(),
        fromTarget: controls.target.clone(),
        toTarget: SIDE_TARGET.clone(),
        t: 0,
        dur: 2.0,
        onDone: () => {
          controls.enabled = true;
        },
      };
    };

    // Dev helper: press "L" to print the current camera + target as paste-ready
    // Vector3 literals, for hand-tuning the TOP_POS / SIDE_POS framings. (Hit
    // "Explore the map" first so OrbitControls is enabled and you can fly around.)
    const onKeyLog = (e: KeyboardEvent) => {
      if (e.key !== 'l' && e.key !== 'L') return;
      const p = camera.position, t = controls.target;
      const f = (v: THREE.Vector3) => `new THREE.Vector3(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
      console.log(`POS    ${f(p)}\nTARGET ${f(t)}\n(dist ${p.distanceTo(t).toFixed(1)})`);
    };
    window.addEventListener('keydown', onKeyLog);

    const stopLoop = startAnimateLoop({
      root, mount, scene, camera, controls, composer,
      sky, ocean, river, lighthouse, reg, anchors, cur,
      dayRef, dayTargetRef, autoRef, timeIdxRef, tweenRef, focusTargetRef,
      setTimeIdx,
    });

    const onResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      stopLoop();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyLog);
      controls.dispose();
      composer.renderTarget1.dispose();
      composer.renderTarget2.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setTime]);

  // ===================== OVERLAY =====================
  const onHotspotEnter = (key: HotspotKey) => setActiveHotspot(key);
  const onHotspotClick = (key: HotspotKey) => setActiveHotspot((prev) => (prev === key ? null : key));
  const onHotspotArrow = (key: HotspotKey) => {
    setActiveHotspot(key);
    if (anchorsRef.current) focusTargetRef.current = anchorsRef.current[key].clone();
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: 'linear-gradient(180deg,#1f3168 0%,#f0915a 76%)',
      }}
    >
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />

      <div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none' }}>
        <Nav />
        <Hero heroIn={heroIn} explored={explored} onExplore={startExplore} />
        <Hotspots activeHotspot={activeHotspot} onEnter={onHotspotEnter} onClick={onHotspotClick} onArrow={onHotspotArrow} />

        {/* BOTTOM LEFT: hint */}
        <div style={{ position: 'absolute', left: 36, bottom: 36, display: 'flex', alignItems: 'center', gap: 16, pointerEvents: 'auto' }}>
          <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,.5)', letterSpacing: '.02em' }}>
            {explored ? 'Drag to look around · scroll to zoom' : 'Hit explore to dive in'}
          </span>
        </div>

        <TimeControls timeIdx={timeIdx} auto={auto} onTime={setTime} onToggleAuto={() => setAuto((a) => !a)} />
      </div>
    </div>
  );
}
