"""LLM construction (CrewAI native Anthropic provider)."""

from __future__ import annotations

from crewai import LLM
from crewai.llms.base_llm import BaseLLM

from .config import Settings


def default_llm_factory(settings: Settings) -> BaseLLM:
    # An explicit provider pins CrewAI's native Anthropic SDK route for any model name.
    return LLM(model=settings.model, provider="anthropic", max_tokens=settings.max_tokens, temperature=settings.temperature)
