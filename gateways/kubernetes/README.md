# Kubernetes

Minimal **Deployment** that runs one gateway replica. Secrets live in a Kubernetes `Secret`; apply your own or use External Secrets / Sealed Secrets.

## Files

| File | Purpose |
|------|---------|
| [`deployment.yaml`](deployment.yaml) | `Deployment` + `Secret` (placeholder values — replace before apply). |
| [`kustomization.yaml`](kustomization.yaml) | Optional `kubectl apply -k .` entrypoint. |

## Apply

```bash
# Edit deployment.yaml: set Secret stringData to real values OR remove embedded Secret
# and reference an existing Secret name in the Deployment envFrom.

kubectl apply -f deployment.yaml
# or
kubectl apply -k .
```

**Production:** pin the image to a digest, set `resources` limits/requests, and use a dedicated namespace + NetworkPolicy egress allowlists if your policy requires it.
