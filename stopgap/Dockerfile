# NLP-Studio phase 1: the real dehilster.nlp extension, in a browser tab.
#
# Build context is stopgap/. Requires stopgap/vsix/vscode.nlp.vsix, produced by
# scripts/build-vsix.sh (or .ps1) from a sibling checkout of VisualText/vscode-nlp.
# The extension is not published to Open VSX, so it cannot be installed by
# marketplace id -- the vsix must be built and copied in.

ARG OPENVSCODE_TAG=latest
FROM gitpod/openvscode-server:${OPENVSCODE_TAG}

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
    && /tmp/install-engine.sh "${NLP_STUDIO_EXTENSIONS}" \
    && rm /tmp/install-engine.sh

# Seed the workspace with tutorials and templates so the analyzer views are
# populated on first open rather than empty.
COPY scripts/seed-workspace.sh /tmp/seed-workspace.sh
RUN chmod +x /tmp/seed-workspace.sh \
    && /tmp/seed-workspace.sh "${NLP_STUDIO_EXTENSIONS}" "${NLP_STUDIO_WORKSPACE}" \
    && rm /tmp/seed-workspace.sh

# The extension writes into the engine directory at runtime (logs, state, tmp,
# analyzer output), so it cannot be root-owned.
RUN chown -R openvscode-server:openvscode-server /home/nlpstudio /home/workspace

USER openvscode-server
WORKDIR /home/workspace

EXPOSE 3000

# Appended to the base image's ENTRYPOINT, which already supplies
# --host 0.0.0.0 --without-connection-token.
CMD ["--extensions-dir", "/home/nlpstudio/.vscode/extensions"]
