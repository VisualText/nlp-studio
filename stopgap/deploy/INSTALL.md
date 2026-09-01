# Publishing NLP-Studio at studio.visualtext.org

Run as root on ded4252. Every step is reversible; the rollback is at the bottom.

Before starting, understand what this does: it puts a VS Code instance and a
terminal on the public internet, gated only by the Basic auth password in
`studio-ssl.conf`. That container runs on the same host as every
visualtext.org site.

## 1. Create the subdomain (cPanel UI)

cPanel -> Domains -> Create A New Domain, `studio.visualtext.org`.

This creates the DNS record, the document root, and the base vhost. The
document root is never served -- the proxy config replaces it -- but cPanel
needs it to exist.

Confirm DNS before continuing:

    dig +short studio.visualtext.org        # expect 192.249.118.119

## 2. Confirm the container is up

    su - visualtext -c 'cd /home/visualtext/nlp-studio/stopgap && docker compose ps'
    curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/    # expect 200

If this is not 200, stop -- fix the container first. Apache will only proxy a
502 otherwise.

## 3. Install the Apache includes

    d=/home/visualtext/nlp-studio/stopgap/deploy
    mkdir -p /etc/apache2/conf.d/userdata/std/2_4/visualtext/studio.visualtext.org
    mkdir -p /etc/apache2/conf.d/userdata/ssl/2_4/visualtext/studio.visualtext.org
    cp "$d/studio-std.conf" /etc/apache2/conf.d/userdata/std/2_4/visualtext/studio.visualtext.org/proxy.conf
    cp "$d/studio-ssl.conf" /etc/apache2/conf.d/userdata/ssl/2_4/visualtext/studio.visualtext.org/proxy.conf

## 4. Rebuild and restart Apache

    /scripts/ensure_vhost_includes --user=visualtext
    /scripts/rebuildhttpdconf
    apachectl configtest

**Do not skip `configtest`.** It reports `Syntax OK` before you restart. A bad
config here takes down every visualtext.org site, not just this one. If it
reports an error, fix it before restarting -- Apache keeps serving the old
config until you do.

    /scripts/restartsrv_httpd

## 4b. Install the nginx config -- REQUIRED

Apache alone is not enough on this host, for two reasons discovered the hard
way. Both are explained at length in `nginx-studio.conf`; in short:

- cPanel's nginx sits in front of Apache and sets `proxy_http_version 1.0`
  plus `proxy_hide_header Upgrade`, which kills the WebSocket upgrade. VS Code
  loads its HTML and then hangs on a grey screen forever.
- cPanel enables nginx proxy caching per account. With the password check
  inside Apache, nginx cached the authenticated 200 and served it to anonymous
  visitors. This was observed live on this host -- it kept serving the editor
  page even after the container was stopped.

The fix routes nginx straight to the container and moves the password check
out to nginx, the outermost layer, so nothing can answer ahead of it.

    d=/home/visualtext/nlp-studio/stopgap/deploy
    cp "$d/nginx-00-websocket-map.conf" /etc/nginx/conf.d/00-websocket-map.conf
    mkdir -p /etc/nginx/conf.d/users/visualtext/studio.visualtext.org
    cp "$d/nginx-studio.conf" /etc/nginx/conf.d/users/visualtext/studio.visualtext.org/nlp-studio.conf
    nginx -t
    /usr/local/cpanel/scripts/restartsrv_nginx

`nginx -t` must report `test is successful` before the reload.

The Apache config from step 3 stays installed. It is no longer on the main
request path, but it still gates `/favicon.ico` and `/robots.txt` (cPanel
defines those as exact-match locations that win over our regex), and it is a
working fallback if this nginx file is ever lost.

## 5. Issue the certificate

    /usr/local/cpanel/bin/autossl_check --user=visualtext

Takes a few minutes. Until it completes, HTTPS will warn about an invalid
certificate. That is expected, not a misconfiguration.

## 6. Verify

    U=david:PASSWORD

    # 1. authenticated request first -- this is what populates any cache
    curl -sk -o /dev/null -w '%{http_code}\n' -u "$U" https://studio.visualtext.org/

    # 2. anonymous IMMEDIATELY after. Must be 401, not a cached 200.
    curl -sk -o /dev/null -w '%{http_code}\n' https://studio.visualtext.org/

    # 3. nothing from the editor may leak anonymously. Must print 0.
    curl -sk https://studio.visualtext.org/ | grep -coiE 'didStartRenderer|openvscode|workbench'

    # 4. WebSocket must return "101 Switching Protocols", not 200.
    curl -sk -i -N --max-time 6 -u "$U" \
      -H "Connection: Upgrade" -H "Upgrade: websocket" \
      -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
      'https://studio.visualtext.org/?type=ExtensionHost' > /tmp/ws.out 2>&1
    grep -a 'HTTP/' /tmp/ws.out

Run these in this order. Checking anonymous access on its own proves nothing
-- the cache bypass only appears after an authenticated request has populated
the cache, which is exactly why it was missed the first time.

A 200 at step 2, or a non-zero count at step 3, means the site is serving the
editor to anyone. Stop the container immediately
(`docker compose down`) and investigate before putting it back.

A 200 rather than 101 at step 4 means WebSockets are broken: the page will
load and then hang grey. Not a security problem, but the editor is unusable.

Then in a browser:

    https://studio.visualtext.org/?folder=/home/workspace

Keep the `?folder=`. Without it the analyzer, sequence, and KB views are empty
and it looks broken.

## Rollback

    rm -rf /etc/apache2/conf.d/userdata/std/2_4/visualtext/studio.visualtext.org
    rm -rf /etc/apache2/conf.d/userdata/ssl/2_4/visualtext/studio.visualtext.org
    /scripts/ensure_vhost_includes --user=visualtext
    /scripts/rebuildhttpdconf
    apachectl configtest && /scripts/restartsrv_httpd

Then remove the subdomain in cPanel. The container is untouched by all of this
and keeps working over the SSH tunnel.

## Keeping it up to date

The image pins the extension, engine, VisualText files, and example analyzers at
build time, so it never changes on its own. Upstream releases trigger a rebuild
through GitHub Actions, onto a self-hosted runner on this server, which tests the
new image before swapping it in. See [UPDATES.md](UPDATES.md) — including its
security section, which matters here: push access to `nlp-studio` becomes shell
access to this host.

Updates do not touch anything in this document: the proxy configs and
`.htpasswd-studio` are independent of the image, so an update cannot re-open the
site. The verification in section 6 is still worth re-running after any change
to *this* file.

## Changing the password

    htpasswd -B /home/visualtext/.htpasswd-studio david

No Apache restart needed; the file is read per request.

## Known limits

These are properties of the phase-1 stopgap, not bugs to fix here:

- **Single tenant.** Everyone who logs in shares one filesystem and one
  workspace, and will overwrite each other's analyzers.
- **State persists between visitors.** The named volume keeps whatever anyone
  writes. Wrong for a public "try NLP++" demo; that wants ephemeral
  per-session containers, which is phase 2.
- **No resource cap.** An NLP++ pass with a runaway rule spins a core
  indefinitely with no timeout, on the host serving your live sites. Consider
  adding `cpus:` and `mem_limit:` to docker-compose.yml before opening this up
  beyond a handful of trusted people.
- **One password for everyone.** No per-user accounts, no audit trail.

If these start to hurt, that is the signal to start phase 2, not to patch
phase 1.
