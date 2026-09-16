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

FROM node:22-slim AS site
ARG VISUALTEXT_FILES_TAG

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

WORKDIR /src/analyzer-views
COPY analyzer-views/package.json analyzer-views/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY analyzer-views/ ./

WORKDIR /src/studio
COPY studio/package.json studio/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY studio/ ./
ENV ANALYZER_TEMPLATES=/visualtext/analyzer-templates
RUN npm run build


FROM python:3.12-slim
ARG VISUALTEXT_FILES_TAG
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
      org.visualtext.built-at="${BUILD_DATE}"

USER studio
EXPOSE 3001

# Loopback only: nginx in front holds the password. See studio/deploy/INSTALL.md.
CMD ["python", "server/app.py", "--host", "127.0.0.1", "--port", "3001", "--dist", "dist"]
