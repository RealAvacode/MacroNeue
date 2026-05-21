import os
from pathlib import Path

HF_MODEL_ID = "tencent/HY-World-2.0"
WORLDSTEREO_MODEL_ID = "hanshanxue/WorldStereo"

OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "./outputs"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_SEED = 42
DEFAULT_PANO_STEPS = 30
DEFAULT_PANO_PROMPT = (
    "Expand this image to a high-quality 360-degree equirectangular panorama. "
    "Maintain consistent lighting, perspective, and scene coherence."
)

# Quality presets — map a single user-facing knob to all speed/quality levers.
# BF16 and Taylor cache give large speed gains with negligible quality loss;
# target_size has a quadratic effect on WorldMirror runtime.
QUALITY_PRESETS: dict = {
    "fast": {
        "pano_steps": 20,
        "bf16": True,
        "taylor_cache": True,
        "taylor_cache_interval": 5,
        "target_size": 512,
        "disable_heads": ["normal", "points", "gs"],  # keep depth + camera only
    },
    "balanced": {
        "pano_steps": 30,
        "bf16": True,
        "taylor_cache": False,
        "taylor_cache_interval": 5,
        "target_size": 768,
        "disable_heads": ["points", "gs"],  # keep depth + normal + camera
    },
    "quality": {
        "pano_steps": 50,
        "bf16": False,
        "taylor_cache": False,
        "taylor_cache_interval": 5,
        "target_size": 952,
        "disable_heads": [],  # all heads on
    },
}
DEFAULT_QUALITY = "balanced"

# WorldGen LLM settings (used for trajectory planning)
LLM_ADDR = os.environ.get("LLM_ADDR", "127.0.0.1")
LLM_PORT = os.environ.get("LLM_PORT", "8000")
LLM_NAME = os.environ.get("LLM_NAME", "Qwen/Qwen2.5-VL-7B-Instruct")
