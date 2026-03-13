This project has convenience files to run the built site as a systemd service and expose it over Tailscale.

Steps (summary):

1) On the host machine where the repo lives, install Node and Tailscale and sign in.

2) From the repo root, run:

   ./scripts/install_service.sh

   Then run the printed sudo commands to copy the systemd unit and start it.

3) Confirm the service is running:

   sudo systemctl status templeossy.service

4) Find your Tailscale IP and connect from any device on the same Tailnet:

   tailscale ip -4

   Then open: http://<TAILSCALE_IP>:3200

Notes:
- The systemd unit runs `npm run preview` from your home project path. Edit `systemd/templeossy.service` if you installed the repo elsewhere.
- Port 3200 must be allowed by your host firewall; the install script shows the `ufw` command to allow it.
