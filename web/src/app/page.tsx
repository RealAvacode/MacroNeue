"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";

const WorldViewer = dynamic(() => import("@/components/WorldViewer"), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = "idle" | "generating-panorama" | "panorama-ready" | "worldgen-running" | "worldgen-done";

interface WorldgenStatus {
  stage: number;
  stageName: string;
  stageProgress: number;
  overallProgress: number;
  log: string;
  outputs: { name: string; label: string }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StageBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block bg-[#312e81] text-[#c7d2fe] rounded-full px-3 py-0.5 text-xs font-semibold uppercase tracking-wider mb-3">
      {children}
    </span>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#1a1d2e] border border-[#2d2f45] rounded-xl p-5 ${className}`}>
      {children}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 bg-[#1e2030] rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${Math.round(value * 100)}%`,
          background: "linear-gradient(90deg,#4f46e5,#7c3aed)",
        }}
      />
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block w-4 h-4 border-2 border-white/20 border-t-white rounded-full"
      style={{ animation: "spin 0.7s linear infinite" }}
    />
  );
}

// ─── Image thumbnail grid ─────────────────────────────────────────────────────

interface ImageGridProps {
  previews: string[];
  onRemove: (index: number) => void;
  onAdd: () => void;
  onDrop: (e: React.DragEvent) => void;
  dragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
}

function ImageGrid({ previews, onRemove, onAdd, onDrop, dragOver, onDragOver, onDragLeave }: ImageGridProps) {
  if (previews.length === 0) {
    return (
      <div
        className="rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all mb-4"
        style={{
          border: `2px dashed ${dragOver ? "#4f46e5" : "#2d2f45"}`,
          background: dragOver ? "rgba(79,70,229,0.06)" : "#12141f",
          minHeight: 160,
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onAdd}
      >
        <svg className="w-10 h-10 mb-2 opacity-40" fill="none" stroke="#a5b4fc" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M4 16l4-4a3 3 0 014 0l4 4M14 12l2-2a3 3 0 014 0l2 2M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-sm text-[#4a4e6e]">Drop images or click to upload</p>
        <p className="text-xs text-[#3d4166] mt-1">JPG, PNG, WEBP — multiple allowed</p>
      </div>
    );
  }

  return (
    <div
      className="mb-4 rounded-lg p-2 transition-all"
      style={{
        background: dragOver ? "rgba(79,70,229,0.06)" : "#12141f",
        border: `1px solid ${dragOver ? "#4f46e5" : "#2d2f45"}`,
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Count row */}
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs text-[#6366f1] font-medium">
          {previews.length} image{previews.length !== 1 ? "s" : ""} · first used for panorama
        </span>
        <button
          className="text-xs text-[#4a4e6e] hover:text-[#a5b4fc] transition-colors"
          onClick={onAdd}
        >
          + Add more
        </button>
      </div>

      {/* Thumbnail grid */}
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))" }}>
        {previews.map((src, i) => (
          <div key={src} className="relative group rounded-md overflow-hidden" style={{ aspectRatio: "1", background: "#0c0e18" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`Scene ${i + 1}`} className="w-full h-full object-cover" />

            {/* Primary badge */}
            {i === 0 && (
              <span className="absolute bottom-1 left-1 text-[9px] font-bold bg-[#4f46e5] text-white rounded px-1 py-0.5 leading-none">
                PRIMARY
              </span>
            )}

            {/* Remove button */}
            <button
              className="absolute top-1 right-1 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: "rgba(0,0,0,0.75)", width: 20, height: 20 }}
              onClick={(e) => { e.stopPropagation(); onRemove(i); }}
              title="Remove"
            >
              <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}

        {/* Add tile */}
        <button
          className="rounded-md flex flex-col items-center justify-center transition-colors cursor-pointer"
          style={{
            aspectRatio: "1",
            background: "#1a1d2e",
            border: "1px dashed #2d2f45",
          }}
          onClick={onAdd}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#4f46e5")}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#2d2f45")}
        >
          <svg className="w-5 h-5 text-[#4a4e6e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function Home() {
  const [stage, setStage] = useState<Stage>("idle");
  const [prompt, setPrompt] = useState("");
  const [seed, setSeed] = useState(42);
  const [steps, setSteps] = useState(30);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [panoramaUrl, setPanoramaUrl] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [wgStatus, setWgStatus] = useState<WorldgenStatus | null>(null);
  const [panoNote, setPanoNote] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  // ── Multi-image handling ──────────────────────────────────────────────────
  const addFiles = useCallback((incoming: FileList | File[]) => {
    const valid = Array.from(incoming).filter((f) => f.type.startsWith("image/"));
    if (!valid.length) return;
    setImageFiles((prev) => [...prev, ...valid]);
    setImagePreviews((prev) => [...prev, ...valid.map((f) => URL.createObjectURL(f))]);
    setStage("idle");
    setPanoramaUrl(null);
    setJobId(null);
    setWgStatus(null);
  }, []);

  const removeImage = useCallback((index: number) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  // ── Generate panorama ─────────────────────────────────────────────────────
  async function generatePanorama() {
    if (!imageFiles.length) return;
    setStage("generating-panorama");
    setPanoramaUrl(null);
    setPanoNote(null);

    const fd = new FormData();
    imageFiles.forEach((f, i) => fd.append(`image_${i}`, f));
    fd.append("imageCount", String(imageFiles.length));
    fd.append("prompt", prompt);
    fd.append("seed", String(seed));
    fd.append("steps", String(steps));

    const res = await fetch("/api/generate", { method: "POST", body: fd });
    const data = await res.json();

    setPanoramaUrl(data.panoramaUrl);
    setJobId(data.jobId);
    setPanoNote(data.note ?? null);
    setStage("panorama-ready");
  }

  // ── Launch world gen ──────────────────────────────────────────────────────
  async function launchWorldgen() {
    if (!jobId || !panoramaUrl) return;
    setStage("worldgen-running");
    setWgStatus(null);

    await fetch("/api/worldgen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, prompt, panoramaUrl }),
    });

    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/worldgen?jobId=${jobId}`);
      const data: WorldgenStatus & { status: string } = await res.json();
      setWgStatus(data);
      if (data.status === "done") {
        clearInterval(pollRef.current!);
        setStage("worldgen-done");
      }
    }, 1500);
  }

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [wgStatus?.log]);

  // Cleanup object URLs and poll on unmount
  useEffect(() => {
    return () => {
      imagePreviews.forEach((u) => URL.revokeObjectURL(u));
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = stage === "generating-panorama" || stage === "worldgen-running";

  // ─── UI ──────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div className="min-h-screen" style={{ background: "#0f1117", color: "#e0e7ff" }}>
        {/* Header */}
        <div
          className="rounded-xl mx-4 mt-4 px-8 py-6 mb-6"
          style={{ background: "linear-gradient(135deg,#1e1b4b 0%,#312e81 50%,#1e1b4b 100%)" }}
        >
          <div className="max-w-5xl mx-auto flex items-start justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-[#e0e7ff] mb-1">🌍 MacroNeue</h1>
              <p className="text-[#a5b4fc] text-sm">
                World generation powered by <strong>HY-World-2.0</strong> (Tencent Hunyuan) — turn
                images and text into explorable 3D worlds.
              </p>
            </div>
            <span className="text-xs bg-[#1e1b4b] border border-[#4f46e5] text-[#a5b4fc] rounded-full px-3 py-1 self-start mt-1">
              Prototype
            </span>
          </div>
        </div>

        {/* Pipeline breadcrumb */}
        <div className="max-w-5xl mx-auto px-4 mb-6">
          <div className="flex gap-2 flex-wrap text-xs text-[#a5b4fc]">
            {["1. Upload Images", "2. Generate Panorama", "3. Build 3D World", "4. Download Assets"].map((s, i) => {
              const active =
                (i === 0 && stage !== "idle") ||
                (i === 1 && ["panorama-ready", "worldgen-running", "worldgen-done"].includes(stage)) ||
                (i === 2 && ["worldgen-running", "worldgen-done"].includes(stage)) ||
                (i === 3 && stage === "worldgen-done");
              return (
                <div key={i} className="flex items-center gap-2">
                  {i > 0 && <span className="text-[#3d4166]">→</span>}
                  <span
                    className="px-2 py-1 rounded transition-all"
                    style={{
                      background: active ? "#312e81" : "#1a1d2e",
                      border: `1px solid ${active ? "#4f46e5" : "#2d2f45"}`,
                    }}
                  >
                    {s}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main grid */}
        <div className="max-w-5xl mx-auto px-4 grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">

          {/* ── Stage 1: Input ── */}
          <Card>
            <StageBadge>Stage 1 – Input</StageBadge>

            {/* Hidden file input — multiple */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
            />

            <ImageGrid
              previews={imagePreviews}
              onRemove={removeImage}
              onAdd={() => fileRef.current?.click()}
              onDrop={onDrop}
              dragOver={dragOver}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
            />

            {/* Prompt */}
            <label className="block text-xs text-[#a5b4fc] mb-1 font-medium">
              Scene Description <span className="opacity-50">(optional)</span>
            </label>
            <textarea
              className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-y mb-3"
              style={{ background: "#12141f", border: "1px solid #2d2f45", color: "#e0e7ff", minHeight: 80 }}
              placeholder="e.g. A misty mountain valley at golden hour, dense pine forest, distant snow-capped peaks…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />

            {/* Advanced */}
            <button
              className="text-xs text-[#6366f1] mb-3 hover:text-[#a5b4fc] transition-colors"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "▾" : "▸"} Advanced options
            </button>
            {showAdvanced && (
              <div className="mb-3 space-y-2 pl-3 border-l border-[#2d2f45]">
                <div className="flex items-center gap-3">
                  <label className="text-xs text-[#a5b4fc] w-20">Seed</label>
                  <input
                    type="number"
                    className="flex-1 rounded px-2 py-1 text-xs outline-none"
                    style={{ background: "#12141f", border: "1px solid #2d2f45", color: "#e0e7ff" }}
                    value={seed}
                    onChange={(e) => setSeed(Number(e.target.value))}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-[#a5b4fc] w-20">Steps</label>
                  <input
                    type="range" min={10} max={80} value={steps}
                    onChange={(e) => setSteps(Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-xs text-[#a5b4fc] w-6 text-right">{steps}</span>
                </div>
              </div>
            )}

            <button
              className="w-full py-2.5 rounded-lg font-semibold text-sm text-white transition-opacity"
              style={{
                background: "linear-gradient(135deg,#4f46e5,#7c3aed)",
                opacity: (!imageFiles.length || busy) ? 0.4 : 1,
                cursor: (!imageFiles.length || busy) ? "not-allowed" : "pointer",
              }}
              disabled={!imageFiles.length || busy}
              onClick={generatePanorama}
            >
              {stage === "generating-panorama" ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner /> Generating Panorama…
                </span>
              ) : (
                "Generate Panorama →"
              )}
            </button>
          </Card>

          {/* ── Stage 2: Panorama ── */}
          <Card>
            <StageBadge>Stage 2 – 360° Panorama</StageBadge>

            <div
              className="rounded-lg overflow-hidden mb-3 relative"
              style={{ background: "#12141f", minHeight: 200 }}
            >
              {panoramaUrl ? (
                <img
                  src={panoramaUrl}
                  alt="Generated 360° panorama"
                  className="w-full object-cover"
                  style={{ borderRadius: 8 }}
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-[#4a4e6e]">
                  {stage === "generating-panorama" ? (
                    <>
                      <Spinner />
                      <p className="text-xs mt-3 text-[#6366f1]">Running HY-Pano-2…</p>
                    </>
                  ) : (
                    <p className="text-sm">Panorama will appear here</p>
                  )}
                </div>
              )}
            </div>

            {panoNote && (
              <p className="text-xs text-[#f59e0b] bg-[#1c1a10] border border-[#78350f] rounded-lg px-3 py-2 mb-3">
                ⚠ {panoNote}
              </p>
            )}

            {panoramaUrl && (
              <div className="flex items-center gap-2 mb-3">
                <a
                  href={panoramaUrl}
                  download="panorama.svg"
                  className="text-xs text-[#6366f1] hover:text-[#a5b4fc] transition-colors"
                >
                  ↓ Download
                </a>
                <span className="text-[#2d2f45]">·</span>
                <button
                  onClick={() => setViewerOpen(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                  style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)", color: "white" }}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                  </svg>
                  View in 3D
                </button>
              </div>
            )}

            <button
              className="w-full py-2.5 rounded-lg font-semibold text-sm text-white transition-opacity"
              style={{
                background: "linear-gradient(135deg,#4f46e5,#7c3aed)",
                opacity: (stage !== "panorama-ready" || busy) ? 0.4 : 1,
                cursor: (stage !== "panorama-ready" || busy) ? "not-allowed" : "pointer",
              }}
              disabled={stage !== "panorama-ready" || busy}
              onClick={launchWorldgen}
            >
              Launch World Generation →
            </button>
          </Card>
        </div>

        {/* ── Stage 3: World generation ── */}
        {(stage === "worldgen-running" || stage === "worldgen-done") && wgStatus && (
          <div className="max-w-5xl mx-auto px-4 mb-6">
            <Card>
              <StageBadge>Stage 3 – World Generation</StageBadge>

              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-[#a5b4fc]">
                  {stage === "worldgen-done" ? "✓ Complete" : `Running: ${wgStatus.stageName}`}
                </p>
                <span className="text-xs text-[#6366f1]">{Math.round(wgStatus.overallProgress * 100)}%</span>
              </div>
              <ProgressBar value={wgStatus.overallProgress} />

              <div className="flex gap-2 flex-wrap mt-4 mb-4">
                {["Trajectory Planning", "Point-Cloud Rendering", "Video Synthesis", "3DGS Extraction", "World Trainer"].map((s, i) => {
                  const done = i < wgStatus.stage || stage === "worldgen-done";
                  const active = i === wgStatus.stage && stage !== "worldgen-done";
                  return (
                    <span
                      key={i}
                      className="text-xs rounded-full px-2.5 py-0.5"
                      style={{
                        background: done ? "#1e3a3a" : active ? "#1e1b4b" : "#12141f",
                        border: done ? "1px solid #10b981" : active ? "1px solid #4f46e5" : "1px solid #2d2f45",
                        color: done ? "#6ee7b7" : active ? "#a5b4fc" : "#4a4e6e",
                      }}
                    >
                      {done ? "✓ " : active ? "⟳ " : ""}{s}
                    </span>
                  );
                })}
              </div>

              <pre
                ref={logRef}
                className="text-xs rounded-lg p-3 overflow-auto"
                style={{ background: "#0c0e18", border: "1px solid #2d2f45", color: "#6ee7b7", maxHeight: 200, fontFamily: "monospace" }}
              >
                {wgStatus.log}
              </pre>
            </Card>
          </div>
        )}

        {/* ── Stage 4: Outputs ── */}
        {stage === "worldgen-done" && wgStatus && wgStatus.outputs.length > 0 && (
          <div className="max-w-5xl mx-auto px-4 mb-8">
            <Card>
              <StageBadge>Stage 4 – Download 3D Assets</StageBadge>

              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <p className="text-sm text-[#a5b4fc]">
                  Your world is ready. Explore it below or download the 3D assets.
                </p>
                <button
                  onClick={() => setViewerOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm text-white"
                  style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)" }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
                  </svg>
                  Explore World
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {wgStatus.outputs.map((out) => (
                  <button
                    key={out.name}
                    className="flex flex-col items-center justify-center gap-2 rounded-lg py-5 transition-all"
                    style={{ background: "#12141f", border: "1px solid #2d2f45", cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#4f46e5")}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#2d2f45")}
                  >
                    <svg className="w-7 h-7 text-[#6366f1]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                    </svg>
                    <span className="text-sm font-medium text-[#e0e7ff]">{out.label}</span>
                    <span className="text-xs text-[#4a4e6e]">{out.name}</span>
                  </button>
                ))}
              </div>

              <p className="text-xs text-[#4a4e6e] mt-4 text-center">
                Prototype — download buttons are illustrative. Real files are written to{" "}
                <code>outputs/</code> on the GPU server.
              </p>
            </Card>
          </div>
        )}

        {/* 3D Viewer */}
        <WorldViewer
          panoramaUrl={panoramaUrl}
          outputs={wgStatus?.outputs ?? []}
          isOpen={viewerOpen}
          onClose={() => setViewerOpen(false)}
        />

        {/* Footer */}
        <footer className="text-center text-xs text-[#3d4166] pb-6">
          MacroNeue prototype · Powered by{" "}
          <a
            href="https://github.com/Tencent-Hunyuan/HY-World-2.0"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#6366f1] hover:text-[#a5b4fc] transition-colors"
          >
            HY-World-2.0
          </a>
        </footer>
      </div>
    </>
  );
}
