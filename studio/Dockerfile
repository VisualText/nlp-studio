# NLP Studio (phase 2): the static site and its run server, in one image.
#
#   docker build -f studio/Dockerfile -t nlp-studio:app .
#
# From the top of the repository: the site is built with analyzer-views/, the
# sequence and knowledge-base lists it shares with other pages.
#
# On studio.visualtext.org, studio/deploy/update.sh builds, tests and swaps this;
# see studio/deploy/INSTALL.md. Stage one builds the site with Node; stage two is
# Python with NLPPlus, serving the site and /api/ from one address.

# Which visualtext-files release the analyzer templates come from. "latest" keeps
# a plain docker build working; update.sh pins the tag it resolved, so the image
# can be labelled with what went into it.
ARG VISUALTEXT_FILES_TAG=latest

# Which VisualText/analyzers release the try page's analyzers come from: the same
# analyzers.zip VisualText downloads as its examples, so /try/ offers the set a
# VisualText user has. update.sh pins the tag it resolved.
ARG VISUALTEXT_ANALYZERS_TAG=latest

FROM node:22-slim AS site
ARG VISUALTEXT_FILES_TAG
ARG VISUALTEXT_ANALYZERS_TAG

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

# The templates the studio lists, from the visualtext-files release: the same zip
# the phase-1 image installs (stopgap/scripts/install-engine.sh), so this ships
# nothing the site does not already.
RUN set -eu; \
    if [ "$VISUALTEXT_FILES_TAG" = latest ]; then \
        url="https://github.com/VisualText/visualtext-files/releases/latest/download/visualtext.zip"; \
    else \
        url="https://github.com/VisualText/visualtext-files/releases/download/$VISUALTEXT_FILES_TAG/visualtext.zip"; \
    fi; \
    curl -fsSL --retry 3 --retry-delay 2 -o /tmp/visualtext.zip "$url"; \
    mkdir -p /visualtext; \
    unzip -q /tmp/visualtext.zip -d /visualtext; \
    rm /tmp/visualtext.zip; \
    test -d /visualtext/analyzer-templates

# VisualText's own analyzers, for the try page. The zip holds the five bundled entries
# (corporate, files, parse-en-us, nlp-tutorials, nlpfix-analyzers); copy-analyzers.mjs
# picks from them.
RUN set -eu; \
    if [ "$VISUALTEXT_ANALYZERS_TAG" = latest ]; then \
        url="https://github.com/VisualText/analyzers/releases/latest/download/analyzers.zip"; \
    else \
        url="https://github.com/VisualText/analyzers/releases/download/$VISUALTEXT_ANALYZERS_TAG/analyzers.zip"; \
    fi; \
    curl -fsSL --retry 3 --retry-delay 2 -o /tmp/analyzers.zip "$url"; \
    mkdir -p /analyzers; \
    unzip -q /tmp/analyzers.zip -d /analyzers; \
    rm /tmp/analyzers.zip; \
    test -d /analyzers/nlp-tutorials

WORKDIR /src/analyzer-views
COPY analyzer-views/package.json analyzer-views/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY analyzer-views/ ./

WORKDIR /src/studio
COPY studio/package.json studio/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY studio/ ./
ENV ANALYZER_TEMPLATES=/visualtext/analyzer-templates \
    VISUALTEXT_ANALYZERS=/analyzers \
    VISUALTEXT_ANALYZERS_TAG=${VISUALTEXT_ANALYZERS_TAG}
RUN npm run build


FROM python:3.12-slim
ARG VISUALTEXT_FILES_TAG
ARG VISUALTEXT_ANALYZERS_TAG
ARG NLP_STUDIO_COMMIT=unknown
ARG BUILD_DATE=unknown

# No bytecode files: the root filesystem is read-only when it runs. HOME points at
# the one writable place, for anything that insists on a home directory.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp

RUN useradd --system --uid 10001 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin studio

WORKDIR /app
COPY studio/server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
COPY studio/server/app.py studio/server/child.py studio/server/nlp_run.py studio/server/github.py \
     studio/server/sessions.py studio/server/trees.py server/
COPY --from=site /src/studio/dist dist

# What this image contains, readable without starting it:
#   docker image inspect nlp-studio:app --format '{{json .Config.Labels}}'
LABEL org.visualtext.nlp-studio="${NLP_STUDIO_COMMIT}" \
      org.visualtext.visualtext-files="${VISUALTEXT_FILES_TAG}" \
      org.visualtext.analyzers="${VISUALTEXT_ANALYZERS_TAG}" \
      org.visualtext.built-at="${BUILD_DATE}"

USER studio
EXPOSE 3002

# Loopback only: nginx in front holds the password. See studio/deploy/INSTALL.md.
CMD ["python", "server/app.py", "--host", "127.0.0.1", "--port", "3002", "--dist", "dist"]
