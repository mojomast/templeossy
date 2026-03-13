#!/bin/bash
set -e

cd /home/mojo/projects/templeossy

# Install npm dependencies if node_modules doesn't exist or package.json changed
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ] 2>/dev/null; then
  echo "Installing npm dependencies..."
  npm install
fi

# Verify Docker is available (needed for QEMU Wasm builds)
if ! command -v docker &> /dev/null; then
  echo "WARNING: Docker not available. QEMU Wasm build features will fail."
fi

echo "Environment ready."
