/**
 * POST /api/reconstruct        – start a WorldMirror-2 reconstruction job
 * GET  /api/reconstruct?jobId  – poll job status
 *
 * Accepts multipart form:
 *   image_0…image_N  – uploaded scene images (File)
 *   imageCount       – total image count
 *
 * In production: save images to a temp directory and call
 *   WorldMirrorPipeline()(images_dir, output_path=..., save_depth=True,
 *     save_normal=True, save_gs=True, save_points=True, save_camera=True)
 * For the prototype: simulate the 4 internal stages via elapsed time.
 */

import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

interface Job {
  startedAt: number;
  imageCount: number;
  quality: string;
  totalMs: number;
}

const jobs = new Map<string, Job>();

// Stage labels (order fixed; durations scale with quality preset)
const STAGE_LABELS = [
  "Feature Extraction & Depth",
  "Surface Normals & Camera Estimation",
  "Point Cloud Assembly",
  "Gaussian Splat Export",
];

// Simulated total durations per preset (prototype only)
const PRESET_TOTAL_MS: Record<string, number> = {
  fast:     20_000,
  balanced: 40_000,
  quality:  70_000,
};

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const imageCount = parseInt((formData.get("imageCount") as string) || "0", 10);
  const quality = (formData.get("quality") as string) || "balanced";

  if (imageCount < 2) {
    return Response.json({ error: "WorldMirror requires at least 2 images." }, { status: 400 });
  }

  const totalMs = PRESET_TOTAL_MS[quality] ?? PRESET_TOTAL_MS.balanced;
  const jobId = randomUUID().replace(/-/g, "").slice(0, 16);
  jobs.set(jobId, { startedAt: Date.now(), imageCount, quality, totalMs });

  // Production: call pipeline_manager.reconstruct_world(images_dir, quality=quality)
  // which passes target_size, enable_bf16, disable_heads from QUALITY_PRESETS[quality].

  return Response.json({ jobId, status: "running" });
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId required" }, { status: 400 });

  const job = jobs.get(jobId);
  if (!job) return Response.json({ error: "job not found" }, { status: 404 });

  const elapsed = Date.now() - job.startedAt;
  const { stageIndex, stageProgress, overallProgress, done } = computeProgress(elapsed, job.totalMs);
  const log = buildLog(stageIndex, stageProgress, done, job.imageCount, job.quality).join("\n");

  return Response.json({
    jobId,
    status: done ? "done" : "running",
    stageName: done ? "Complete" : STAGE_LABELS[stageIndex] ?? "Done",
    stageIndex,
    stageProgress,
    overallProgress,
    log,
    outputs: done ? buildOutputs() : null,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeProgress(elapsedMs: number, totalMs: number) {
  const n = STAGE_LABELS.length;
  if (elapsedMs >= totalMs) {
    return { stageIndex: n - 1, stageProgress: 1, overallProgress: 1, done: true };
  }
  const stageDuration = totalMs / n;
  const stageIndex = Math.min(Math.floor(elapsedMs / stageDuration), n - 1);
  const stageProgress = (elapsedMs % stageDuration) / stageDuration;
  return { stageIndex, stageProgress, overallProgress: elapsedMs / totalMs, done: false };
}

function buildLog(stage: number, progress: number, done: boolean, imageCount: number, quality: string): string[] {
  const ts = () => new Date().toISOString().slice(11, 23);
  const presetInfo: Record<string, string> = {
    fast:     "target_size=512, bf16=on, taylor_cache=on, heads=depth+camera",
    balanced: "target_size=768, bf16=on, taylor_cache=off, heads=depth+normal+camera",
    quality:  "target_size=952, bf16=off, taylor_cache=off, heads=all",
  };
  const lines = [
    `[${ts()}] WorldMirror-2 reconstruction started`,
    `[${ts()}] Quality: ${quality} — ${presetInfo[quality] ?? ""}`,
    `[${ts()}] Input: ${imageCount} images`,
    `[${ts()}] Loading model weights…`,
  ];
  for (let i = 0; i <= stage; i++) {
    if (i < stage || done) {
      lines.push(`[${ts()}] ${STAGE_LABELS[i]} — complete ✓`);
    } else {
      lines.push(`[${ts()}] ${STAGE_LABELS[i]} — ${Math.round(progress * 100)}% …`);
    }
  }
  if (done) {
    lines.push(`[${ts()}] Saving outputs…`);
    lines.push(`[${ts()}] Done. depth_*.png  normal_*.png  points.ply  splats.ply  camera.json`);
  }
  return lines;
}

function buildOutputs() {
  // Prototype: return placeholder coloured-gradient data URLs for depth & normals,
  // plus mock filenames for downloadable assets.
  return {
    depthUrl:  buildGradientSvg("#0a0a2a", "#00d4ff", "Depth Map (prototype)"),
    normalUrl: buildGradientSvg("#1a0a2a", "#ff6eb4", "Normal Map (prototype)"),
    plyFile:   "points.ply",
    splatFile: "splats.ply",
    camFile:   "camera.json",
  };
}

function buildGradientSvg(from: string, to: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="384" viewBox="0 0 512 384">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
    <radialGradient id="r" cx="40%" cy="40%" r="55%">
      <stop offset="0%" stop-color="${to}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <rect width="512" height="384" fill="url(#g)"/>
  <rect width="512" height="384" fill="url(#r)"/>
  <rect x="0" y="352" width="512" height="32" fill="rgba(0,0,0,0.55)"/>
  <text x="256" y="372" text-anchor="middle" font-family="system-ui,sans-serif"
        font-size="12" fill="rgba(255,255,255,0.8)">${label}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
