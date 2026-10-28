from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import pytest
from crewai.llms.base_llm import BaseLLM
from fastapi.testclient import TestClient

from pool_crew.app import create_app
from pool_crew.config import Settings

TOKEN = "test-token-test-token-test-token"


class ScriptedLLM(BaseLLM):
    """Deterministic stand-in for the model: returns scripted data per output model; never touches the network."""

    script: dict[str, Any] = {}
    seen: list[dict[str, Any]] = []
    delay_s: float = 0.0

    def call(self, messages, tools=None, callbacks=None, available_functions=None, from_task=None, from_agent=None, response_model=None):  # noqa: D401
        text = messages if isinstance(messages, str) else "\n".join(str(m.get("content", "")) for m in messages)
        name = getattr(response_model, "__name__", "text")
        self.seen.append({"model": name, "text": text, "agent": getattr(from_agent, "role", None)})
        if self.delay_s:
            time.sleep(self.delay_s)
        value = self.script.get(name)
        if callable(value):
            value = value(text)
        if value is None:
            raise RuntimeError(f"no scripted response for {name}")
        if isinstance(value, str) or response_model is None:
            return value
        return response_model(**value)


@pytest.fixture
def llm() -> ScriptedLLM:
    fake = ScriptedLLM(model="scripted")
    fake.script = {}
    fake.seen = []
    return fake


@pytest.fixture
def make_client(llm: ScriptedLLM) -> Callable[..., TestClient]:
    def build(**overrides: Any) -> TestClient:
        settings = Settings(token=TOKEN, model="scripted-model", **overrides)
        return TestClient(create_app(settings, lambda _s: llm))

    return build


def request(kind: str, **extra: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "request_id": "11111111-1111-4111-8111-111111111111",
        "kind": kind,
        "depth": "compact",
        "project": {"id": "p1", "name": "Rivera Backyard", "number": "P-2026-001", "status": "construction", "today": "2026-06-01"},
        "records": [
            {"type": "stage", "id": "s-exc", "label": "Excavation", "facts": "not_started; planned 2026-06-03 → 2026-06-05"},
            {"type": "task", "id": "t-permit", "label": "Permit issued", "facts": "todo"},
        ],
        "findings": [
            {
                "id": "rec-1",
                "agent": "readiness",
                "severity": "critical",
                "title": "Excavation needs an issued permit",
                "observation": "Excavation starts 2026-06-03 but the permit isn't recorded as issued.",
                "risk": "Stop-work order.",
                "recommended_action": "Confirm the permit before mobilizing.",
                "responsible_role": "office",
                "due_date": "2026-06-01",
                "evidence_ids": ["s-exc"],
            },
            {
                "id": "rec-2",
                "agent": "procurement",
                "severity": "medium",
                "title": "Confirm delivery of Pump",
                "observation": "Ordered; not confirmed.",
                "risk": "Idle crew.",
                "recommended_action": "Confirm with supplier.",
                "responsible_role": "project_manager",
                "due_date": None,
                "evidence_ids": [],
            },
        ],
        "readiness": {"label": "blocked", "score": 40, "next_milestone": {"stage_name": "Excavation", "label": "blocked", "score": 40, "planned_start": "2026-06-03", "blockers": ["Permits: not issued"], "risks": [], "missing_data": []}},
    }
    body.update(extra)
    return body


AUTH = {"authorization": f"Bearer {TOKEN}"}
