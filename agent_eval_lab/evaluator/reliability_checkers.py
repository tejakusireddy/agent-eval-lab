"""Reliability evaluation checkers."""


def check_tool_call_correctness(
    response: str, expected_tool_calls: list[str] | None = None
) -> tuple[bool, list[str]]:
    """
    Check if tool calls in the response are correct.

    Args:
        response: The agent's response text
        expected_tool_calls: Optional list of expected tool call names

    Returns:
        Tuple of (is_correct, reasons)

    TODO: Implement tool call correctness checking
    """
    # Stub implementation for v0.1
    return (True, [])

