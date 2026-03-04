"""FastAPI server for RAG agent service."""

import os
from pathlib import Path

from typing import Any

from fastapi import FastAPI, HTTPException
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

