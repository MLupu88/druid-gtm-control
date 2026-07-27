# Deployment

## Production Runtime

- **SSH host:** `root@88.99.81.51`
- **Server checkout:** `/root/gtm-control`
- **Compose file:** `/root/gtm-control/docker-compose.yml`
- **Service/container:** `gtm-control`
- **Production URL:** https://gtm.aiexperiments.eu
- **Deployment mode:** manual Docker Compose deployment. GitHub Actions builds and
  publishes the GHCR image (see below), but production does not currently consume it
  automatically — the server builds from its own local checkout instead.

**Do not put credentials, private keys, environment values, or any other secret in
this file.** It records where to connect and what to run — nothing that grants access
on its own.

### Read-only inspection (check deployed commit/container without changing anything)

```bash
ssh root@88.99.81.51 '
  cd /root/gtm-control &&
  echo "--- checkout ---" &&
  git status --short &&
  git log -1 --format="%H %ci %s" &&
  echo "--- container ---" &&
  docker inspect gtm-control \
    --format "{{.Id}} {{.Created}} {{.State.StartedAt}} {{.Config.Image}}"
'
```

### Manual deploy sequence

```bash
ssh root@88.99.81.51
cd /root/gtm-control
git pull --ff-only origin main
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=100 gtm-control
```

## Image build (CI)

`.github/workflows/docker-image.yml` builds the Docker image on every push to
`main` (and on manual `workflow_dispatch`) and publishes it to GitHub Container
Registry:

- `ghcr.io/mlupu88/druid-gtm-control:latest`
- `ghcr.io/mlupu88/druid-gtm-control:<short-sha>`

This keeps the build off the production Hetzner box so it doesn't compete
with n8n for CPU/RAM during a build.

## Current production deploy (unchanged)

Production still builds the image locally on the server:

```
docker compose build
docker compose up -d
```

No change is required to this flow yet.

## Future step (not implemented in this session)

A later session will switch production to pull the pre-built GHCR image
instead of building it on the server, e.g.:

```
docker pull ghcr.io/mlupu88/druid-gtm-control:latest
docker compose up -d
```

That change will require `docker-compose.yml` to reference the `image:` from
GHCR (and a login step / pull secret on the server if the package is private).
This is intentionally out of scope for now.

**Note — GHCR package visibility:** `ghcr.io/mlupu88/druid-gtm-control` is
currently **private**. A production server cannot `docker pull` it
anonymously. Before the pull-based deployment above is enabled, the server
must authenticate to `ghcr.io` using GitHub username `MLupu88` and a token
with `read:packages` permission. That token must never be committed to the
repository, written into this file, or placed in a tracked `.env` file —
supply it securely at runtime, e.g.:

```
echo "$GHCR_TOKEN" | docker login ghcr.io -u MLupu88 --password-stdin
```

After authentication, the future deployment flow will use:

```
docker compose pull
docker compose up -d
```

This note is documentation only — it does not switch production away from
its current local-build deployment method.

## GTM Action Web

`.github/workflows/gtm-action-web-image.yml` builds and publishes a separate
landing-page image on relevant pushes to `main`, including changes to
`artifacts/gtm-action-web/**` and shared workspace/build dependencies declared
in the workflow:

- **Image:** `ghcr.io/mlupu88/druid-gtm-control/gtm-action-web:latest`
  (also tagged with the full commit SHA)
- **Visibility:** private
- **Public hostname:** `actionweb.aiexperiments.eu`
- **Internal target:** `gtm-action-web:80` (nginx serving the static build,
  no host port published — reached only via the shared `n8n_network`)

Build-time config (`VITE_GTM_APP_URL`, `VITE_WALKTHROUGH_MAILTO`) is injected
from GitHub Actions **repository variables** (not secrets — both values are
intentionally public) in the workflow's build step.

### Server authentication (one-time)

The package is private, so the server needs a one-time GHCR login using a
GitHub PAT scoped to `read:packages`. Never commit this token or place it in
a tracked `.env` file:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u MLupu88 --password-stdin
```

### Pull and start (scoped to this service only)

```bash
docker compose pull gtm-action-web
docker compose up -d gtm-action-web
```

### Nginx Proxy Manager routing

New proxy host: domain `actionweb.aiexperiments.eu` → forward to
`gtm-action-web:80` → request a new Let's Encrypt certificate, Force SSL,
HTTP/2. No access list — the page is public-by-design but noindexed via the
`X-Robots-Tag` header served by `nginx.conf`.

### DNS

A record: host `actionweb` → server IP, at the same registrar/zone as the
existing `gtm` and `n8n` records. Do not touch those existing records.
Verify with `dig +short actionweb.aiexperiments.eu`.

### Verification after deploy

```bash
docker compose ps gtm-action-web
docker compose logs --tail 50 gtm-action-web
curl -sI https://actionweb.aiexperiments.eu | grep -i x-robots-tag
```

### Rollback

```bash
ROLLBACK_IMAGE="ghcr.io/mlupu88/druid-gtm-control/gtm-action-web:<previous-full-sha>"
docker pull "$ROLLBACK_IMAGE"

cat > /tmp/gtm-action-web.rollback.yml <<EOF
services:
  gtm-action-web:
    image: ${ROLLBACK_IMAGE}
EOF

docker compose \
  -f docker-compose.yml \
  -f /tmp/gtm-action-web.rollback.yml \
  up -d --force-recreate gtm-action-web
```

Verify the running container is actually using the pinned image:

```bash
docker compose \
  -f docker-compose.yml \
  -f /tmp/gtm-action-web.rollback.yml \
  ps gtm-action-web

CONTAINER_ID="$(docker compose \
  -f docker-compose.yml \
  -f /tmp/gtm-action-web.rollback.yml \
  ps -q gtm-action-web)"

test -n "$CONTAINER_ID"
docker inspect "$CONTAINER_ID" --format '{{.Config.Image}}'
```

To return to `latest` once the fix has landed:

```bash
docker compose -f docker-compose.yml pull gtm-action-web
docker compose -f docker-compose.yml up -d --force-recreate gtm-action-web
rm -f /tmp/gtm-action-web.rollback.yml
```
