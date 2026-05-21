"use client";

import { useRef, useState, useEffect, useMemo, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  PointerLockControls,
  KeyboardControls,
  useKeyboardControls,
  Stars,
} from "@react-three/drei";
import * as THREE from "three";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OutputFile {
  name: string;
  label: string;
}

interface WorldViewerProps {
  panoramaUrl: string | null;
  outputs: OutputFile[];
  isOpen: boolean;
  onClose: () => void;
}

type CameraMode = "orbit" | "fps";

// ─── Constants ────────────────────────────────────────────────────────────────

const MOVE_SPEED = 8;
const SPRINT_MULT = 2.5;
const PLAYER_HEIGHT = 1.7;

const KEY_MAP = [
  { name: "forward",  keys: ["KeyW", "ArrowUp"] },
  { name: "back",     keys: ["KeyS", "ArrowDown"] },
  { name: "left",     keys: ["KeyA", "ArrowLeft"] },
  { name: "right",    keys: ["KeyD", "ArrowRight"] },
  { name: "up",       keys: ["Space"] },
  { name: "sprint",   keys: ["ShiftLeft", "ShiftRight"] },
];

// ─── Noise helper (no external dep) ──────────────────────────────────────────

function noise(x: number, z: number): number {
  return (
    Math.sin(x * 0.08) * 4 +
    Math.sin(z * 0.09 + 0.4) * 3 +
    Math.sin((x + z) * 0.05) * 6 +
    Math.sin(x * 0.18 + z * 0.12) * 1.5 +
    Math.sin(z * 0.22) * 1.2
  );
}

// ─── Panorama sky dome ────────────────────────────────────────────────────────

function PanoramaSky({ url }: { url: string }) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(img.naturalWidth || 1024, 2048);
      canvas.height = Math.min(img.naturalHeight || 512, 1024);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const tex = new THREE.CanvasTexture(canvas);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      setTexture(tex);
    };
    img.crossOrigin = "anonymous";
    img.src = url;
  }, [url]);

  if (!texture) return null;

  return (
    <mesh renderOrder={-1}>
      <sphereGeometry args={[490, 64, 32]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} depthWrite={false} />
    </mesh>
  );
}

// ─── Procedural terrain ───────────────────────────────────────────────────────

function Terrain() {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(400, 400, 120, 120);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setZ(i, noise(x, z));
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }, []);

  return (
    <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshStandardMaterial
        color="#2a4a2e"
        roughness={0.95}
        metalness={0}
        vertexColors={false}
      />
    </mesh>
  );
}

// ─── Scattered trees (instanced) ─────────────────────────────────────────────

function Trees({ count = 80 }: { count?: number }) {
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const leafRef  = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    if (!trunkRef.current || !leafRef.current) return;
    const mat = new THREE.Matrix4();
    const rng = mulberry32(42);

    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const r = 15 + rng() * 160;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const y = noise(x, z);
      const scale = 0.8 + rng() * 1.2;
      const height = 2.5 * scale;

      mat.makeScale(0.18 * scale, height, 0.18 * scale);
      mat.setPosition(x, y + height / 2, z);
      trunkRef.current.setMatrixAt(i, mat);

      mat.makeScale(1.4 * scale, 1.8 * scale, 1.4 * scale);
      mat.setPosition(x, y + height + 0.7 * scale, z);
      leafRef.current.setMatrixAt(i, mat);
    }
    trunkRef.current.instanceMatrix.needsUpdate = true;
    leafRef.current.instanceMatrix.needsUpdate = true;
  }, [count]);

  return (
    <>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, count]} castShadow>
        <cylinderGeometry args={[1, 1, 1, 6]} />
        <meshStandardMaterial color="#5c3a1e" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={leafRef} args={[undefined, undefined, count]} castShadow>
        <coneGeometry args={[1, 1, 7]} />
        <meshStandardMaterial color="#1a4a1e" roughness={0.9} />
      </instancedMesh>
    </>
  );
}

// ─── Scattered rocks (instanced) ─────────────────────────────────────────────

function Rocks({ count = 50 }: { count?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    if (!ref.current) return;
    const mat = new THREE.Matrix4();
    const rng = mulberry32(99);

    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const r = 8 + rng() * 170;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const y = noise(x, z);
      const s = 0.2 + rng() * 0.8;
      mat.makeScale(s, s * 0.7, s);
      mat.setPosition(x, y + (s * 0.35), z);
      ref.current.setMatrixAt(i, mat);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  }, [count]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} castShadow>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#6b6b6b" roughness={0.85} metalness={0.05} />
    </instancedMesh>
  );
}

// ─── FPS player ───────────────────────────────────────────────────────────────

function FPSPlayer() {
  const { camera } = useThree();
  const [, get] = useKeyboardControls<keyof typeof KEY_MAP[0]>();
  const vel = useRef(new THREE.Vector3());
  const dir = useRef(new THREE.Vector3());

  // Start at a reasonable position
  useEffect(() => {
    camera.position.set(0, noise(0, 0) + PLAYER_HEIGHT, 0);
  }, [camera]);

  useFrame((_, delta) => {
    const { forward, back, left, right, up, sprint } = get() as Record<string, boolean>;
    const speed = MOVE_SPEED * (sprint ? SPRINT_MULT : 1);

    dir.current.set(
      (right ? 1 : 0) - (left ? 1 : 0),
      0,
      (back  ? 1 : 0) - (forward ? 1 : 0)
    ).normalize().multiplyScalar(speed * delta);

    // Move relative to camera's horizontal facing
    const flat = new THREE.Vector3();
    camera.getWorldDirection(flat);
    flat.y = 0;
    flat.normalize();
    const right3 = new THREE.Vector3().crossVectors(flat, camera.up).normalize();

    vel.current
      .copy(flat).multiplyScalar(-dir.current.z)
      .addScaledVector(right3, dir.current.x);

    camera.position.add(vel.current);

    if (up) camera.position.y += speed * delta * 0.6;

    // Clamp above terrain
    const groundY = noise(camera.position.x, camera.position.z) + PLAYER_HEIGHT;
    if (camera.position.y < groundY) camera.position.y = groundY;
  });

  return null;
}

// ─── Scene ────────────────────────────────────────────────────────────────────

function Scene({
  panoramaUrl,
  mode,
  onLockChange,
}: {
  panoramaUrl: string | null;
  mode: CameraMode;
  onLockChange: (locked: boolean) => void;
}) {
  const lockRef = useRef<React.ElementRef<typeof PointerLockControls>>(null);

  return (
    <>
      <fog attach="fog" args={["#1a2a1a", 40, 280]} />

      <ambientLight intensity={0.35} />
      <directionalLight
        position={[60, 80, 40]}
        intensity={1.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={300}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
      />
      <hemisphereLight args={["#87ceeb", "#2a4a2e", 0.4]} />

      {panoramaUrl ? (
        <PanoramaSky url={panoramaUrl} />
      ) : (
        <Stars radius={480} depth={50} count={4000} factor={5} fade />
      )}

      <Suspense fallback={null}>
        <Terrain />
        <Trees />
        <Rocks />
      </Suspense>

      {mode === "orbit" && (
        <OrbitControls
          target={[0, noise(0, 0), 0]}
          minDistance={2}
          maxDistance={200}
          maxPolarAngle={Math.PI / 2 - 0.02}
        />
      )}

      {mode === "fps" && (
        <>
          <PointerLockControls
            ref={lockRef}
            onLock={() => onLockChange(true)}
            onUnlock={() => onLockChange(false)}
          />
          <FPSPlayer />
        </>
      )}
    </>
  );
}

// ─── HUD overlay ─────────────────────────────────────────────────────────────

function HUD({
  mode,
  locked,
  onModeChange,
  onClose,
  outputCount,
}: {
  mode: CameraMode;
  locked: boolean;
  onModeChange: (m: CameraMode) => void;
  onClose: () => void;
  outputCount: number;
}) {
  return (
    <>
      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-2 z-10"
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-[#e0e7ff] font-semibold text-sm">🌍 World Viewer</span>
          {outputCount > 0 && (
            <span className="text-xs bg-emerald-900 border border-emerald-600 text-emerald-300 rounded-full px-2 py-0.5">
              {outputCount} asset{outputCount !== 1 ? "s" : ""} loaded
            </span>
          )}
          <span className="text-xs bg-[#1e1b4b] border border-[#4f46e5] text-[#a5b4fc] rounded-full px-2 py-0.5">
            Prototype
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex rounded-lg overflow-hidden border border-[#2d2f45]">
            {(["orbit", "fps"] as CameraMode[]).map((m) => (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                className="px-3 py-1 text-xs font-medium transition-colors"
                style={{
                  background: mode === m ? "#4f46e5" : "#12141f",
                  color: mode === m ? "white" : "#a5b4fc",
                }}
              >
                {m === "orbit" ? "🔭 Orbit" : "🚶 Explore"}
              </button>
            ))}
          </div>

          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1 text-xs font-medium transition-colors"
            style={{ background: "#3f0f0f", border: "1px solid #7f1d1d", color: "#fca5a5" }}
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* FPS crosshair */}
      {mode === "fps" && locked && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <svg width="24" height="24" viewBox="0 0 24 24">
            <line x1="12" y1="4" x2="12" y2="10" stroke="white" strokeWidth="1.5" strokeOpacity="0.8" />
            <line x1="12" y1="14" x2="12" y2="20" stroke="white" strokeWidth="1.5" strokeOpacity="0.8" />
            <line x1="4" y1="12" x2="10" y2="12" stroke="white" strokeWidth="1.5" strokeOpacity="0.8" />
            <line x1="14" y1="12" x2="20" y2="12" stroke="white" strokeWidth="1.5" strokeOpacity="0.8" />
            <circle cx="12" cy="12" r="1.5" fill="white" fillOpacity="0.8" />
          </svg>
        </div>
      )}

      {/* FPS click-to-start overlay */}
      {mode === "fps" && !locked && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center z-10 cursor-pointer"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
        >
          <div
            className="rounded-2xl px-8 py-6 text-center"
            style={{ background: "rgba(15,17,23,0.85)", border: "1px solid #2d2f45", maxWidth: 320 }}
          >
            <p className="text-2xl mb-2">🚶</p>
            <p className="text-[#e0e7ff] font-semibold mb-1">Explore Mode</p>
            <p className="text-xs text-[#a5b4fc] mb-4">Click anywhere to capture mouse and start walking</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-left text-xs text-[#6b7280] mb-4">
              <span><kbd className="bg-[#1e2030] px-1 rounded">W A S D</kbd> Move</span>
              <span><kbd className="bg-[#1e2030] px-1 rounded">Mouse</kbd> Look</span>
              <span><kbd className="bg-[#1e2030] px-1 rounded">Space</kbd> Rise</span>
              <span><kbd className="bg-[#1e2030] px-1 rounded">Shift</kbd> Sprint</span>
              <span className="col-span-2"><kbd className="bg-[#1e2030] px-1 rounded">Esc</kbd> Release mouse</span>
            </div>
          </div>
        </div>
      )}

      {/* Orbit mode hint */}
      {mode === "orbit" && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div
            className="rounded-full px-4 py-1.5 text-xs text-[#6b7280] flex gap-4"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
          >
            <span><strong className="text-[#a5b4fc]">Drag</strong> rotate</span>
            <span><strong className="text-[#a5b4fc]">Scroll</strong> zoom</span>
            <span><strong className="text-[#a5b4fc]">Right-drag</strong> pan</span>
          </div>
        </div>
      )}

      {/* FPS controls hint (when locked) */}
      {mode === "fps" && locked && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div
            className="rounded-full px-4 py-1.5 text-xs text-[#6b7280]"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
          >
            <span><strong className="text-[#a5b4fc]">Esc</strong> release mouse · <strong className="text-[#a5b4fc]">Shift</strong> sprint</span>
          </div>
        </div>
      )}
    </>
  );
}

// ─── World Viewer (public) ────────────────────────────────────────────────────

export default function WorldViewer({ panoramaUrl, outputs, isOpen, onClose }: WorldViewerProps) {
  const [mode, setMode] = useState<CameraMode>("orbit");
  const [locked, setLocked] = useState(false);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setMode("orbit");
      setLocked(false);
    }
  }, [isOpen]);

  // Esc closes when in orbit mode
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mode === "orbit") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, mode, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "#0a0f0a" }}
    >
      <KeyboardControls map={KEY_MAP}>
        <Canvas
          shadows
          camera={{ fov: 75, near: 0.1, far: 600, position: [0, 10, 30] }}
          gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
          style={{ flex: 1 }}
        >
          <Suspense fallback={null}>
            <Scene
              panoramaUrl={panoramaUrl}
              mode={mode}
              onLockChange={setLocked}
            />
          </Suspense>
        </Canvas>
      </KeyboardControls>

      <HUD
        mode={mode}
        locked={locked}
        onModeChange={setMode}
        onClose={onClose}
        outputCount={outputs.length}
      />
    </div>
  );
}

// ─── Seeded RNG (no external dep) ────────────────────────────────────────────

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
