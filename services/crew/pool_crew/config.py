"""Service configuration from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

# Project data must never reach CrewAI's telemetry or tracing collectors.
for _flag, _value in (("CREWAI_DISABLE_TELEMETRY", "true"), ("CREWAI_TRACING_ENABLED", "false"), ("OTEL_SDK_DISABLED", "true")):
    os.environ.setdefault(_flag, _value)


@dataclass(frozen=True)
class Settings:
    #: Shared bearer token; the Pool PM API sends it on every request.
    token: str
    #: Model name for the Anthropic provider (CrewAI's native Anthropic SDK route).
    model: str = "claude-sonnet-5-5"
    max_tokens: int = 2000
    temperature: float = 0.2
    #: Requests processed at once; extra requests wait (bounded by the timeout).
    max_concurrency: int = 4
    #: Hard limit per request, below the API's own 90 s timeout.
    request_timeout_s: float = 80.0
    #: Per-agent limits.
    max_iter: int = 3
    max_execution_time_s: int = 60
    max_rpm: int | None = 30
    log_level: str = "INFO"
    extra: dict[str, str] = field(default_factory=dict)

    @staticmethod
    def from_env() -> "Settings":
        token = os.environ.get("CREW_SERVICE_TOKEN", "")
        if len(token) < 24:
            raise RuntimeError("CREW_SERVICE_TOKEN must be set (at least 24 characters)")
        rpm = os.environ.get("CREW_MAX_RPM", "30")
        return Settings(
            token=token,
            model=os.environ.get("CREW_LLM_MODEL", "claude-sonnet-5-5"),
            max_tokens=int(os.environ.get("CREW_MAX_TOKENS", "2000")),
            temperature=float(os.environ.get("CREW_TEMPERATURE", "0.2")),
            max_concurrency=int(os.environ.get("CREW_MAX_CONCURRENCY", "4")),
            request_timeout_s=float(os.environ.get("CREW_REQUEST_TIMEOUT_S", "80")),
            max_iter=int(os.environ.get("CREW_MAX_ITER", "3")),
            max_execution_time_s=int(os.environ.get("CREW_MAX_EXECUTION_TIME_S", "60")),
            max_rpm=int(rpm) if rpm else None,
            log_level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        )
