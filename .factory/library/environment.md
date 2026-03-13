# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## System Requirements

- Node.js v20+ (v20.19.6 available)
- npm v10+ (v10.8.2 available)
- Docker v26+ (v26.1.5 available, needed for QEMU Wasm build)
- Emscripten: NOT installed on host; runs inside Docker build container
- QEMU: NOT installed on host; native validation uses Docker
- 4 CPU cores, 16GB RAM (9.6GB available)
- 69GB disk space available

## Browser Requirements

- Chrome (latest stable) or Firefox (latest stable) required
- Safari NOT supported (wasm64 limitations for 64-bit guests)
- SharedArrayBuffer required (needs COOP/COEP headers)
- Wasm memory: 2300MB linear memory allocation
- Recommended: 8GB+ system RAM for browser to allocate Wasm memory

## Key Paths

- Project root: `/home/mojo/projects/templeossy`
- Dev server: http://localhost:3200
- Build output: `dist/` or `public/` (TBD during implementation)

## No External APIs or Services

This project has zero external dependencies at runtime. Everything runs client-side in the browser.
