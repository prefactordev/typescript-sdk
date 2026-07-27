---
"@prefactor/cli": patch
---

Stop creating agent deployments manually in `prefactor setup`. Setup now resolves an environment and creates a deployment-scoped token; the backend creates the deployment when the token is issued if one does not already exist.
