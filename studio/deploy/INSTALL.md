# NLP Studio at studio.visualtext.org/studio/

The phase-2 studio — the editor, its run server, and GitHub for invited people — as a
second container beside the phase-1 editor, on the same host name.

```
  nginx :443
     ├── /studio/  ->  127.0.0.1:3002   nlp-studio-app   (this directory)
     │                 the site's password, or GitHub sign-in (nginx-app-*.conf)
     └── /         ->  127.0.0.1:3000   nlp-studio       (stopgap/, the site's password)
```

It starts behind the site's password, exactly like phase 1. Once a GitHub App exists,
[Switching to GitHub sign-in](#switching-to-github-sign-in) replaces the password on
`/studio/` with invited GitHub accounts, who can open analyzers from repositories, run
them, and commit changes back as pull requests.

Commands marked **as visualtext** run as the account that owns the site and is in the
`docker` group; **as root** only for nginx.

## What is contained, and what is not

Running an analyzer is running its author's code: NLP++ has file functions that take
any path. The run server refuses `system()`, `urltofile()`, the `db*()` functions and
the like before a run (see
[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#the-run-server-is-not-a-sandbox)), and
the container adds, around every run:

- a **read-only root filesystem** — the only writable place is `/tmp` (512 MB, in
  memory), where each run gets its own folder that is deleted after it;
- **no Linux capabilities**, `no-new-privileges`, and an unprivileged user;
- **1 CPU, 1 GB of memory, 128 processes**, so a runaway pass cannot starve the sites
  on this host; each run is also killed after 10 seconds.

What it does **not** have is network isolation. CSF on this host forces host networking
(the reason is in [docker-compose.yml](docker-compose.yml)), so a process in the
container could reach what listens on the host's loopback. NLP++ has no built-in that
opens a connection — the one that fetches a URL is refused — so an analyzer cannot do it
through the language; the gap is for a flaw in the engine itself.

**Who that is acceptable for.** Behind the site's password, everyone who can run an
analyzer already has a terminal on this host through phase 1, so the app adds nothing.
With GitHub sign-in, invited people who have no phase-1 password can run analyzers too.
Invite only people you would trust with that: the list is `NLP_STUDIO_USERS`, and it is
not a public sign-up. Opening it to anyone would need the per-run sandbox described in
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

    curl -s http://127.0.0.1:3002/api/health
    # {"ok": true, "engine": "2.2.38", ..., "signIn": false, "github": false}

Nothing is public yet: the container listens on loopback only.

The container runs with `network_mode: host`, so port 3002 has to be free before it
starts — nothing warns you if another service already answers there, and the health
check above would be that service's answer rather than the studio's. Check first:

    ss -ltnp | grep ':3002 ' || echo "3002 is free"

If something else holds it, give the app another port in `docker-compose.yml` (the
`--port` in its `command`), `update.sh` (`HEALTH_URL`) and the nginx `proxy_pass`; they
must agree.

It was 3001 until another account on this host started a service there, bound to every
interface. That service is not this deployment's to move, so the app moved to 3002.

### 3. Route /studio/ in nginx, behind the password — as root

The `/studio/` locations are their own file, installed beside the phase-1 one. Put the
password variant in place, and bring the phase-1 file up to date (it no longer carries
`/studio/`):

    d=/home/visualtext/nlp-studio
    n=/etc/nginx/conf.d/users/visualtext/studio.visualtext.org
    cp "$n/nlp-studio.conf" /root/nlp-studio.conf.before-app
    cp "$d/stopgap/deploy/nginx-studio.conf"     "$n/nlp-studio.conf"
    cp "$d/studio/deploy/nginx-app-password.conf" "$n/nlp-studio-app.conf"
    nginx -t

`nginx -t` must report `test is successful` before the reload:

    /usr/local/cpanel/scripts/restartsrv_nginx

Apache needs no change. `/studio/` never reaches it: nginx answers the whole host name,
as for phase 1.

### 4. Verify — in this order

    U=david:PASSWORD
    S=https://studio.visualtext.org

    # authenticated first -- this is what would populate a cache
    curl -sk -o /dev/null -w '%{http_code}\n' -u "$U" $S/studio/              # 200
    curl -sk -u "$U" $S/studio/api/health                                     # {"ok": true, ...}
    curl -sk -o /dev/null -w '%{http_code}\n' -u "$U" $S/studio/try/          # 200

    # anonymous IMMEDIATELY after: 401, never a cached 200
    curl -sk -o /dev/null -w '%{http_code}\n' $S/studio/                      # 401
    curl -sk -o /dev/null -w '%{http_code}\n' $S/studio/api/health            # 401
    curl -sk -o /dev/null -w '%{http_code}\n' -X POST $S/studio/api/run       # 401
    curl -sk -o /dev/null -w '%{http_code}\n' $S/studio/try/                  # 401

    # phase 1 is unchanged
    curl -sk -o /dev/null -w '%{http_code}\n' -u "$U" $S/                     # 302 (to ?folder=/home/examples)

A 200 on any anonymous request means `/studio/` is open to everyone: stop the container
(`docker compose -f studio/deploy/docker-compose.yml down`) and put the old nginx files
back.

Then, in a browser, open <https://studio.visualtext.org/studio/>, and press **Run**.

## Switching to GitHub sign-in

Invited people sign in with their GitHub account instead of the site's password, open
analyzers from the repositories the app is installed on, and commit changes back as
pull requests. The server holds each person's GitHub token; the page never sees it.

### 1. Register the GitHub App — a VisualText owner, on github.com

VisualText → Settings → Developer settings → GitHub Apps → **New GitHub App**:

| Setting | Value |
|---|---|
| Name | `NLP Studio` (or any free name) |
| Homepage URL | `https://studio.visualtext.org/studio/` |
| Callback URL | `https://studio.visualtext.org/studio/api/auth/callback` |
| Expire user authorization tokens | on |
| Request user authorization (OAuth) during installation | off |
| Webhook | off (untick Active) |
| Repository permissions | **Contents: Read and write**, **Pull requests: Read and write** (Metadata: Read is added for you) |
| Account permissions | none |
| Where can this GitHub App be installed | **Any account** — so VisaLinkAI can install it for teg-analyzers |

Then, on the app's page: note the **Client ID**, and **Generate a new client secret**.
The secret is shown once; it goes into the file in step 3 and nowhere else.

### 2. Install the app on the repositories to edit

On the app's page, **Install App**: on VisualText for its repositories (analyzers,
analyzer-templates, ...), and — by a VisaLinkAI owner — on VisaLinkAI for teg-analyzers.
Choose **Only select repositories**. The studio lists exactly what the app is installed on
and the signed-in person can see; committing also needs that person to have push access.

### 3. Write the settings — as visualtext

    cd /home/visualtext/nlp-studio/studio/deploy
    cp env.example .env && chmod 600 .env
    nano .env      # the client ID and secret, the invited GitHub logins

`.env` is never committed (it is in `.gitignore`) and Compose reads it from this
directory. Keep `NLP_STUDIO_REQUIRE_SIGN_IN=1`: with it the app refuses to start unless
all the sign-in settings are there.

### 4. Restart the app with them — as visualtext

    docker compose -f /home/visualtext/nlp-studio/studio/deploy/docker-compose.yml up -d
    curl -s http://127.0.0.1:3002/api/health
    # ..., "signIn": true, "github": true}

`"signIn": true` is the only answer to go on with. If the container is not running, its
log says which setting is missing:

    docker logs --tail 20 nlp-studio-app

### 5. Take the password off /studio/ — as root

    n=/etc/nginx/conf.d/users/visualtext/studio.visualtext.org
    cp /home/visualtext/nlp-studio/studio/deploy/nginx-app-signin.conf "$n/nlp-studio-app.conf"
    nginx -t && /usr/local/cpanel/scripts/restartsrv_nginx

The phase-1 editor at `/` keeps its password.

### 6. Verify

    S=https://studio.visualtext.org

    curl -sk -o /dev/null -w '%{http_code}\n' $S/studio/                            # 200: the page
    curl -sk $S/studio/api/health                                                   # "signIn": true
    curl -sk -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
         -d '{"files":{},"text":""}' $S/studio/api/run                              # 401: running needs sign-in
    curl -sk -o /dev/null -w '%{http_code}\n' $S/studio/api/github/repos            # 401
    curl -sk -o /dev/null -w '%{http_code}\n' "$S/?folder=/home/examples"          # 401: phase 1 still asks
                                                                                    # (a bare / is 302: it redirects first)

A 200 from `/api/run` or `/api/github/repos` without signing in means sign-in is not on:
put `nginx-app-password.conf` back at once.

Then, in a browser: <https://studio.visualtext.org/studio/> → **Sign in with GitHub** →
**Open from GitHub**, open an analyzer, change something, **Commit…** — and find the pull
request on GitHub. Signing in with an account not in `NLP_STUDIO_USERS` must end at "not
invited".

### Changing who is invited

Edit `NLP_STUDIO_USERS` in `.env`, then `docker compose ... up -d` as in step 4. A restart
signs everyone out.

### Back to the password

    cp /home/visualtext/nlp-studio/studio/deploy/nginx-app-password.conf "$n/nlp-studio-app.conf"
    nginx -t && /usr/local/cpanel/scripts/restartsrv_nginx

The app can keep its sign-in settings; behind the password, people sign in with both.

## The try page

`/studio/try/` is a second page in the same container, served from the same `dist` and
using the same `/studio/api/`. It lists eight of VisualText's own analyzers, baked into
the image at build time from a pinned `VisualText/analyzers` release, and lets whoever
opens it run one on text they type. Nothing about it is separately installed or started:
if `/studio/` works, it works.

What it offers and how the catalog is built: [docs/TRY-PAGE.md](../../docs/TRY-PAGE.md).

Which release went in is on the image:

    docker image inspect nlp-studio:app --format '{{index .Config.Labels "org.visualtext.analyzers"}}'

`update.sh` treats that release like the others — when VisualText/analyzers publishes a
new one, the app is out of date and the next run rebuilds with it.

### Before opening it to people who are not invited

Today the try page sits behind whatever guards `/studio/` — the site's password, or
GitHub sign-in. It is the one page here that *could* be opened wider, because it does not
run a visitor's code: the analyzers are ours, fixed at build time, and the page offers no
way to edit the NLP++. That argument is the only thing separating it from
`docs/ARCHITECTURE.md`, *The run server is not a sandbox*, so before it is opened:

- **`/api/run` is still the general endpoint.** It accepts any `files` a caller sends. A
  location that lets anonymous requests reach `/studio/api/run` is a remote code
  execution endpoint on the host that serves visualtext.org, whatever the page does. Open
  `/studio/try/` and the static files under it; do not open `/studio/api/run` without the
  per-run sandbox that `ARCHITECTURE.md` describes as not built.
- **Rate limits.** A run costs a CPU second and a process. `limit_req` on the run endpoint,
  sized against `--max-runs`, before it is reachable from the internet.
- **The page must stay read-only.** If it ever accepts a pasted grammar or an analyzer
  chosen by URL, the reasoning above stops holding and the sandbox becomes a prerequisite
  again.
- **Verify anonymously**, in the order §4 uses: authenticated first, anonymous immediately
  after. A cached 200 is the failure to look for.

## Keeping it current

The **Deploy NLP-Studio** workflow — the one that updates phase 1 on every upstream
release, on the self-hosted runner — runs `update.sh` after phase 1's update. It
rebuilds only when something moved:

- **a new commit in this checkout** — which only happens after a deliberate
  `git pull` here, the same rule as for phase 1 (see stopgap/deploy/UPDATES.md);
- **a new visualtext-files release**, for the analyzer templates.

The weekly forced run rebuilds it too, which picks up fixes in the Node and Python
base images. An update keeps `.env`: Compose reads it every time.

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
    curl -s http://127.0.0.1:3002/api/health

## Rolling back

    docker tag nlp-studio:app-previous nlp-studio:app
    docker compose -f /home/visualtext/nlp-studio/studio/deploy/docker-compose.yml up -d

## Removing it

As root, remove the app's nginx file and reload:

    rm /etc/nginx/conf.d/users/visualtext/studio.visualtext.org/nlp-studio-app.conf
    nginx -t && /usr/local/cpanel/scripts/restartsrv_nginx

As visualtext:

    docker compose -f /home/visualtext/nlp-studio/studio/deploy/docker-compose.yml down
    docker image rm nlp-studio:app nlp-studio:app-previous

Phase 1 is untouched by all of this.
