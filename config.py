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

# WorldGen LLM settings (used for trajectory planning)
LLM_ADDR = os.environ.get("LLM_ADDR", "127.0.0.1")
LLM_PORT = os.environ.get("LLM_PORT", "8000")
LLM_NAME = os.environ.get("LLM_NAME", "Qwen/Qwen2.5-VL-7B-Instruct")
