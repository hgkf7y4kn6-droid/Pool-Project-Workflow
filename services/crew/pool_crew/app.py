"""HTTP service around the crews.

POST /v1/briefing, /v1/ask, /v1/draft — bearer-token authenticated, bounded
concurrency, hard timeout, structured JSON logs without project content.
GET /health — liveness (no data).
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import time
from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from . import crews
from .config import Settings
from .contract import AskRequest, BriefingRequest, DraftRequest
from .llm import default_llm_factory

log = logging.getLogger("pool_crew")


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data = {"level": record.levelname.lower(), "msg": record.getMessage(), "time": self.formatTime(record)}
        data.update(getattr(record, "fields", {}))
        return json.dumps(data)


def _configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(_JsonFormatter())
    log.handlers[:] = [handler]
    log.setLevel(level)
    log.propagate = False


def create_app(settings: Settings | None = None, llm_factory: Callable[[Settings], Any] | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    _configure_logging(settings.log_level)
    make_llm = llm_factory or default_llm_factory
    semaphore = asyncio.Semaphore(settings.max_concurrency)
    app = FastAPI(title="Pool PM agents", docs_url=None, redoc_url=None, openapi_url=None)

    def authorize(authorization: str = Header(default="")) -> None:
        expected = f"Bearer {settings.token}"
        if not hmac.compare_digest(authorization.encode(), expected.encode()):
            raise HTTPException(status_code=401, detail="unauthorized")

    async def execute(kind: str, request_id: str, run: Callable[[], crews.CrewResult]) -> dict[str, Any]:
        started = time.monotonic()
        fields = {"kind": kind, "request_id": request_id, "model": settings.model}
        try:
            async with asyncio.timeout(settings.request_timeout_s):
                await semaphore.acquire()
            # A thread can't be cancelled, so the slot is released when the work
            # really finishes — a timed-out request still counts against concurrency.
            work = asyncio.ensure_future(asyncio.to_thread(run))
            work.add_done_callback(lambda _: semaphore.release())
            remaining = max(0.1, settings.request_timeout_s - (time.monotonic() - started))
            result = await asyncio.wait_for(asyncio.shield(work), remaining)
        except TimeoutError:
            log.warning("crew timed out", extra={"fields": {**fields, "latency_ms": int((time.monotonic() - started) * 1000)}})
            raise HTTPException(status_code=504, detail="timeout") from None
        except (ValidationError, ValueError) as err:
            # The model produced output that doesn't fit the contract.
            log.warning("crew output invalid", extra={"fields": {**fields, "error": type(err).__name__}})
            raise HTTPException(status_code=502, detail="invalid_output") from None
        except Exception as err:  # provider outages, rate limits, network errors
            log.error("crew failed", extra={"fields": {**fields, "error": type(err).__name__}})
            raise HTTPException(status_code=503, detail="unavailable") from None
        usage = result.usage.model_dump()
        log.info("crew succeeded", extra={"fields": {**fields, "latency_ms": int((time.monotonic() - started) * 1000), **usage}})
        return {**result.output.model_dump(), "model": settings.model, "usage": usage, "proposed_actions": []}

    @app.exception_handler(ValidationError)
    async def _invalid(_: Request, __: ValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": "invalid_request"})

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/briefing", dependencies=[Depends(authorize)])
    async def briefing(req: BriefingRequest) -> dict[str, Any]:
        llm = make_llm(settings)
        return await execute("briefing", req.request_id, lambda: crews.run_briefing(req, llm, settings))

    @app.post("/v1/ask", dependencies=[Depends(authorize)])
    async def ask(req: AskRequest) -> dict[str, Any]:
        llm = make_llm(settings)
        return await execute("ask", req.request_id, lambda: crews.run_ask(req, llm, settings))

    @app.post("/v1/draft", dependencies=[Depends(authorize)])
    async def draft(req: DraftRequest) -> dict[str, Any]:
        llm = make_llm(settings)
        return await execute("draft", req.request_id, lambda: crews.run_draft(req, llm, settings))

    return app


def app() -> FastAPI:  # uvicorn --factory pool_crew.app:app
    return create_app()
