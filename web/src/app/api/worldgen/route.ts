/**
 * POST /api/worldgen        – start a world-generation job
 * GET  /api/worldgen?jobId  – poll job status
 *
 * In production these would communicate with a long-running GPU worker
 * (torchrun HY-World-2.0 pipeline). For the prototype, status is
 * simulated via elapsed time from job creation, stored in a simple
 * in-process map (resets on cold-start – fine for a prototype).
 */

import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

interface Job {
  startedAt: number;
  prompt: string;
  panoramaUrl: string;
}

// In-process store (prototype only — use a real DB in production)
const jobs = new Map<string, Job>();

const STAGES = [
  { label: "Trajectory Planning", durationMs: 8_000 },
  { label: "Point-Cloud Rendering", durationMs: 12_000 },
  { label: "Video Synthesis (WorldStereo-2)", durationMs: 18_000 },
  { label: "3DGS Data Extraction", durationMs: 10_000 },
  { label: "World Trainer", durationMs: 12_000 },
];
const TOTAL_MS = STAGES.reduce((s, st) => s + st.durationMs, 0);

export async function POST(request: NextRequest) {
  const { jobId: existingJobId, prompt, panoramaUrl } = await request.json();

  const jobId = existingJobId ?? randomUUID().replace(/-/g, "").slice(0, 16);
  jobs.set(jobId, { startedAt: Date.now(), prompt, panoramaUrl });

  return Response.json({ jobId, status: "running" });
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return Response.json({ error: "jobId required" }, { status: 400 });
  }

  const job = jobs.get(jobId);
  if (!job) {
    return Response.json({ error: "job not found" }, { status: 404 });
  }

  const elapsed = Date.now() - job.startedAt;
  const { stageIndex, stageProgress, overallProgress, done } =
    computeProgress(elapsed);

  const logLines = buildLog(stageIndex, stageProgress, done, job.prompt);

  return Response.json({
    jobId,
    status: done ? "done" : "running",
    stage: stageIndex,
    stageName: done ? "Complete" : STAGES[stageIndex]?.label ?? "Done",
    stageProgress,
    overallProgress,
    log: logLines.join("\n"),
    outputs: done
      ? [
          { name: "world.ply", label: "Point Cloud (.ply)" },
          { name: "world.splat", label: "Gaussian Splat (.splat)" },
          { name: "world_mesh.obj", label: "Mesh (.obj)" },
        ]
      : [],
  });
}

function computeProgress(elapsedMs: number) {
  if (elapsedMs >= TOTAL_MS) {
    return { stageIndex: STAGES.length - 1, stageProgress: 1, overallProgress: 1, done: true };
  }
  let remaining = elapsedMs;
  for (let i = 0; i < STAGES.length; i++) {
    if (remaining < STAGES[i].durationMs) {
      const stageProgress = remaining / STAGES[i].durationMs;
      const overallProgress =
        (elapsedMs / TOTAL_MS);
      return { stageIndex: i, stageProgress, overallProgress, done: false };
    }
    remaining -= STAGES[i].durationMs;
  }
  return { stageIndex: STAGES.length - 1, stageProgress: 1, overallProgress: 1, done: true };
}

function buildLog(
  stageIndex: number,
  stageProgress: number,
  done: boolean,
  prompt: string
): string[] {
  const lines: string[] = [];
  const ts = () => new Date().toISOString().slice(11, 23);

  lines.push(`[${ts()}] World generation started`);
  lines.push(`[${ts()}] Prompt: "${prompt.slice(0, 80)}"`);
  lines.push(`[${ts()}] Panorama loaded ✓`);

  for (let i = 0; i <= stageIndex; i++) {
    if (i < stageIndex || done) {
      lines.push(`[${ts()}] Stage ${i + 1}: ${STAGES[i].label} — complete ✓`);
    } else {
      const pct = Math.round(stageProgress * 100);
      lines.push(`[${ts()}] Stage ${i + 1}: ${STAGES[i].label} — ${pct}% …`);
    }
  }

  if (done) {
    lines.push(`[${ts()}] All stages complete.`);
    lines.push(`[${ts()}] Outputs: world.ply, world.splat, world_mesh.obj`);
  }

  return lines;
}
