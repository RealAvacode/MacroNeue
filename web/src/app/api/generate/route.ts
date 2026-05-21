/**
 * POST /api/generate
 *
 * Accepts a multipart form with:
 *   image  – the uploaded scene image (File)
 *   prompt – text description of the scene
 *   seed   – integer seed
 *   steps  – diffusion steps
 *
 * In production this would forward to a GPU backend running HY-Pano-2.
 * For the prototype it returns a placeholder panorama SVG.
 */

import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const prompt = (formData.get("prompt") as string) || "";

  // Production: forward image + prompt to GPU inference server running HY-Pano-2
  // and await the 360° equirectangular panorama image back.

  const jobId = randomUUID().replace(/-/g, "").slice(0, 16);

  // Prototype placeholder – a gradient SVG that looks vaguely panoramic
  const hue = Math.abs(hashCode(prompt || "world")) % 360;
  const svgPanorama = buildPanoramaSvg(hue, prompt);
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgPanorama).toString("base64")}`;

  return Response.json({
    jobId,
    panoramaUrl: dataUrl,
    prompt,
    note: "Prototype – panorama is a placeholder. Real inference requires HY-Pano-2 on a GPU server.",
  });
}

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

function buildPanoramaSvg(hue: number, label: string): string {
  const h2 = (hue + 40) % 360;
  const h3 = (hue + 180) % 360;
  const trimmed = label.length > 60 ? label.slice(0, 57) + "…" : label;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512" viewBox="0 0 1024 512">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="hsl(${hue},60%,18%)"/>
      <stop offset="60%" stop-color="hsl(${h2},50%,28%)"/>
      <stop offset="100%" stop-color="hsl(${h3},40%,12%)"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="38%" r="40%">
      <stop offset="0%" stop-color="hsl(${hue},80%,60%)" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="512" fill="url(#sky)"/>
  <rect width="1024" height="512" fill="url(#glow)"/>
  <!-- Horizon hills -->
  <ellipse cx="200" cy="420" rx="260" ry="90" fill="hsl(${h3},35%,14%)" opacity="0.8"/>
  <ellipse cx="600" cy="430" rx="340" ry="80" fill="hsl(${h3},30%,12%)" opacity="0.9"/>
  <ellipse cx="950" cy="415" rx="200" ry="85" fill="hsl(${h3},35%,14%)" opacity="0.8"/>
  <!-- Stars -->
  ${Array.from({ length: 60 }, (_, i) => {
    const x = (i * 173 + 37) % 1024;
    const y = (i * 97 + 11) % 220;
    const r = i % 3 === 0 ? 1.5 : 0.8;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="white" opacity="${0.3 + (i % 5) * 0.1}"/>`;
  }).join("")}
  <!-- Label -->
  <rect x="0" y="470" width="1024" height="42" fill="rgba(0,0,0,0.5)"/>
  <text x="512" y="496" text-anchor="middle" font-family="system-ui,sans-serif"
        font-size="14" fill="#a5b4fc" opacity="0.9">
    360° Panorama Preview (prototype) — ${escapeXml(trimmed)}
  </text>
</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
