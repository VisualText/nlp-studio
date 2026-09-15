# NLP Studio at studio.visualtext.org/studio/

The phase-2 studio — the editor and its run server — as a second container beside
the phase-1 editor, on the same host name and behind the same password.

```
  nginx :443  (Basic auth, .htpasswd-studio)
     ├── /studio/  ->  127.0.0.1:3001   nlp-studio-app   (this directory)
     └── /         ->  127.0.0.1:3000   nlp-studio       (stopgap/)
```

Commands marked **as visualtext** run as the account that owns the site and is in the
`docker` group; **as root** only for nginx.

## What is contained, and what is not

Running an analyzer is running its author's code: NLP++ has file functions that take
any path. The run server refuses `system()`, `urltofile()` and the like before a run
(see [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#the-run-server-is-not-a-sandbox)),
and the container adds, around every run:

- a **read-only root filesystem** — the only writable place is `/tmp` (512 MB, in
  memory), where each run gets its own folder that is deleted after it;
- **no Linux capabilities**, `no-new-privileges`, and an unprivileged user;
- **1 CPU, 1 GB of memory, 128 processes**, so a runaway pass cannot starve the
  sites on this host; each run is also killed after 10 seconds.

What it does **not** have is network isolation. CSF on this host forces host
networking (the reason is in [docker-compose.yml](docker-compose.yml)), so a
process in the container can reach whatever listens on the host's loopback.

That is acceptable here for one reason: everyone who has the studio password
already has a terminal on this host through the phase-1 editor at `/`. This
deployment adds no access they do not already have. It is **not** fit to serve
people without that password — that needs the per-run sandbox described in
ARCHITECTURE.md.

## Install

### 1. Get the files — as visualtext

    cd /home/visualtext/nlp-studio && git pull

### 2. Build, test and start the container — as visualtext

    /home/visualtext/nlp-studio/studio/deploy/update.sh --force

The first build takes a few minutes (a Node build, then Python with NLPPlus). Before
starting anything it runs [smoke-test.sh](smoke-test.sh) on port 3998, under the same
restrictions as the live container: the sample analyzer must run to its known output,
`system()` must be refused, and a run must fail to write outside `/tmp`. Then:

    curl -s http://127.0.0.1:3001/api/health
    # {"ok": true, "engine": "2.2.37", "timeout": 10.0, "maxRuns": 2}

Nothing is public yet: the container listens on loopback only.

### 3. Route /studio/ in nginx — as root

The phase-1 nginx file now also carries the `/studio/` locations. Install it over
the old copy:

    d=/home/visualtext/nlp-studio/stopgap/deploy
    cp /etc/nginx/conf.d/users/visualtext/studio.visualtext.org/nlp-studio.conf /root/nlp-studio.conf.before-app
    cp "$d/nginx-studio.conf" /etc/nginx/conf.d/users/visualtext/studio.visualtext.org/nlp-studio.conf
    nginx -t

`nginx -t` must report `test is successful` before the reload:

    /usr/local/cpanel/scripts/restartsrv_nginx

Apache needs no change. `/studio/` never reaches it: nginx answers the whole host
name, as for phase 1.

### 4. Verify — in this order

    U=david:PASSWORD
    S=https://studio.visualtext.org

    # authenticated first -- this is what would populate a cache
    curl -sk -o /dev/null -w '%{http_code}\n' -u "$U" $S/studio/              # 200
    curl -sk -u "$U" $S/studio/api/health                                     # {"ok": true, ...}

    # anonymous IMMEDIATELY after: 401, never a cached 200
    curl -sk -o /dev/null -w '%{http_code}\n' $S/studio/                      # 401
    curl -sk -o /dev/null -w '%{http_code}\n' $S/studio/api/health            # 401
    curl -sk -o /dev/null -w '%{http_code}\n' -X POST $S/studio/api/run       # 401

    # phase 1 is unchanged
    curl -sk -o /dev/null -w '%{http_code}\n' -u "$U" $S/                     # 302 (to ?folder=/home/examples)

A 200 on any anonymous request means `/studio/` is open to everyone: stop the container
(`docker compose -f studio/deploy/docker-compose.yml down`) and put the old nginx file back.

Then, in a browser, open <https://studio.visualtext.org/studio/>, and press **Run**.

## Keeping it current

The **Deploy NLP-Studio** workflow — the one that updates phase 1 on every upstream
release, on the self-hosted runner — runs `update.sh` after phase 1's update. It
rebuilds only when something moved:

- **a new commit in this checkout** — which only happens after a deliberate
  `git pull` here, the same rule as for phase 1 (see stopgap/deploy/UPDATES.md);
- **a new visualtext-files release**, for the analyzer templates.

The weekly forced run rebuilds it too, which picks up fixes in the Node and Python
base images.

By hand, as visualtext:

    cd /home/visualtext/nlp-studio
    git pull
    studio/deploy/update.sh             # update if anything moved
    studio/deploy/update.sh --check     # report, change nothing (exit 2: update available)
    studio/deploy/update.sh --no-swap   # build and test only

Logs go to `stopgap/logs/update-app-YYYY-MM.log`.

## What is running

    docker image inspect nlp-studio:app --format '{{json .Config.Labels}}'
    docker logs --tail 50 nlp-studio-app

## Rolling back

    docker tag nlp-studio:app-previous nlp-studio:app
    docker compose -f /home/visualtext/nlp-studio/studio/deploy/docker-compose.yml up -d

## Removing it

As root, put back the nginx file from before step 3 and reload:

    cp /root/nlp-studio.conf.before-app /etc/nginx/conf.d/users/visualtext/studio.visualtext.org/nlp-studio.conf
    nginx -t && /usr/local/cpanel/scripts/restartsrv_nginx

As visualtext:

    docker compose -f /home/visualtext/nlp-studio/studio/deploy/docker-compose.yml down
    docker image rm nlp-studio:app nlp-studio:app-previous

Phase 1 is untouched by all of this.
