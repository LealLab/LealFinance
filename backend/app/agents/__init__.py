"""In-process AI provider integration, gated end-to-end by
`settings.agents_enabled` (see app/api/v1/agents.py's `AgentsEnabled`
dependency). Runs inside the `api` process rather than as a separate
service - there is no service-to-service auth to invent, and importing
this package costs a handful of dataclasses and httpx calls, nothing that
needs deferring when the feature is off.
"""

MCP_TOKEN_TTL_SECONDS = 365 * 24 * 3600
