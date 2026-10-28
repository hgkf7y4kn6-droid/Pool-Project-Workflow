"""Run the real service with a scripted model, for the API's contract test.

    python -m tests.serve_scripted 8765
    CREW_CONTRACT_URL=http://127.0.0.1:8765 npm test -w @pool/api -- contract
"""

from __future__ import annotations

import sys

import uvicorn

from pool_crew.app import create_app
from pool_crew.config import Settings
from tests.conftest import TOKEN, ScriptedLLM

llm = ScriptedLLM(model="scripted")
llm.seen = []
llm.script = {
    "SpecialistNotes": {"notes": ["[rec-1] Permit gate blocks excavation."], "priority_finding_ids": ["rec-1"]},
    "BriefingOutput": {"narrative": "Excavation is blocked until the permit is issued.", "priorities": [{"text": "Confirm the permit", "recommendation_id": None, "citations": []}], "citations": []},
    "AskOutput": lambda prompt: {"answer": "Confirm the permit first.", "citations": [{"type": "project", "id": prompt.split('"id": "', 1)[1].split('"', 1)[0]}]},
    "DraftOutput": {"subject": "Update", "body": "Hello from the project team.", "claims": []},
}

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    uvicorn.run(create_app(Settings(token=TOKEN, model="scripted-model"), lambda _s: llm), host="127.0.0.1", port=port, log_level="warning")
