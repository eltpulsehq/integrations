# Publish `ghcr.io/eltpulsehq/agent:latest` (GitHub Actions)

Copy this folder into the root of **[`eltpulsehq/agent`](https://github.com/eltpulsehq/agent)** so you have:

```
.github/workflows/publish-ghcr.yml
```

The workflow builds the Docker image from the **repository root** (`context: .`) and pushes to **GHCR** with tag **`latest`** on every push to **`main`**, plus **`workflow_dispatch`** for manual runs. Git tags matching **`v*`** also get a **semver** image tag (e.g. `1.2.3`).

## Requirements in `eltpulsehq/agent`

1. A **`Dockerfile`** at the repo root (or edit the workflow `context` / `file` to match your layout).
2. This workflow file at **`.github/workflows/publish-ghcr.yml`**.

## GitHub / org settings

1. **Repository → Settings → Actions → General**  
   - *Workflow permissions*: **Read and write** (needed for `GITHUB_TOKEN` to push packages), or keep read-only and use a PAT in `secrets.GHCR_WRITE_TOKEN` (not recommended if avoidable).

2. **Organization → Settings → Actions → General**  
   - Allow workflows from member repos to publish packages if prompted.

3. **After the first successful push**  
   - **Package** `agent` under the `eltpulsehq` org → **Package settings → Change visibility** → **Public** if you want anonymous `docker pull` (typical for a gateway image).

4. Optional: **environments** or **branch protection** so only `main` can publish `latest`.

## Verify

```bash
docker pull ghcr.io/eltpulsehq/agent:latest
```

If the package is private, log in first:

```bash
echo "$GITHUB_TOKEN_OR_PAT" | docker login ghcr.io -u USERNAME --password-stdin
```
