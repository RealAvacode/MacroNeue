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
}

const jobs = new Map<string, Job>();

const STAGES = [
  { label: "Feature Extraction & Depth",        durationMs: 12_000 },
  { label: "Surface Normals & Camera Estimation", durationMs: 10_000 },
  { label: "Point Cloud Assembly",               durationMs:  8_000 },
  { label: "Gaussian Splat Export",              durationMs: 10_000 },
];
const TOTAL_MS = STAGES.reduce((s, st) => s + st.durationMs, 0);

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const imageCount = parseInt((formData.get("imageCount") as string) || "0", 10);

  if (imageCount < 2) {
    return Response.json({ error: "WorldMirror requires at least 2 images." }, { status: 400 });
  }

  const jobId = randomUUID().replace(/-/g, "").slice(0, 16);
  jobs.set(jobId, { startedAt: Date.now(), imageCount });

  return Response.json({ jobId, status: "running" });
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId required" }, { status: 400 });

  const job = jobs.get(jobId);
  if (!job) return Response.json({ error: "job not found" }, { status: 404 });

  const elapsed = Date.now() - job.startedAt;
  const { stageIndex, stageProgress, overallProgress, done } = computeProgress(elapsed);
  const log = buildLog(stageIndex, stageProgress, done, job.imageCount).join("\n");

  return Response.json({
    jobId,
    status: done ? "done" : "running",
    stageName: done ? "Complete" : STAGES[stageIndex]?.label ?? "Done",
    stageIndex,
    stageProgress,
    overallProgress,
    log,
    outputs: done ? buildOutputs() : null,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeProgress(elapsedMs: number) {
  if (elapsedMs >= TOTAL_MS) {
    return { stageIndex: STAGES.length - 1, stageProgress: 1, overallProgress: 1, done: true };
  }
  let remaining = elapsedMs;
  for (let i = 0; i < STAGES.length; i++) {
    if (remaining < STAGES[i].durationMs) {
      return {
        stageIndex: i,
        stageProgress: remaining / STAGES[i].durationMs,
        overallProgress: elapsedMs / TOTAL_MS,
        done: false,
      };
    }
    remaining -= STAGES[i].durationMs;
  }
  return { stageIndex: STAGES.length - 1, stageProgress: 1, overallProgress: 1, done: true };
}

function buildLog(stage: number, progress: number, done: boolean, imageCount: number): string[] {
  const ts = () => new Date().toISOString().slice(11, 23);
  const lines = [
    `[${ts()}] WorldMirror-2 reconstruction started`,
    `[${ts()}] Input: ${imageCount} images`,
    `[${ts()}] Loading model weights…`,
  ];
  for (let i = 0; i <= stage; i++) {
    if (i < stage || done) {
      lines.push(`[${ts()}] ${STAGES[i].label} — complete ✓`);
    } else {
      lines.push(`[${ts()}] ${STAGES[i].label} — ${Math.round(progress * 100)}% …`);
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
