# syntax = docker/dockerfile:1.5
#
# QEMU Wasm Build — Cross-compile QEMU for WebAssembly with Emscripten
# Based on ktock/container2wasm Dockerfile (proven build approach)
#
# Builds:
#   - zlib 1.3.2
#   - libffi (git checkout)
#   - GLib 2.75.0
#   - Pixman 0.42.2
#   - QEMU (ktock/qemu-wasm fork) with custom Emscripten display backend
#
# Reference: https://github.com/ktock/container2wasm/blob/main/Dockerfile

ARG EMSDK_VERSION_QEMU=4.0.10
ARG ZLIB_VERSION=1.3.2
ARG GLIB_MINOR_VERSION=2.75
ARG GLIB_VERSION=${GLIB_MINOR_VERSION}.0
ARG PIXMAN_VERSION=0.42.2
ARG FFI_VERSION=adbcf2b247696dde2667ab552cb93e0c79455c84
ARG MESON_VERSION=1.5.0

ARG QEMU_REPO=https://github.com/ktock/qemu-wasm
ARG QEMU_REPO_VERSION=8604ed49a3cde392890b014a8d5a959c8a2fe72a

# ==============================================================================
# Base image with Emscripten SDK and common build tools
# ==============================================================================
FROM emscripten/emsdk:${EMSDK_VERSION_QEMU} AS build-base
ARG MESON_VERSION
ENV TARGET=/builddeps/target
ENV CPATH="$TARGET/include"
ENV PKG_CONFIG_PATH="$TARGET/lib/pkgconfig"
ENV EM_PKG_CONFIG_PATH="$PKG_CONFIG_PATH"
ENV CFLAGS="-O2 -matomics -mbulk-memory -DNDEBUG -sWASM_BIGINT -DWASM_BIGINT -pthread -sMALLOC=emmalloc -sASYNCIFY=1"
ENV CXXFLAGS="$CFLAGS"
ENV LDFLAGS="-L$TARGET/lib -O2"
ENV CHOST="wasm32-unknown-linux"
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    autoconf \
    build-essential \
    libglib2.0-dev \
    libtool \
    pkgconf \
    ninja-build \
    python3-pip \
    pipx
RUN PIPX_BIN_DIR=/usr/local/bin pipx install meson==${MESON_VERSION}
RUN pip3 install tomli || true
RUN mkdir /build
WORKDIR /build
RUN mkdir -p $TARGET

# ==============================================================================
# Clone QEMU source
# ==============================================================================
FROM ubuntu:22.04 AS qemu-repo-base
ARG QEMU_REPO
ARG QEMU_REPO_VERSION
RUN apt-get update && apt-get install -y git
RUN git clone --depth 100 ${QEMU_REPO} /qemu && \
    cd /qemu && \
    git checkout ${QEMU_REPO_VERSION}
FROM scratch AS qemu-repo
COPY --link --from=qemu-repo-base /qemu /

# ==============================================================================
# zlib cross-compiled for Emscripten
# ==============================================================================
FROM build-base AS zlib-dev
ARG ZLIB_VERSION
RUN mkdir -p /zlib
RUN curl -LsS https://zlib.net/fossils/zlib-${ZLIB_VERSION}.tar.gz | \
    tar xzC /zlib --strip-components=1
WORKDIR /zlib
RUN emconfigure ./configure --prefix=$TARGET --static
RUN emmake make install -j$(nproc)

# ==============================================================================
# libffi cross-compiled for Emscripten
# ==============================================================================
FROM build-base AS libffi-dev
ARG FFI_VERSION
RUN mkdir -p /libffi
RUN git clone https://github.com/libffi/libffi /libffi
WORKDIR /libffi
RUN git checkout $FFI_VERSION
RUN autoreconf -fiv
RUN emconfigure ./configure --host=$CHOST \
    --prefix=$TARGET --enable-static \
    --disable-shared --disable-dependency-tracking \
    --disable-builddir --disable-multi-os-directory \
    --disable-raw-api --disable-structs --disable-docs || cat config.log
RUN emmake make install SUBDIRS='include' -j$(nproc)

# ==============================================================================
# Pixman cross-compiled for Emscripten (using autotools, matching reference)
# ==============================================================================
FROM build-base AS pixman-dev
ARG PIXMAN_VERSION
RUN mkdir /pixman/
RUN git clone https://gitlab.freedesktop.org/pixman/pixman /pixman/
WORKDIR /pixman
RUN git checkout pixman-$PIXMAN_VERSION
RUN NOCONFIGURE=y ./autogen.sh
RUN emconfigure ./configure --prefix=$TARGET
RUN emmake make -j$(nproc)
RUN emmake make install
# Remove shared libs that emscripten may create (we want static only)
RUN rm -f $TARGET/lib/libpixman-1.so $TARGET/lib/libpixman-1.so.0 \
    $TARGET/lib/libpixman-1.so.$PIXMAN_VERSION || true

# ==============================================================================
# GLib cross-compiled for Emscripten (with res_query stub)
# ==============================================================================
FROM build-base AS glib-dev
ARG GLIB_VERSION
ARG GLIB_MINOR_VERSION

# Create libresolv stub
RUN mkdir -p /stub
WORKDIR /stub
RUN <<EOF
cat <<'EOT' > res_query.c
#include <netdb.h>
int res_query(const char *name, int class,
              int type, unsigned char *dest, int len)
{
    h_errno = HOST_NOT_FOUND;
    return -1;
}
EOT
EOF
RUN emcc ${CFLAGS} -c res_query.c -fPIC -o libresolv.o
RUN emar rcs libresolv.a libresolv.o
RUN mkdir -p $TARGET/lib/
RUN cp libresolv.a $TARGET/lib/

RUN mkdir -p /glib
RUN curl -Lks https://download.gnome.org/sources/glib/${GLIB_MINOR_VERSION}/glib-$GLIB_VERSION.tar.xz | \
    tar xJC /glib --strip-components=1

COPY --link --from=zlib-dev /builddeps/ /builddeps/
COPY --link --from=libffi-dev /builddeps/ /builddeps/

WORKDIR /glib

# Override CFLAGS to suppress incompatible-function-pointer-types as error
# (matching container2wasm reference)
ENV CFLAGS="-Wno-error=incompatible-function-pointer-types -Wincompatible-function-pointer-types -O2 -matomics -mbulk-memory -DNDEBUG -pthread -sWASM_BIGINT -sMALLOC=emmalloc -sASYNCIFY=1"
ENV CXXFLAGS="$CFLAGS"

# Meson cross file with emcc wrapper to suppress warning-as-error
RUN <<'EOF'
cat <<'EOT' > /emcc-meson-wrap.sh
#!/bin/bash
set -euo pipefail
old_string="-Werror=unused-command-line-argument"
new_string="-Wno-error=unused-command-line-argument"
cmd="$1"
shift
new_args=()
for arg in "$@"; do
    new_arg="${arg//$old_string/$new_string}"
    new_args+=("$new_arg")
done
"$cmd" "${new_args[@]}"
EOT
chmod +x /emcc-meson-wrap.sh
EOF

RUN <<'EOF'
cat <<EOT > /cross.meson
[host_machine]
system = 'emscripten'
cpu_family = 'wasm32'
cpu = 'wasm32'
endian = 'little'

[binaries]
c = ['bash', '/emcc-meson-wrap.sh', 'emcc']
cpp = ['bash', '/emcc-meson-wrap.sh', 'em++']
ar = 'emar'
ranlib = 'emranlib'
pkgconfig = ['pkg-config', '--static']
EOT
EOF

RUN meson setup _build --prefix=$TARGET --cross-file=/cross.meson \
    --default-library=static --buildtype=release \
    --force-fallback-for=pcre2,gvdb \
    -Dselinux=disabled -Dxattr=false -Dlibmount=disabled -Dnls=disabled \
    -Dtests=false -Dglib_assert=false -Dglib_checks=false

# Emscripten doesn't provide some system functions — patch config.h
RUN sed -i -E "/#define HAVE_CLOSE_RANGE 1/d" ./_build/config.h
RUN sed -i -E "/#define HAVE_EPOLL_CREATE 1/d" ./_build/config.h
RUN sed -i -E "/#define HAVE_KQUEUE 1/d" ./_build/config.h
RUN sed -i -E "/#define HAVE_POSIX_SPAWN 1/d" ./_build/config.h
RUN sed -i -E "/#define HAVE_FALLOCATE 1/d" ./_build/config.h
RUN sed -i -E "/#define HAVE_PTHREAD_GETNAME_NP 1/d" ./_build/config.h

RUN meson install -C _build

# ==============================================================================
# Final build image — clone QEMU, add display backend, configure and build
# ==============================================================================
FROM build-base AS qemu-build

COPY --link --from=glib-dev /builddeps/ /builddeps/
COPY --link --from=pixman-dev /builddeps/ /builddeps/
COPY --link --from=qemu-repo / /qemu

# Install xterm-pty (needed for QEMU's pty integration)
WORKDIR /qemu
RUN mkdir -p build
WORKDIR /qemu/build
RUN npm i xterm-pty@v0.10.1
RUN cp /qemu/build/node_modules/xterm-pty/emscripten-pty.js $TARGET/lib/libemscripten-pty.js
ENV XTERM_PTY_CFLAGS="-lemscripten-pty.js -Wno-unused-command-line-argument"

# Copy our custom Emscripten display backend into the QEMU source tree
COPY emscripten.c /qemu/ui/emscripten.c

# Patch QEMU osdep.h: Emscripten 4.x provides getloadavg in stdlib.h
# which conflicts with QEMU's static inline definition.
# We wrap the fallback definition with an __EMSCRIPTEN__ guard.
RUN cd /qemu && \
    sed -i 's/^#ifndef HAVE_GETLOADAVG_FUNCTION$/#if !defined(HAVE_GETLOADAVG_FUNCTION) \&\& !defined(__EMSCRIPTEN__)/' include/qemu/osdep.h

# Patch QEMU memalign.c: Emscripten provides aligned_alloc but
# QEMU's configure may not detect posix_memalign. Add Emscripten fallback.
RUN <<'PATCH_MEMALIGN'
cd /qemu
python3 -c "
with open('util/memalign.c', 'r') as f:
    content = f.read()
content = content.replace(
    '#else\n    #error No function to allocate aligned memory available',
    '#elif defined(__EMSCRIPTEN__)\n    ptr = aligned_alloc(alignment, size);\n#else\n    #error No function to allocate aligned memory available'
)
with open('util/memalign.c', 'w') as f:
    f.write(content)
"
PATCH_MEMALIGN

# Patch QEMU build system to include our display backend
# Add emscripten.c to ui/meson.build as a source file in system_ss
RUN <<'PATCH_MESON'
cd /qemu/ui && \
if ! grep -q 'emscripten.c' meson.build; then
  # Append our file to the system_ss sources
  echo '' >> meson.build
  echo '# Emscripten display backend for browser-based rendering' >> meson.build
  echo "system_ss.add(files('emscripten.c'))" >> meson.build
fi
PATCH_MESON

# Configure QEMU for x86_64 Wasm target
# Matching container2wasm's approach exactly
WORKDIR /qemu/build

RUN EXTRA_CFLAGS="-O3 -g -Wno-error=unused-command-line-argument -Wno-error=unused-but-set-variable -matomics -mbulk-memory -DNDEBUG -DG_DISABLE_ASSERT -D_GNU_SOURCE -sASYNCIFY=1 -pthread -sPROXY_TO_PTHREAD=1 -sFORCE_FILESYSTEM -sALLOW_TABLE_GROWTH -sTOTAL_MEMORY=2300MB -sWASM_BIGINT -sMALLOC=emmalloc ${XTERM_PTY_CFLAGS}" && \
    emconfigure ../configure \
        --static \
        --target-list=x86_64-softmmu \
        --cpu=wasm32 \
        --cross-prefix= \
        --without-default-features \
        --enable-system \
        --with-coroutine=fiber \
        --extra-cflags="$EXTRA_CFLAGS" \
        --extra-cxxflags="$EXTRA_CFLAGS" \
        --extra-ldflags="\
            -sEXPORTED_RUNTIME_METHODS=getTempRet0,setTempRet0,addFunction,removeFunction,TTY,FS \
            -sEXPORTED_FUNCTIONS=_main,_malloc,_free,_qemu_setup_display,_qemu_display_data,_qemu_display_width,_qemu_display_height,_qemu_display_stride,_qemu_display_frame_count,_qemu_display_check_dirty,_qemu_input_send_key,_qemu_input_send_mouse,_qemu_input_send_mouse_abs"

# Build QEMU
RUN emmake make -j$(nproc) qemu-system-x86_64

# Copy build output to /output
RUN mkdir -p /output && \
    cp /qemu/build/qemu-system-x86_64 /output/qemu-system-x86_64.js && \
    cp /qemu/build/qemu-system-x86_64.wasm /output/ && \
    (cp /qemu/build/qemu-system-x86_64.worker.js /output/ || true)

# Copy BIOS/ROM files needed for x86_64 boot
RUN mkdir -p /output/bios && \
    cp /qemu/pc-bios/bios-256k.bin /output/bios/ && \
    cp /qemu/pc-bios/vgabios-stdvga.bin /output/bios/ && \
    cp /qemu/pc-bios/kvmvapic.bin /output/bios/ && \
    cp /qemu/pc-bios/linuxboot_dma.bin /output/bios/

# Final stage — just the output artifacts
FROM scratch AS output
COPY --from=qemu-build /output/ /
