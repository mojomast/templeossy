# TempleOS ISO Hosting Research Report

## 1. ISO Download Locations & File Sizes

### Official/Canonical Sources

| Source | URL | Version | Size |
|--------|-----|---------|------|
| **archive.org (ISO Archive)** | `https://archive.org/download/TempleOS_ISO_Archive/TempleOSCDV5.03.ISO` | V5.03 (initial) | **17,817,600 bytes (~17.0 MB)** |
| **archive.org (TOS_Distro latest)** | `https://archive.org/download/TempleOS_ISO_Archive/TempleOS_V5.03/Tos_distro_2017.11.20_19-52.iso` | V5.03 (final nightly, Nov 20 2017) | **~16.5 MB** |
| **archive.org (TOS_Lite)** | `https://archive.org/download/TempleOS_ISO_Archive/TempleOS_V5.03/Tos_lite_2017.11.20_19-51.iso` | V5.03 Lite | **~1.9 MB** |
| **GitHub (cia-foundation)** | `https://github.com/cia-foundation/TempleOS` (archive branch, Downloads/) | V5.03 | ~17 MB |
| **GitHub (Terry-Davis-Archive)** | `https://github.com/Terry-Davis-Archive/TempleOS-ISO/releases/download/v1.0/TempleOS.7z` | V5.03 (7z compressed) | **19.6 MB (compressed archive containing multiple ISOs)** |
| **GitHub (codepony)** | `https://github.com/codepony/templeos` | V5.03 | ISO contents extracted |
| **SourceForge (ArchiveOS)** | `https://sourceforge.net/projects/archiveos/files/t/templeos/TempleOS.ISO/download` | V5.03 | ~17 MB |

### Key File Size Summary
- **TempleOSCDV5.03.ISO**: 17,817,600 bytes (**exactly 17.0 MB**) — the standard distribution
- **TOS_Distro (final nightly)**: ~16.5 MB — the last builds Terry released
- **TOS_Lite**: ~1.9 MB — minimal version (may lack features)

## 2. Licensing

**TempleOS is PUBLIC DOMAIN.** There are absolutely NO restrictions on redistribution.

- The archive.org listing explicitly marks it as "Public Domain Mark 1.0"
- Terry A. Davis intentionally placed all of TempleOS in the public domain
- Unlike GPL, MIT, or BSD licenses, there are zero requirements — no attribution needed, no license file required
- **You can freely bundle, redistribute, modify, and serve the ISO in any way**

## 3. CORS Analysis

### ❌ archive.org — NO CORS Support
- Direct download URLs (`https://archive.org/download/...` and `https://ia*.us.archive.org/...`) do **NOT** return `Access-Control-Allow-Origin` headers
- OPTIONS preflight requests return 405 Method Not Allowed
- **Cannot be fetched via JavaScript `fetch()` or `XMLHttpRequest` from a different origin**

### ✅ GitHub Raw Content — CORS Supported
- `raw.githubusercontent.com` returns `access-control-allow-origin: *`
- Suitable for files stored in GitHub repos
- **Size limit**: GitHub warns on files > 50MB, blocks > 100MB (17MB ISO is fine)

### ✅ GitHub Release Assets — CORS Supported (with redirect)
- GitHub Releases redirect to `release-assets.githubusercontent.com` which supports CORS
- Suitable for hosting the ISO as a release asset

### ✅ copy.sh CDN (v86 demo) — CORS Supported  
- The v86 demo at `copy.sh/v86` serves images from `https://i.copy.sh/` with `access-control-allow-origin: *`
- This is the v86 author's own CDN, not available for third-party use

### ✅ Same-Origin Serving — Always Works
- Serving the ISO from the same domain/origin as the web app avoids all CORS issues
- This is the most reliable approach

## 4. Existing Browser-Based TempleOS Projects

| Project | URL | Approach |
|---------|-----|----------|
| **TempleOS Cloud** | `https://templeos.zasenko.name/` | Server-side QEMU, streams display to browser (NOT client-side emulation) |
| **Instant Workstation** | `https://instantworkstation.com/` | Server-side VMs, browser just displays |
| **v86 TempleOS Emulator** (WebSim) | `https://websim.com/@api/templeos-emulator-2` | Client-side v86, user uploads ISO |
| **v86 demo site** | `https://copy.sh/v86/` | Hosts many OSes but does NOT include TempleOS (likely due to 64-bit requirement) |

### ⚠️ Critical Note: v86 and TempleOS Compatibility
TempleOS is a **64-bit only** operating system. v86 currently does **NOT support 64-bit extensions** (x86_64/long mode). The v86 README explicitly states: "64-bit extensions" are missing.

**This means standard TempleOS CANNOT run in v86.** This is likely why copy.sh/v86 doesn't include TempleOS in its demos.

Workarounds:
1. Use an alternative emulator that supports x86_64 (e.g., QEMU compiled to WASM)
2. Use a server-side approach (like TempleOS Cloud does with QEMU)
3. Check if any patched/32-bit compatible version of TempleOS exists (unlikely — TempleOS was designed exclusively for x86_64)

## 5. Recommended Approach for Serving ISO Without User Download

### **Primary Recommendation: Bundle with the Web App (Same-Origin)**

Since the ISO is only ~17 MB and is public domain:

1. **Include the ISO in your project repository** (17MB is well under GitHub's 100MB limit)
2. **Serve it from the same origin** as your web application
3. The web app fetches it transparently when the user loads the page

```javascript
// v86 configuration example - ISO served from same origin
var emulator = new V86({
    screen_container: document.getElementById("screen_container"),
    bios: { url: "/bios/seabios.bin" },
    vga_bios: { url: "/bios/vgabios.bin" },
    cdrom: { url: "/images/TempleOSCDV5.03.ISO" },  // Same-origin, no CORS issues
    autostart: true,
    memory_size: 512 * 1024 * 1024,  // 512MB RAM (TempleOS needs min 512MB)
});
```

**Advantages:**
- Zero CORS issues
- No external dependencies
- Fastest load time (served from same CDN as the app)
- Works offline if service worker caches it
- Public domain = no legal issues

### **Alternative: GitHub Release Asset as CDN**

If you don't want the ISO in your main repo:

1. Create a separate GitHub repo (e.g., `your-org/templeos-assets`)
2. Upload the ISO as a GitHub Release asset
3. Fetch from `https://github.com/your-org/templeos-assets/releases/download/v1.0/TempleOSCDV5.03.ISO`
4. GitHub release assets support CORS (`access-control-allow-origin: *`)

### **Alternative: Cloudflare R2 / AWS S3 / Any CDN**

Upload the ISO to any CDN with CORS headers configured. Cost is negligible for a 17MB file.

## 6. Technical Implementation Notes

### Optimizing Load Time
- **Compress during transfer**: The ISO may compress well with gzip/brotli (HTTP compression). Configure your web server to compress `.iso` files.
- **Cache aggressively**: Set long cache headers since the ISO never changes. Use a content-hash in the filename for cache busting.
- **Show progress**: Use `fetch()` with `ReadableStream` to show download progress to the user.
- **Consider lazy loading**: Don't fetch the ISO until the user clicks "Start" or similar.

### v86 Loading Options
v86 supports multiple ways to provide disk images:

```javascript
// Option 1: URL (fetched via XHR)
cdrom: { url: "/images/TempleOS.ISO" }

// Option 2: ArrayBuffer (pre-loaded)
cdrom: { buffer: arrayBuffer }

// Option 3: AsyncFileBuffer for large files
cdrom: { url: "/images/TempleOS.ISO", async: true }
```

### File Size Comparison
| Asset | Size | Notes |
|-------|------|-------|
| TempleOS ISO | 17.0 MB | The OS itself |
| v86 WASM | ~2 MB | The emulator engine |
| SeaBIOS | ~256 KB | BIOS firmware |
| VGA BIOS | ~64 KB | VGA firmware |
| **Total** | **~19.3 MB** | Everything needed to run |

This is very reasonable for a modern web app. Many single-page apps are larger than this.

## 7. ⚠️ CRITICAL BLOCKER: 64-bit Compatibility

**TempleOS requires x86_64 (64-bit long mode) which v86 does NOT support.**

If the project aims to use v86 specifically, this is a fundamental compatibility issue that must be resolved before ISO hosting matters. Options:

1. **Use a different emulator** — Look into projects that compile QEMU or Bochs to WebAssembly
2. **Server-side emulation** — Run QEMU on a server, stream the display (this is what TempleOS Cloud does)
3. **JSLinux** — Fabrice Bellard's JSLinux may have 64-bit support (it's based on his own TinyEMU)
4. **Consider if a 32-bit TempleOS fork exists** — Unlikely, as Terry designed it exclusively for x86_64

This compatibility question should be resolved before finalizing the ISO hosting strategy.
