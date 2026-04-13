# GitHub Actions

Example workflow for **smoke-testing** the gateway token against the control plane (useful after rotating secrets or before promoting infra).

Add repository secrets:

- `ELTPULSE_AGENT_TOKEN`
- `ELTPULSE_CONTROL_PLANE_URL` (no trailing slash)

Then run **Actions → Gateway smoke (manifest)** manually (`workflow_dispatch`).
