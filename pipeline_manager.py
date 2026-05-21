"""
Manages loading and running the HY-World-2.0 pipelines.

The full workflow is:
  1. HY-Pano-2  : image (+ text) → 360° equirectangular panorama
  2. WorldMirror: panorama / multi-view images → depth + 3DGS attributes
  3. WorldGen   : panorama → navigable 3D world (multi-GPU, long-running)

The app exposes stages 1 and 2 interactively; stage 3 is submitted as a
background job whose progress can be polled.
"""

import sys
import os
import uuid
import json
import shutil
import subprocess
from pathlib import Path
from typing import Optional, Tuple, Generator

import numpy as np
from PIL import Image

from config import (
    HF_MODEL_ID,
    OUTPUT_DIR,
    DEFAULT_SEED,
    DEFAULT_PANO_STEPS,
    DEFAULT_PANO_PROMPT,
    QUALITY_PRESETS,
    DEFAULT_QUALITY,
    LLM_ADDR,
    LLM_PORT,
    LLM_NAME,
)

# ---------------------------------------------------------------------------
# GPU / dependency checks
# ---------------------------------------------------------------------------

def _check_cuda() -> Tuple[bool, str]:
    try:
        import torch
        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0)
            return True, f"CUDA available – {name}"
        return False, "CUDA not available (CPU-only mode)"
    except ImportError:
        return False, "PyTorch not installed"


def _check_hyworld() -> Tuple[bool, str]:
    try:
        import hyworld2  # noqa: F401
        return True, "hyworld2 package found"
    except ImportError:
        return False, "hyworld2 not installed – run setup.sh first"


def system_status() -> dict:
    cuda_ok, cuda_msg = _check_cuda()
    hw_ok, hw_msg = _check_hyworld()
    return {
        "cuda": {"ok": cuda_ok, "msg": cuda_msg},
        "hyworld2": {"ok": hw_ok, "msg": hw_msg},
        "ready": cuda_ok and hw_ok,
    }


# ---------------------------------------------------------------------------
# Stage 1 – Panorama generation (HY-Pano-2)
# ---------------------------------------------------------------------------

_pano_pipeline = None
_pano_pipeline_key: Optional[str] = None  # tracks (use_qwen, enable_bf16) so we reload on change


def _load_pano_pipeline(use_qwen: bool = False, enable_bf16: bool = False):
    global _pano_pipeline, _pano_pipeline_key
    key = f"qwen={use_qwen},bf16={enable_bf16}"
    if _pano_pipeline is not None and _pano_pipeline_key == key:
        return _pano_pipeline

    hyworld_dir = Path("HY-World-2.0/hyworld2/panogen")
    if not hyworld_dir.exists():
        raise RuntimeError(
            "HY-World-2.0 not found. Run setup.sh to clone and install it."
        )

    sys.path.insert(0, str(hyworld_dir))

    import torch
    dtype = torch.bfloat16 if enable_bf16 else torch.float32

    if use_qwen:
        from pipeline_with_qwen_image import HunyuanPanoPipeline
        _pano_pipeline = HunyuanPanoPipeline.from_pretrained(
            lora_path=HF_MODEL_ID, lora_subfolder="HY-Pano-2.0", torch_dtype=dtype
        )
    else:
        from pipeline import HunyuanPanoPipeline  # type: ignore
        _pano_pipeline = HunyuanPanoPipeline.from_pretrained(
            HF_MODEL_ID, torch_dtype=dtype
        )

    _pano_pipeline_key = key
    return _pano_pipeline


def generate_panorama(
    image: Image.Image,
    prompt: str = DEFAULT_PANO_PROMPT,
    seed: int = DEFAULT_SEED,
    steps: int = DEFAULT_PANO_STEPS,
    use_qwen: bool = False,
    quality: str = DEFAULT_QUALITY,
    job_id: Optional[str] = None,
) -> Tuple[Image.Image, Path]:
    """Return (panorama PIL image, saved path)."""
    preset = QUALITY_PRESETS.get(quality, QUALITY_PRESETS[DEFAULT_QUALITY])
    enable_bf16 = preset["bf16"]
    use_taylor_cache = preset["taylor_cache"]
    # Allow caller to override steps; fall back to preset
    effective_steps = steps if steps != DEFAULT_PANO_STEPS else preset["pano_steps"]

    pipeline = _load_pano_pipeline(use_qwen=use_qwen, enable_bf16=enable_bf16)

    job_id = job_id or uuid.uuid4().hex
    job_dir = OUTPUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    input_path = job_dir / "input.png"
    image.save(input_path)

    output = pipeline(
        str(input_path),
        prompt=prompt,
        seed=seed,
        diff_infer_steps=effective_steps,
        use_taylor_cache=use_taylor_cache,
        taylor_cache_interval=preset["taylor_cache_interval"],
    )

    pano_path = job_dir / "panorama.png"
    output.save(pano_path)
    return output, pano_path


# ---------------------------------------------------------------------------
# Stage 2 – WorldMirror reconstruction
# ---------------------------------------------------------------------------

_mirror_pipeline = None


def _load_mirror_pipeline():
    global _mirror_pipeline
    if _mirror_pipeline is not None:
        return _mirror_pipeline

    from hyworld2.worldrecon.pipeline import WorldMirrorPipeline  # type: ignore
    _mirror_pipeline = WorldMirrorPipeline.from_pretrained(HF_MODEL_ID)
    return _mirror_pipeline


def reconstruct_world(
    images_dir: Path,
    job_id: Optional[str] = None,
    quality: str = DEFAULT_QUALITY,
) -> Path:
    """
    Run WorldMirror on a directory of images.
    Returns path to the output directory containing point clouds / 3DGS.
    """
    preset = QUALITY_PRESETS.get(quality, QUALITY_PRESETS[DEFAULT_QUALITY])
    pipeline = _load_mirror_pipeline()
    job_id = job_id or uuid.uuid4().hex
    out_dir = OUTPUT_DIR / job_id / "reconstruction"
    out_dir.mkdir(parents=True, exist_ok=True)

    pipeline(
        str(images_dir),
        output_path=str(out_dir),
        target_size=preset["target_size"],
        enable_bf16=preset["bf16"],
        disable_heads=preset["disable_heads"] or None,
        compress_pts=True,
        save_depth=True,
        save_normal="normal" not in preset["disable_heads"],
        save_gs="gs" not in preset["disable_heads"],
        save_camera=True,
        save_points="points" not in preset["disable_heads"],
    )
    return out_dir


# ---------------------------------------------------------------------------
# Stage 3 – Full world generation (long-running background job)
# ---------------------------------------------------------------------------

def _write_meta(target_path: Path, prompt: str, panorama_path: Path):
    meta = {
        "prompt": prompt,
        "panorama": str(panorama_path),
    }
    (target_path / "meta_info.json").write_text(json.dumps(meta, indent=2))
    shutil.copy(panorama_path, target_path / "panorama.png")


def start_worldgen_job(
    panorama_path: Path,
    prompt: str,
    job_id: Optional[str] = None,
    n_gpus: int = 1,
) -> Tuple[str, Path]:
    """
    Launch the 5-stage world generation pipeline as a subprocess.
    Returns (job_id, log_file_path).
    """
    job_id = job_id or uuid.uuid4().hex
    target = OUTPUT_DIR / job_id / "worldgen"
    target.mkdir(parents=True, exist_ok=True)
    _write_meta(target, prompt, panorama_path)

    log_path = OUTPUT_DIR / job_id / "worldgen.log"
    script = Path("HY-World-2.0/hyworld2/worldgen/run_pipeline.sh")

    if not script.exists():
        # Fall back to running stages individually via Python
        cmd = [
            sys.executable, "-c",
            f"""
import subprocess, sys
stages = [
    "traj_generate.py",
    "traj_render.py",
    "video_gen.py",
    "gen_gs_data.py",
    "world_gs_trainer.py",
]
base = "HY-World-2.0/hyworld2/worldgen"
for s in stages:
    r = subprocess.run(
        [sys.executable, f"{{base}}/{{s}}", "--target_path", "{target}",
         "--llm_addr", "{LLM_ADDR}", "--llm_port", "{LLM_PORT}",
         "--llm_name", "{LLM_NAME}"],
        capture_output=True, text=True
    )
    print(r.stdout); print(r.stderr, file=sys.stderr)
    if r.returncode != 0:
        sys.exit(r.returncode)
"""
        ]
    else:
        torchrun = "torchrun" if n_gpus > 1 else sys.executable
        cmd = [torchrun, str(script), "--target_path", str(target),
               "--llm_addr", LLM_ADDR, "--llm_port", LLM_PORT,
               "--llm_name", LLM_NAME]

    with open(log_path, "w") as log_file:
        subprocess.Popen(cmd, stdout=log_file, stderr=log_file)

    return job_id, log_path


def poll_worldgen_log(log_path: Path, max_lines: int = 50) -> str:
    """Read the last `max_lines` of the worldgen log."""
    if not log_path.exists():
        return "Log not yet created…"
    lines = log_path.read_text(errors="replace").splitlines()
    return "\n".join(lines[-max_lines:])


def find_worldgen_outputs(job_id: str) -> dict:
    """Return paths to any completed outputs for a job."""
    base = OUTPUT_DIR / job_id
    found: dict = {}
    for pattern, key in [
        ("**/*.ply", "point_clouds"),
        ("**/*.splat", "gaussian_splats"),
        ("**/*.obj", "meshes"),
        ("**/*.glb", "glb"),
    ]:
        matches = list(base.glob(pattern))
        if matches:
            found[key] = [str(p) for p in matches]
    return found
