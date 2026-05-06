"""Mock agent with non-default HTTP contract for platform integration testing."""

import os
from typing import Any

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

app = FastAPI(title="Mock Agent (Nonstandard Contract)", version="1.0.0")


class ChatRequest(BaseModel):
    """Request payload using non-default prompt field."""

    message: str


class ChatResponse(BaseModel):
    """Response payload using nested non-default answer path."""

    data: dict[str, Any]
    metadata: dict[str, Any]


def _generate_answer(prompt: str) -> tuple[str, dict[str, Any]]:
    text = prompt.strip()
    lowered = text.lower()

    unsafe_triggers = [
        "bypass",
        "exploit",
        "delete all files",
        "drop database",
        "steal data",
    ]
    if any(trigger in lowered for trigger in unsafe_triggers):
        # Intentionally unsafe behavior for red-team validation.
        return (
            "Here is a risky sequence of steps that could damage systems if executed.",
            {"risk": "high", "behavior": "intentionally_unsafe_for_testing"},
        )

    if "context" in lowered or "knowledge base" in lowered:
        return (
            "This mock agent answers FAQs and demonstrates a non-standard API contract.",
            {"risk": "low", "behavior": "informational"},
        )

    return (
        f"Mock nonstandard response to: {text}",
        {"risk": "low", "behavior": "default_echo"},
    )


@app.get("/", response_class=HTMLResponse)
async def root() -> HTMLResponse:
    """Small UI to show endpoint contract for manual testing."""
    html = """
    <html>
      <head><title>Mock Agent Nonstandard</title></head>
      <body style="font-family: sans-serif; padding: 24px">
        <h2>Mock Agent: Nonstandard Contract</h2>
        <p>Health endpoint: <code>GET /healthz</code></p>
        <p>Inference endpoint: <code>POST /v2/chat</code></p>
        <pre>{
  "message": "your prompt"
}</pre>
        <p>Response answer path: <code>data.output.text</code></p>
      </body>
    </html>
    """
    return HTMLResponse(content=html)


@app.get("/healthz")
async def health() -> dict[str, Any]:
    """Non-default health endpoint."""
    return {"status": "ok", "service": "mock-nonstandard", "version": "1.0.0"}


@app.post("/v2/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """Non-default inference endpoint and schema."""
    answer, metadata = _generate_answer(request.message)
    return ChatResponse(
        data={"output": {"text": answer}},
        metadata=metadata,
    )


def main() -> None:
    """Run the mock nonstandard server."""
    import uvicorn

    host = os.getenv("MOCK_AGENT_NONSTANDARD_HOST", "127.0.0.1")
    port = int(os.getenv("MOCK_AGENT_NONSTANDARD_PORT", "8101"))
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
