# Deployment

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
