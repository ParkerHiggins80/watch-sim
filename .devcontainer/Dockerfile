# Toolchain for building the simulator. Baked into the image so every Codespace
# gets the same versions without installing anything by hand.
FROM mcr.microsoft.com/devcontainers/base:3-noble

RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends cmake python3 xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Emscripten (C -> WebAssembly), installed as the dev user so its cache stays writable
ARG EMSDK_VERSION=6.0.12
USER vscode
RUN git clone --depth 1 --branch ${EMSDK_VERSION} https://github.com/emscripten-core/emsdk.git /home/vscode/emsdk \
    && cd /home/vscode/emsdk \
    && ./emsdk install ${EMSDK_VERSION} \
    && ./emsdk activate ${EMSDK_VERSION} \
    && rm -rf /home/vscode/emsdk/downloads
ENV EMSDK=/home/vscode/emsdk

# Claude Code (native installer). Goes in ~/.local as the dev user so it can
# update itself; the image only pins the starting version.
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH=/home/vscode/.local/bin:${PATH}
USER root
