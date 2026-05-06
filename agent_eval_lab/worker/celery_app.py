"""Celery application configuration for durable evaluation tasks."""

import os

import structlog
from celery import Celery

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.StackInfoRenderer(),
        structlog.dev.set_exc_info,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer(),
    ],
)

_redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

app = Celery(
    "agent_eval_lab",
    broker=_redis_url,
    backend=_redis_url,
    include=["agent_eval_lab.worker.tasks"],
)

app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    result_expires=86400,
    timezone="UTC",
    enable_utc=True,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
)
