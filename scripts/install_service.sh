#!/usr/bin/env bash
set -euo pipefail

# Simple installer helper for running the built app as a systemd service
# NOTE: This script performs non-root steps (install deps, build) and prints
# the commands you need to run as root to install the systemd unit.

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_SRC="$REPO_DIR/systemd/templeossy.service"

echo "Repository: $REPO_DIR"

echo "1) Installing node dependencies (npm ci)"
npm ci --prefix "$REPO_DIR"

echo "2) Building the project"
npm run build --prefix "$REPO_DIR"

cat <<'EOF'

Build finished.

To install the systemd service and start it (requires root), run the following commands:

sudo cp "$SERVICE_SRC" /etc/systemd/system/templeossy.service
sudo systemctl daemon-reload
sudo systemctl enable --now templeossy.service

If you use UFW, allow the port:
sudo ufw allow 3200/tcp

To check status:
sudo systemctl status templeossy.service

To view the app URL (if Tailscale is installed):
tailscale ip -4 || ip -4 addr show dev tailscale0

EOF

echo "If you prefer not to install a system service, you can run locally:"
echo "  npm run preview --prefix '$REPO_DIR' -- --port 3200"

echo "Done. Run the sudo commands above to install and start the service."
