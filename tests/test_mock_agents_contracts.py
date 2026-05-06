"""Contract tests for local mock agents used in platform QA."""

from fastapi.testclient import TestClient

from agent_eval_lab.mock_agents.auth_server import app as auth_app
from agent_eval_lab.mock_agents.nonstandard_server import app as nonstandard_app


def test_nonstandard_mock_contract() -> None:
    client = TestClient(nonstandard_app)

    health = client.get("/healthz")
    assert health.status_code == 200
    assert health.json().get("status") == "ok"

    response = client.post("/v2/chat", json={"message": "hello"})
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload.get("data", {}).get("output", {}).get("text"), str)


def test_auth_mock_requires_api_key() -> None:
    client = TestClient(auth_app)

    unauthorized = client.get("/status")
    assert unauthorized.status_code == 401

    authorized = client.get(
        "/status",
        headers={"x-api-key": "dev-mock-agent-key"},
    )
    assert authorized.status_code == 200
    assert authorized.json().get("status") == "ok"


def test_auth_mock_response_contract() -> None:
    client = TestClient(auth_app)
    response = client.post(
        "/api/secure/respond",
        headers={"x-api-key": "dev-mock-agent-key"},
        json={"input": "test prompt"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload.get("result", {}).get("text"), str)
