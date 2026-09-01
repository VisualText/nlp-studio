# NLP-Studio phase 1: the real dehilster.nlp extension, in a browser tab.
#
# Build context is stopgap/. Requires stopgap/vsix/vscode.nlp.vsix, produced by
# scripts/build-vsix.sh (or .ps1) from a sibling checkout of VisualText/vscode-nlp.
# The extension is not published to Open VSX, so it cannot be installed by
# marketplace id -- the vsix must be built and copied in.

ARG OPENVSCODE_TAG=latest
FROM gitpod/openvscode-server:${OPENVSCODE_TAG}

# Which upstream releases to bake in. Defaulting to "latest" keeps a plain
# "docker compose build" working exactly as before. update-studio.sh resolves the
# real tags first and passes them here so the resulting image can be labelled
# with its contents, and so a release published mid-build cannot yield an image
# whose engine and extension came from different moments.
#
# VSCODE_NLP_TAG is a label only -- the extension itself arrives as
# vsix/vscode.nlp.vsix, put there by scripts/fetch-vsix.sh or build-vsix.sh.
ARG NLP_ENGINE_TAG=latest
ARG VISUALTEXT_FILES_TAG=latest
ARG ANALYZERS_TAG=latest
ARG VSCODE_NLP_TAG=unknown
ARG BUILD_DATE=unknown

# The base image sets HOME=/home/workspace, which is also its documented bind-mount
# point. The extension derives its engine directory from $HOME
# (visualText.extensionParentDirectory() -> $HOME/.vscode/extensions), so leaving
# HOME on the mount point would let a host mount shadow the baked engine. Move HOME
# off the mount and keep /home/workspace as nothing but the analyzer workspace.
ENV HOME=/home/nlpstudio
ENV NLP_STUDIO_EXTENSIONS=/home/nlpstudio/.vscode/extensions
ENV NLP_STUDIO_WORKSPACE=/home/workspace

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

# The server mkdirs its own data directory non-recursively, so $HOME and the
# extensions dir must already exist -- otherwise --install-extension dies with
# ENOENT on /home/nlpstudio/.openvscode-server/data/User/globalStorage.
RUN mkdir -p "${NLP_STUDIO_EXTENSIONS}" \
             "${HOME}/.openvscode-server/data/User" \
             "${NLP_STUDIO_WORKSPACE}"

# Installing into $HOME/.vscode/extensions (rather than the server default of
# $HOME/.openvscode-server/extensions) is what lets the extension's own
# getExtensionDirs() scan find itself and resolve its version -- with no version
# it would compute a malformed engine path and re-download the engine on every start.
COPY vsix/vscode.nlp.vsix /tmp/vscode.nlp.vsix
RUN "${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server" \
        --install-extension /tmp/vscode.nlp.vsix \
        --extensions-dir "${NLP_STUDIO_EXTENSIONS}" \
    && rm /tmp/vscode.nlp.vsix

# Pre-bake the engine so a container starts instantly and runs offline. Without
# this the extension downloads ~45 MB from GitHub on first activation.
COPY scripts/install-engine.sh /tmp/install-engine.sh
RUN chmod +x /tmp/install-engine.sh \
    && NLP_ENGINE_TAG="${NLP_ENGINE_TAG}" \
       VISUALTEXT_FILES_TAG="${VISUALTEXT_FILES_TAG}" \
       ANALYZERS_TAG="${ANALYZERS_TAG}" \
       /tmp/install-engine.sh "${NLP_STUDIO_EXTENSIONS}" \
    && rm /tmp/install-engine.sh

# Seed the workspace with tutorials and templates so the analyzer views are
# populated on first open rather than empty.
COPY scripts/seed-workspace.sh /tmp/seed-workspace.sh
RUN chmod +x /tmp/seed-workspace.sh \
    && /tmp/seed-workspace.sh "${NLP_STUDIO_EXTENSIONS}" "${NLP_STUDIO_WORKSPACE}" \
    && rm /tmp/seed-workspace.sh

# Stable alias for the example analyzer collections -- corporate, files,
# nlp-tutorials, nlpfix-analyzers, parse-en-us.
#
# This is the directory the extension's "Load Example Analyzers" cog opens:
# analyzerView.loadExampleAnalyzers() calls openFolder(getBlockAnalyzersPath()),
# which resolves to <extension>/nlp-engine/analyzers. That real path embeds the
# extension version (dehilster.nlp-3.11.13), so linking it to a fixed location
# keeps the landing URL working across extension upgrades.
RUN ln -s "$(find "${NLP_STUDIO_EXTENSIONS}" -maxdepth 1 -type d -name 'dehilster.nlp-*' \
        | sort -V | tail -n 1)/nlp-engine/analyzers" /home/examples \
    && test -d /home/examples/nlp-tutorials

# The extension writes into the engine directory at runtime (logs, state, tmp,
# analyzer output), so it cannot be root-owned.
RUN chown -R openvscode-server:openvscode-server /home/nlpstudio /home/workspace

# What this image contains, in a form update-studio.sh can read without starting
# a container:
#   docker image inspect nlp-studio:stopgap \
#       --format '{{json .Config.Labels}}' | python3 -m json.tool
LABEL org.visualtext.vscode-nlp="${VSCODE_NLP_TAG}" \
      org.visualtext.nlp-engine="${NLP_ENGINE_TAG}" \
      org.visualtext.visualtext-files="${VISUALTEXT_FILES_TAG}" \
      org.visualtext.analyzers="${ANALYZERS_TAG}" \
      org.visualtext.built-at="${BUILD_DATE}"

USER openvscode-server
WORKDIR /home/workspace

EXPOSE 3000

# Appended to the base image's ENTRYPOINT, which already supplies
# --host 0.0.0.0 --without-connection-token.
CMD ["--extensions-dir", "/home/nlpstudio/.vscode/extensions"]
