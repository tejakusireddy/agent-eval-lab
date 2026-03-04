"""FastAPI server for RAG agent service."""

import os
from pathlib import Path

from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from agent_eval_lab.rag_service.rag_agent import RAGAgent

# Determine documents directory
_current_dir = Path(__file__).parent
_documents_dir = _current_dir / "documents"

# Initialize RAG agent
try:
    rag_agent = RAGAgent(
        documents_dir=_documents_dir,
        model=os.getenv("RAG_MODEL", "gpt-4o-mini"),
        temperature=float(os.getenv("RAG_TEMPERATURE", "0.1")),
        max_tokens=int(os.getenv("RAG_MAX_TOKENS", "512")),
    )
except Exception as e:
    print(f"Warning: Could not initialize RAG agent: {e}")
    rag_agent = None

app = FastAPI(title="RAG Agent Service", version="1.0.0")


class QueryRequest(BaseModel):
    """Request model for agent query."""

    query: str


class QueryResponse(BaseModel):
    """Response model for agent query."""

    answer: str
    context_snippets: list[str]
    metadata: dict[str, Any]


@app.get("/", response_class=HTMLResponse)
async def playground() -> HTMLResponse:
    """Simple built-in UI for querying the HTTP agent service."""
    html = """<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>RAG Agent Playground</title>
  <style>
    :root {
      --bg: #f6f8fc;
      --card: #ffffff;
      --text: #111827;
      --muted: #6b7280;
      --line: #e5e7eb;
      --brand: #0f766e;
      --brand-2: #115e59;
      --danger: #b91c1c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Avenir Next", Avenir, "Segoe UI", sans-serif;
      background: radial-gradient(1200px 500px at 10% -20%, #ccfbf1 0, transparent 55%),
                  radial-gradient(1000px 400px at 100% -10%, #e0f2fe 0, transparent 55%),
                  var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    .wrap {
      max-width: 920px;
      margin: 40px auto;
      padding: 0 20px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 10px 30px rgba(2, 6, 23, 0.06);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      letter-spacing: -0.02em;
    }
    p {
      margin: 0 0 16px;
      color: var(--muted);
    }
    .row {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 13px;
      color: var(--muted);
      background: #fff;
    }
    textarea {
      width: 100%;
      min-height: 130px;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px;
      font-size: 14px;
      resize: vertical;
      outline: none;
    }
    textarea:focus {
      border-color: #99f6e4;
      box-shadow: 0 0 0 4px rgba(20, 184, 166, 0.1);
    }
    button {
      border: 0;
      background: var(--brand);
      color: #fff;
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 14px;
      cursor: pointer;
      transition: transform .06s ease, background .2s ease;
    }
    button:hover { background: var(--brand-2); }
    button:active { transform: translateY(1px); }
    button:disabled { opacity: .6; cursor: not-allowed; }
    pre {
      margin: 0;
      white-space: pre-wrap;
      font-size: 13px;
      background: #f8fafc;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px;
    }
    .error {
      color: var(--danger);
      font-size: 13px;
      margin-top: 8px;
    }
    .meta {
      margin-top: 12px;
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }
    .meta .box {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px;
      background: #fff;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>RAG Agent Playground</h1>
      <p>Demo your target agent directly at <code>localhost:8000</code> before running red-team evaluation.</p>

      <div class="row">
        <span class="badge" id="healthBadge">Health: checking...</span>
        <span class="badge">Endpoint: POST /agent</span>
      </div>

      <textarea id="queryInput" placeholder="Ask a question to your agent...">What does this knowledge base contain?</textarea>
      <div class="row" style="margin-top: 10px;">
        <button id="sendBtn">Send Query</button>
      </div>
      <div id="errorMsg" class="error"></div>

      <h3 style="margin: 16px 0 8px; font-size: 16px;">Answer</h3>
      <pre id="answerBox">No response yet.</pre>

      <div class="meta">
        <div class="box">
          <strong>Context Snippets</strong>
          <pre id="contextBox" style="margin-top: 8px;">[]</pre>
        </div>
        <div class="box">
          <strong>Metadata</strong>
          <pre id="metaBox" style="margin-top: 8px;">{}</pre>
        </div>
      </div>
    </div>
  </div>

  <script>
    const healthBadge = document.getElementById("healthBadge");
    const sendBtn = document.getElementById("sendBtn");
    const queryInput = document.getElementById("queryInput");
    const answerBox = document.getElementById("answerBox");
    const contextBox = document.getElementById("contextBox");
    const metaBox = document.getElementById("metaBox");
    const errorMsg = document.getElementById("errorMsg");

    async function checkHealth() {
      try {
        const res = await fetch("/health");
        if (!res.ok) throw new Error("Health endpoint failed");
        const data = await res.json();
        healthBadge.textContent = "Health: healthy (" + (data.documents_loaded ?? 0) + " docs)";
      } catch (err) {
        healthBadge.textContent = "Health: unavailable";
      }
    }

    async function sendQuery() {
      const query = queryInput.value.trim();
      if (!query) return;
      sendBtn.disabled = true;
      errorMsg.textContent = "";
      answerBox.textContent = "Loading...";
      contextBox.textContent = "[]";
      metaBox.textContent = "{}";

      try {
        const res = await fetch("/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query })
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt || "Agent request failed");
        }
        const data = await res.json();
        answerBox.textContent = data.answer || "(no answer)";
        contextBox.textContent = JSON.stringify(data.context_snippets || [], null, 2);
        metaBox.textContent = JSON.stringify(data.metadata || {}, null, 2);
      } catch (err) {
        answerBox.textContent = "Request failed.";
        errorMsg.textContent = err.message || "Unknown error";
      } finally {
        sendBtn.disabled = false;
      }
    }

    sendBtn.addEventListener("click", sendQuery);
    checkHealth();
  </script>
</body>
</html>
"""
    return HTMLResponse(content=html)


@app.get("/health")
async def health_check() -> dict[str, Any]:
    """Health check endpoint."""
    if rag_agent is None:
        raise HTTPException(status_code=503, detail="RAG agent not initialized")
    return {"status": "healthy", "documents_loaded": len(rag_agent.documents)}


@app.post("/agent", response_model=QueryResponse)
async def agent_query(request: QueryRequest) -> QueryResponse:
    """
    Process a query through the RAG agent.

    Args:
        request: Query request with user question

    Returns:
        Response with answer, context snippets, and metadata
    """
    if rag_agent is None:
        raise HTTPException(
            status_code=503, detail="RAG agent not initialized"
        )

    try:
        result = await rag_agent.query(request.query)
        return QueryResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


def main() -> None:
    """Run the RAG service server."""
    import uvicorn

    port = int(os.getenv("RAG_PORT", "8000"))
    host = os.getenv("RAG_HOST", "127.0.0.1")

    print(f"Starting RAG service on http://{host}:{port}")
    print(f"Documents directory: {_documents_dir}")
    print(f"Loaded {len(rag_agent.documents) if rag_agent else 0} documents")

    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
