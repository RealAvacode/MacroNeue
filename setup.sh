#!/bin/bash
set -e

echo "=== HY-World 2.0 Setup ==="

# Clone HY-World 2.0 repo alongside this app
if [ ! -d "HY-World-2.0" ]; then
    echo "Cloning HY-World-2.0..."
    git clone https://github.com/Tencent-Hunyuan/HY-World-2.0
fi

cd HY-World-2.0

# Core Python dependencies
echo "Installing core dependencies..."
pip install -r requirements.txt

# Custom gsplat (Gaussian Splatting support)
echo "Installing gsplat..."
pip install -e hyworld2/worldgen/third_party/gsplat_maskgaussian --no-build-isolation

# Flash attention (choose the simpler path)
echo "Installing flash-attn..."
pip install flash-attn --no-build-isolation || echo "Warning: flash-attn install failed, continuing without it"

# World generation extras
echo "Installing world generation dependencies..."
pip install --no-build-isolation -r requirements_git.txt || true

git submodule update --init --recursive || true

pip install hyworld2/worldgen/third_party/navmesh --no-build-isolation || true

cd ..

# App-specific dependencies
echo "Installing app dependencies..."
pip install gradio>=4.0.0 pillow requests

echo ""
echo "=== Setup complete ==="
echo "Run the app with: python app.py"
