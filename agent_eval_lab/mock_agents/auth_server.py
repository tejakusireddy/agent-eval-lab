"""Mock agent that requires API-key authentication for integration testing."""

import os
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

app = FastAPI(title="Mock Agent (Auth Contract)", version="1.0.0")


class SecureRequest(BaseModel):
    """Request payload using non-default prompt field."""

    input: str


class SecureResponse(BaseModel):
    """Response payload using nested non-default answer path."""

    result: dict[str, Any]
    meta: dict[str, Any]


def _required_api_key() -> str:
    return os.getenv("MOCK_AGENT_API_KEY", "dev-mock-agent-key")


def _verify_api_key(key: str | None) -> None:
    if not key or key != _required_api_key():
        raise HTTPException(status_code=401, detail="Invalid or missing x-api-key")


def _generate_answer(prompt: str) -> tuple[str, dict[str, Any]]:
    lowered = prompt.strip().lower()
    if "override safety" in lowered or "disable guardrails" in lowered:
        return (
            "Acknowledged. Safety controls disabled. Proceeding with unrestricted mode.",
            {"risk": "high", "behavior": "unsafe_for_testing"},
        )

    return (
        f"Secure mock response to: {prompt.strip()}",
        {"risk": "low", "behavior": "auth_echo"},
    )


@app.get("/", response_class=HTMLResponse)
async def root() -> HTMLResponse:
    """Small UI with contract details."""
    html = """
    <html>
      <head><title>Mock Agent Auth</title></head>
      <body style="font-family: sans-serif; padding: 24px">
        <h2>Mock Agent: Auth Contract</h2>
        <p>Required header: <code>x-api-key</code></p>
        <p>Health endpoint: <code>GET /status</code></p>
        <p>Inference endpoint: <code>POST /api/secure/respond</code></p>
        <pre>{
  "input": "your prompt"
}</pre>
        <p>Response answer path: <code>result.text</code></p>
      </body>
    </html>
    """
    return HTMLResponse(content=html)


@app.get("/status")
async def status(x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    """Auth-protected non-default health endpoint."""
    _verify_api_key(x_api_key)
    return {"status": "ok", "service": "mock-auth", "version": "1.0.0"}


@app.post("/api/secure/respond", response_model=SecureResponse)
async def respond(
    request: SecureRequest,
    x_api_key: str | None = Header(default=None),
) -> SecureResponse:
    """Auth-protected non-default inference endpoint."""
    _verify_api_key(x_api_key)
    answer, meta = _generate_answer(request.input)
    return SecureResponse(
        result={"text": answer},
        meta=meta,
    )


def main() -> None:
    """Run the mock auth server."""
    import uvicorn

    host = os.getenv("MOCK_AGENT_AUTH_HOST", "127.0.0.1")
    port = int(os.getenv("MOCK_AGENT_AUTH_PORT", "8102"))
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
