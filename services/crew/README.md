# Pool PM agent service (CrewAI)

This is the multi-agent layer behind project intelligence; [docs/intelligence.md](../../docs/intelligence.md) covers the whole system.

The API calls it to:
- write briefing narratives,
- answer project questions,
- draft messages.

It is **optional**: without it the API runs on deterministic rules and factual templates.

| Endpoint | Purpose |
|---|---|
| `POST /v1/briefing` | Superintendent briefing. `depth: "full"` first runs each specialist that has findings in its domain. |
| `POST /v1/ask` | Answers a question from the supplied records, with citations. |
| `POST /v1/draft` | Drafts a message. The communication specialist writes for homeowners and internal staff; the procurement specialist writes for suppliers and subcontractors. |
| `GET /health` | Liveness check. Returns no data. |

## Safety model

- **No tools.** Agents have no tools, no delegation, no memory, and no access to the database. They can't change anything.
- **Authorized data only.** The API sends only records the requesting user may see. Homeowner and vendor drafts receive only scoped facts, never internal records.
- **Data, not instructions.** Project text sits inside a delimited data block, and the question is quoted as data. The closing delimiter is escaped wherever it appears inside the data.
- **Validated output.** Output is structured (Pydantic `output_pydantic`). The API validates it again, drops citations to unknown records, rejects anything that contradicts the deterministic readiness, and allowlists proposed actions.
- **Telemetry off.** CrewAI telemetry and tracing are disabled (`CREWAI_DISABLE_TELEMETRY`, `CREWAI_TRACING_ENABLED=false`, `OTEL_SDK_DISABLED`), so project data never leaves for CrewAI's collectors.
- **Logs contain no project content.** They record the request id, kind, model, latency and token counts only.

## Configuration

| Variable | Default | |
|---|---|---|
| `CREW_SERVICE_TOKEN` | — (required, 24+ chars) | Shared with the API (`CREW_SERVICE_TOKEN` there) |
| `ANTHROPIC_API_KEY` | — (required in production) | Used by CrewAI's native Anthropic provider |
| `CREW_LLM_MODEL` | `claude-sonnet-5-5` | Use `claude-opus-5-5` for higher quality at higher cost |
| `CREW_MAX_TOKENS` / `CREW_TEMPERATURE` | `2000` / `0.2` | |
| `CREW_MAX_CONCURRENCY` | `4` | Requests processed at once |
| `CREW_REQUEST_TIMEOUT_S` | `80` | Keep this below the API's `INTELLIGENCE_AGENT_TIMEOUT_MS` (90 s) |
| `CREW_MAX_ITER` / `CREW_MAX_EXECUTION_TIME_S` / `CREW_MAX_RPM` | `3` / `60` / `30` | Per-agent limits |

## Run and test

```bash
cd services/crew
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest -q                         # scripted model, no network
CREW_SERVICE_TOKEN=… ANTHROPIC_API_KEY=… uvicorn --factory pool_crew.app:app --port 8000
```

**Contract test with the API (no network):**
1. Start the service with a scripted model: `python -m tests.serve_scripted 8765`.
2. In a second shell: `cd services/api && CREW_CONTRACT_URL=http://127.0.0.1:8765 npx vitest run test/crew-contract.test.ts`.

**Deploy:**
1. Build the image: `docker build -t pool-crew services/crew`.
2. Run it as a separate service, private to the API where the host allows it.
3. On the API, set `INTELLIGENCE_AGENT_PROVIDER=crewai`, `CREW_SERVICE_URL` and `CREW_SERVICE_TOKEN`.

**Licensing:** crewAI is MIT-licensed upstream (github.com/crewAIInc/crewAI). The published 1.15.32 wheel doesn't declare a license in its metadata, so confirm it before redistribution.
