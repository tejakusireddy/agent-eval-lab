"""HTTP bridge for enqueueing Celery tasks and revoking them."""

from __future__ import annotations

import os
from typing import Annotated, Any

import httpx
import structlog
import uvicorn
from fastapi import FastAPI, Header, HTTPException
from pydantic import AnyHttpUrl, BaseModel, Field

from agent_eval_lab.worker.celery_app import app as celery_app

logger = structlog.get_logger(__name__)


def _require_bridge_secret(x_bridge_secret: str | None) -> None:
    """Reject requests when the bridge shared secret is missing or wrong."""
    expected = os.environ.get("BRIDGE_SECRET", "")
    if not expected or x_bridge_secret != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing bridge secret")


class EnqueueBody(BaseModel):
    """Request body for submitting an evaluation to the Celery queue."""

    evaluation_id: str = Field(..., min_length=1)
    config: dict[str, Any]
    scenario_ids: list[str]
    scenarios_dir: str
    webhook_url: str


class EnqueueResponse(BaseModel):
    """Response after a task has been submitted."""

    task_id: str


class RevokeBody(BaseModel):
    """Request body for revoking a running or queued task."""

    task_id: str = Field(..., min_length=1)


class RevokeResponse(BaseModel):
    """Result of a revoke request."""

    revoked: bool


class WebhookForwardBody(BaseModel):
    """Payload from the worker to forward completion to the Next.js webhook."""

    forward_url: AnyHttpUrl
    evaluation_id: str


class LangSmithImportBody(BaseModel):
    """Request body to enqueue a LangSmith trace import task."""

    evaluation_id: str = Field(..., min_length=1)
    langsmith_api_key: str = Field(..., min_length=1)
    project_name: str = Field(..., min_length=1)
    limit: int = Field(default=50, ge=1, le=200)


class LangSmithImportEnqueueResponse(BaseModel):
    """Acknowledgement after the import task is queued."""

    task_id: str
    accepted: bool = True


def create_app() -> FastAPI:
    """
    Build the FastAPI application for enqueue, revoke, and webhook forwarding.

    Returns:
        Configured FastAPI app instance.
    """
    fastapi_app = FastAPI(title="Agent Eval Worker Bridge", version="0.1.0")

    @fastapi_app.post("/enqueue", response_model=EnqueueResponse)
    def post_enqueue(
        body: EnqueueBody,
        x_bridge_secret: Annotated[str | None, Header(alias="X-Bridge-Secret")] = None,
    ) -> EnqueueResponse:
        """Submit an evaluation task to Celery."""
        _require_bridge_secret(x_bridge_secret)

        from agent_eval_lab.worker.tasks import run_evaluation_task

        async_result = run_evaluation_task.apply_async(
            task_id=body.evaluation_id,
            kwargs={
                "evaluation_id": body.evaluation_id,
                "config": body.config,
                "scenario_ids": body.scenario_ids,
                "scenarios_dir": body.scenarios_dir,
                "webhook_url": body.webhook_url,
            },
        )
        return EnqueueResponse(task_id=async_result.id)

    @fastapi_app.post("/revoke", response_model=RevokeResponse)
    def post_revoke(
        body: RevokeBody,
        x_bridge_secret: Annotated[str | None, Header(alias="X-Bridge-Secret")] = None,
    ) -> RevokeResponse:
        """Revoke a Celery task by id (evaluation id when used as task_id)."""
        _require_bridge_secret(x_bridge_secret)
        celery_app.control.revoke(body.task_id, terminate=True, signal="SIGTERM")
        return RevokeResponse(revoked=True)

    @fastapi_app.post("/webhook")
    def post_webhook(
        body: WebhookForwardBody,
        x_bridge_secret: Annotated[str | None, Header(alias="X-Bridge-Secret")] = None,
    ) -> dict[str, str]:
        """
        Forward completion notification to the Next.js internal webhook.

        The worker calls this endpoint so the bridge can attach shared secrets
        expected by the platform.
        """
        _require_bridge_secret(x_bridge_secret)
        forward_secret = os.environ.get("WEBHOOK_FORWARD_SECRET", "")
        if not forward_secret:
            logger.error("WEBHOOK_FORWARD_SECRET is not set")
            raise HTTPException(
                status_code=500, detail="Webhook forward secret not configured"
            )
        payload = {"evaluationId": body.evaluation_id}
        headers = {
            "Content-Type": "application/json",
            "X-Internal-Webhook-Secret": forward_secret,
        }
        try:
            with httpx.Client(timeout=10.0) as client:
                response = client.post(
                    str(body.forward_url),
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
        except Exception as exc:
            logger.error(
                "webhook_forward_to_platform_failed",
                evaluation_id=body.evaluation_id,
                exc_info=True,
            )
            raise HTTPException(
                status_code=502, detail="Forward to platform webhook failed"
            ) from exc
        return {"status": "ok"}

    @fastapi_app.post(
        "/import/langsmith", response_model=LangSmithImportEnqueueResponse
    )
    def post_import_langsmith(
        body: LangSmithImportBody,
        x_bridge_secret: Annotated[str | None, Header(alias="X-Bridge-Secret")] = None,
    ) -> LangSmithImportEnqueueResponse:
        """Enqueue a LangSmith pull-import job on the Celery worker."""
        _require_bridge_secret(x_bridge_secret)

        from agent_eval_lab.worker.tasks import import_langsmith_task

        task_id = f"langsmith_import_{body.evaluation_id}"
        async_result = import_langsmith_task.apply_async(
            task_id=task_id,
            kwargs={
                "evaluation_id": body.evaluation_id,
                "langsmith_api_key": body.langsmith_api_key,
                "project_name": body.project_name,
                "limit": body.limit,
            },
        )
        return LangSmithImportEnqueueResponse(task_id=async_result.id, accepted=True)

    return fastapi_app


app = create_app()


def main() -> None:
    """Run the bridge with uvicorn (used by ``python -m``)."""
    port = int(os.environ.get("BRIDGE_PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
