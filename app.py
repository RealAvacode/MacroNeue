"""
MacroNeue – World Generation App
Powered by HY-World-2.0 (Tencent Hunyuan)

Workflow:
  1. Upload an image (optional) and/or enter a text prompt
  2. Generate a 360° panorama using HY-Pano-2
  3. Optionally launch the full WorldGen pipeline to build a navigable 3D world
"""

import uuid
import time
import json
import shutil
from pathlib import Path
from typing import Optional

import gradio as gr
from PIL import Image

from config import OUTPUT_DIR, DEFAULT_PANO_PROMPT, DEFAULT_PANO_STEPS, DEFAULT_SEED

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _status_html(ready: bool, msg: str) -> str:
    color = "#22c55e" if ready else "#f59e0b"
    icon = "✓" if ready else "⚠"
    return (
        f'<span style="color:{color};font-weight:600;font-size:0.9rem;">'
        f'{icon} {msg}</span>'
    )


def get_system_status() -> str:
    from pipeline_manager import system_status
    s = system_status()
    parts = []
    parts.append(_status_html(s["cuda"]["ok"], s["cuda"]["msg"]))
    parts.append(_status_html(s["hyworld2"]["ok"], s["hyworld2"]["msg"]))
    if s["ready"]:
        parts.append(_status_html(True, "Ready for inference"))
    else:
        parts.append(
            _status_html(False, "Model not ready – run setup.sh then restart")
        )
    return "<br>".join(parts)


def _make_placeholder_panorama(prompt: str) -> Image.Image:
    """Return a grey gradient placeholder when model is unavailable."""
    import numpy as np
    w, h = 1024, 512
    arr = np.linspace(30, 80, w, dtype=np.uint8)
    arr = np.tile(arr, (h, 1))
    img = Image.fromarray(np.stack([arr, arr, arr], axis=-1))
    return img


# ---------------------------------------------------------------------------
# Core generation functions (called by Gradio event handlers)
# ---------------------------------------------------------------------------

def run_panorama_generation(
    input_image: Optional[Image.Image],
    text_prompt: str,
    seed: int,
    steps: int,
    use_qwen: bool,
    progress: gr.Progress = gr.Progress(),
) -> tuple:
    """
    Returns (panorama_image, job_id, status_message).
    """
    if input_image is None:
        return None, "", "Please upload an input image."

    prompt = text_prompt.strip() or DEFAULT_PANO_PROMPT
    job_id = uuid.uuid4().hex

    progress(0.1, desc="Loading panorama model…")

    try:
        from pipeline_manager import generate_panorama
        progress(0.3, desc="Generating panorama…")
        pano_image, pano_path = generate_panorama(
            image=input_image,
            prompt=prompt,
            seed=seed,
            steps=steps,
            use_qwen=use_qwen,
            job_id=job_id,
        )
        progress(1.0, desc="Done")
        return pano_image, job_id, f"Panorama saved to {pano_path}"

    except RuntimeError as e:
        if "not found" in str(e) or "not installed" in str(e):
            progress(0.5, desc="Model unavailable – using placeholder")
            placeholder = _make_placeholder_panorama(prompt)
            job_dir = OUTPUT_DIR / job_id
            job_dir.mkdir(parents=True, exist_ok=True)
            placeholder.save(job_dir / "panorama.png")
            return (
                placeholder,
                job_id,
                f"⚠ Model not installed. Showing placeholder.\n\n"
                f"Run setup.sh to install HY-World-2.0, then restart.\n\n"
                f"Error: {e}",
            )
        raise


def run_worldgen(
    job_id: str,
    text_prompt: str,
    n_gpus: int,
    progress: gr.Progress = gr.Progress(),
) -> tuple:
    """
    Launches the background world generation job.
    Returns (log_path_str, status_message).
    """
    if not job_id:
        return "", "Generate a panorama first."

    pano_path = OUTPUT_DIR / job_id / "panorama.png"
    if not pano_path.exists():
        return "", "Panorama file not found. Run panorama generation first."

    prompt = text_prompt.strip() or DEFAULT_PANO_PROMPT

    try:
        from pipeline_manager import start_worldgen_job
        progress(0.1, desc="Launching world generation…")
        new_job_id, log_path = start_worldgen_job(
            panorama_path=pano_path,
            prompt=prompt,
            job_id=job_id,
            n_gpus=n_gpus,
        )
        progress(0.3, desc="Pipeline running in background…")
        return (
            str(log_path),
            f"World generation started (job {new_job_id}).\n"
            f"Log: {log_path}\n\n"
            f"Click 'Refresh Log' to monitor progress.",
        )
    except Exception as e:
        return "", f"Error starting world generation: {e}"


def refresh_log(log_path_str: str) -> tuple:
    """Reads the last 50 lines of the worldgen log and scans for outputs."""
    if not log_path_str:
        return "No log file yet.", "{}"

    from pipeline_manager import poll_worldgen_log, find_worldgen_outputs
    log_path = Path(log_path_str)
    job_id = log_path.parent.name

    log_text = poll_worldgen_log(log_path)
    outputs = find_worldgen_outputs(job_id)
    outputs_json = json.dumps(outputs, indent=2) if outputs else "{}"
    return log_text, outputs_json


def collect_outputs(job_id: str) -> list:
    """Return downloadable output file paths for a finished job."""
    if not job_id:
        return []
    from pipeline_manager import find_worldgen_outputs
    outputs = find_worldgen_outputs(job_id)
    all_files = []
    for paths in outputs.values():
        all_files.extend(paths)
    return all_files


# ---------------------------------------------------------------------------
# Gradio UI
# ---------------------------------------------------------------------------

CSS = """
body { background: #0f1117; }
#header {
    background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%);
    border-radius: 12px;
    padding: 24px 32px;
    margin-bottom: 20px;
}
#header h1 {
    margin: 0 0 4px 0;
    font-size: 2rem;
    font-weight: 700;
    color: #e0e7ff;
    letter-spacing: -0.5px;
}
#header p {
    margin: 0;
    color: #a5b4fc;
    font-size: 0.95rem;
}
.panel {
    background: #1a1d2e;
    border: 1px solid #2d2f45;
    border-radius: 10px;
    padding: 20px;
}
.stage-badge {
    display: inline-block;
    background: #312e81;
    color: #c7d2fe;
    border-radius: 20px;
    padding: 2px 12px;
    font-size: 0.78rem;
    font-weight: 600;
    margin-bottom: 8px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
}
.gr-button.primary {
    background: linear-gradient(135deg, #4f46e5, #7c3aed) !important;
    border: none !important;
    color: white !important;
    font-weight: 600 !important;
}
.gr-button.secondary {
    background: #1e2030 !important;
    border: 1px solid #3d4166 !important;
    color: #a5b4fc !important;
}
"""

PIPELINE_STAGES_MD = """
### Pipeline Stages

| Stage | What happens |
|-------|-------------|
| **1. Input** | Upload an image and/or write a scene description |
| **2. Panorama (HY-Pano-2)** | The image is expanded into a full 360° equirectangular panorama |
| **3. World Generation** | The panorama feeds a 5-stage pipeline: trajectory planning → rendering → video synthesis → 3DGS extraction → world training |
| **4. Export** | Download 3D assets (.ply point clouds, Gaussian Splats, .obj meshes) |

> **Hardware note:** Stages 1–2 need a single GPU with ≥16 GB VRAM.
> Stage 3 (World Generation) needs 1–8× A100/H100 GPUs and takes 30–90 minutes.
"""


def build_ui():
    with gr.Blocks(title="MacroNeue – World Generation") as demo:

        # ── Header ──────────────────────────────────────────────────────────
        gr.HTML("""
        <div id="header">
            <h1>🌍 MacroNeue</h1>
            <p>World generation powered by <strong>HY-World-2.0</strong> (Tencent Hunyuan) —
               turn images and text into explorable 3D worlds.</p>
        </div>
        """)

        # ── System status ────────────────────────────────────────────────────
        with gr.Accordion("System Status", open=False):
            status_html = gr.HTML(value="<em>Checking…</em>")
            refresh_status_btn = gr.Button("Refresh Status", size="sm", variant="secondary")

        gr.Markdown(PIPELINE_STAGES_MD)

        # ── State ────────────────────────────────────────────────────────────
        job_id_state = gr.State(value="")
        log_path_state = gr.State(value="")

        # ── Stage 1 + 2 – Input & Panorama ──────────────────────────────────
        with gr.Row(equal_height=False):

            # Left column – inputs
            with gr.Column(scale=1):
                gr.HTML('<div class="stage-badge">Stage 1 – Input</div>')

                input_image = gr.Image(
                    label="Scene Image",
                    type="pil",
                    height=300,
                )

                text_prompt = gr.Textbox(
                    label="Scene Description (optional)",
                    placeholder=(
                        "e.g. A misty mountain valley at golden hour, "
                        "dense pine forest, distant snow-capped peaks…"
                    ),
                    lines=4,
                )

                with gr.Accordion("Advanced Options", open=False):
                    seed = gr.Slider(
                        0, 9999, value=DEFAULT_SEED, step=1, label="Seed"
                    )
                    steps = gr.Slider(
                        10, 80, value=DEFAULT_PANO_STEPS, step=1,
                        label="Diffusion Steps",
                    )
                    use_qwen = gr.Checkbox(
                        label="Use Qwen-Image-Edit backend (lighter, faster)",
                        value=False,
                    )

                gen_pano_btn = gr.Button(
                    "Generate Panorama", variant="primary", size="lg"
                )

            # Right column – panorama output
            with gr.Column(scale=1):
                gr.HTML('<div class="stage-badge">Stage 2 – 360° Panorama</div>')

                pano_output = gr.Image(
                    label="Generated Panorama",
                    type="pil",
                    height=300,
                    interactive=False,
                )
                pano_status = gr.Textbox(
                    label="Status",
                    lines=3,
                    interactive=False,
                )

        # ── Stage 3 – World Generation ───────────────────────────────────────
        gr.Markdown("---")
        gr.HTML('<div class="stage-badge">Stage 3 – Full World Generation (GPU-intensive)</div>')

        with gr.Row():
            with gr.Column(scale=1):
                n_gpus = gr.Slider(
                    1, 8, value=1, step=1,
                    label="Number of GPUs",
                    info="Use more GPUs to speed up generation (needs torchrun).",
                )
                launch_worldgen_btn = gr.Button(
                    "Launch World Generation", variant="primary"
                )
                worldgen_status = gr.Textbox(
                    label="Launch Status", lines=3, interactive=False
                )

            with gr.Column(scale=2):
                with gr.Row():
                    refresh_log_btn = gr.Button("Refresh Log", variant="secondary")
                    download_btn = gr.Button("Collect Outputs", variant="secondary")

                log_output = gr.Textbox(
                    label="World Generation Log (last 50 lines)",
                    lines=15,
                    interactive=False,
                    max_lines=50,
                )
                outputs_json = gr.JSON(label="Completed Output Files")

        # ── Stage 4 – Download ────────────────────────────────────────────────
        gr.Markdown("---")
        gr.HTML('<div class="stage-badge">Stage 4 – Download Outputs</div>')
        file_output = gr.Files(label="Download 3D Assets")

        # ── Event handlers ────────────────────────────────────────────────────

        demo.load(get_system_status, outputs=status_html)

        refresh_status_btn.click(get_system_status, outputs=status_html)

        gen_pano_btn.click(
            run_panorama_generation,
            inputs=[input_image, text_prompt, seed, steps, use_qwen],
            outputs=[pano_output, job_id_state, pano_status],
        )

        launch_worldgen_btn.click(
            run_worldgen,
            inputs=[job_id_state, text_prompt, n_gpus],
            outputs=[log_path_state, worldgen_status],
        )

        refresh_log_btn.click(
            refresh_log,
            inputs=[log_path_state],
            outputs=[log_output, outputs_json],
        )

        download_btn.click(
            collect_outputs,
            inputs=[job_id_state],
            outputs=[file_output],
        )

    return demo


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="MacroNeue – World Generation App")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=7860)
    parser.add_argument("--share", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    app = build_ui()
    app.launch(
        server_name=args.host,
        server_port=args.port,
        share=args.share,
        inbrowser=not args.no_browser,
        css=CSS,
    )
