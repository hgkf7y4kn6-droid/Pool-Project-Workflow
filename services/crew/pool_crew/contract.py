"""Request/response contract shared with services/api (src/adapters/agents/types.ts).

The API sends only records the requesting user may read and re-validates
everything returned here; these models are the first line of that check.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AgentKey = Literal["superintendent", "schedule", "readiness", "communication", "procurement", "closeout"]
Severity = Literal["critical", "high", "medium", "low"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Record(_Model):
    type: str = Field(max_length=40)
    id: str = Field(max_length=64)
    label: str = Field(max_length=300)
    facts: str = Field(max_length=600)


class Finding(_Model):
    id: str = Field(max_length=64)
    agent: AgentKey
    severity: Severity
    title: str = Field(max_length=300)
    observation: str = Field(max_length=2000)
    risk: str = Field(max_length=1000)
    recommended_action: str = Field(max_length=1000)
    responsible_role: str = Field(max_length=40)
    due_date: str | None = None
    evidence_ids: list[str] = Field(default_factory=list, max_length=50)


class NextMilestone(_Model):
    stage_name: str
    label: str
    score: int
    planned_start: str | None = None
    blockers: list[str] = Field(default_factory=list, max_length=50)
    risks: list[str] = Field(default_factory=list, max_length=50)
    missing_data: list[str] = Field(default_factory=list, max_length=50)


class Readiness(_Model):
    label: str
    score: int
    next_milestone: NextMilestone | None = None


class Project(_Model):
    id: str
    name: str = Field(max_length=200)
    number: str = Field(max_length=40)
    status: str
    today: str


class RequestBase(_Model):
    request_id: str = Field(max_length=64)
    depth: Literal["compact", "full"] = "compact"
    project: Project
    records: list[Record] = Field(default_factory=list, max_length=400)
    findings: list[Finding] = Field(default_factory=list, max_length=200)
    readiness: Readiness


class BriefingRequest(RequestBase):
    kind: Literal["briefing"]


class AskRequest(RequestBase):
    kind: Literal["ask"]
    question: str = Field(min_length=3, max_length=2000)


class Fact(_Model):
    id: str = Field(max_length=64)
    type: str = Field(max_length=40)
    text: str = Field(max_length=600)


class DraftSpec(_Model):
    audience: Literal["homeowner", "supplier", "subcontractor", "internal"]
    kind: str = Field(max_length=60)
    guidance: str | None = Field(default=None, max_length=500)
    facts: list[Fact] = Field(max_length=60)


class DraftRequest(RequestBase):
    kind: Literal["draft"]
    draft: DraftSpec


# --- Structured outputs (CrewAI `output_pydantic`) -------------------------------------


class Citation(_Model):
    type: str
    id: str


class SpecialistNotes(_Model):
    """A specialist's interpretation of its own findings, consumed by the superintendent."""

    notes: list[str] = Field(default_factory=list, max_length=8, description="Short, specific points; cite finding ids in brackets")
    priority_finding_ids: list[str] = Field(default_factory=list, max_length=8)


class Priority(_Model):
    text: str = Field(max_length=600)
    recommendation_id: str | None = None
    citations: list[Citation] = Field(default_factory=list, max_length=20)


class BriefingOutput(_Model):
    narrative: str = Field(min_length=1, max_length=6000)
    priorities: list[Priority] = Field(default_factory=list, max_length=10)
    citations: list[Citation] = Field(default_factory=list, max_length=60)


class AskOutput(_Model):
    answer: str = Field(min_length=1, max_length=8000)
    citations: list[Citation] = Field(default_factory=list, max_length=60)


class Claim(_Model):
    text: str = Field(max_length=1000)
    fact_ids: list[str] = Field(default_factory=list, max_length=20)


class DraftOutput(_Model):
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=10_000)
    claims: list[Claim] = Field(default_factory=list, max_length=60)


class Usage(_Model):
    input_tokens: int | None = None
    output_tokens: int | None = None
