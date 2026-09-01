from dataclasses import dataclass
from typing import Any, Literal


@dataclass(frozen=True, slots=True)
class TextDelta:
    text: str


@dataclass(frozen=True, slots=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True, slots=True)
class TurnEnd:
    stop_reason: Literal["end_turn", "tool_use", "max_tokens", "other"]


ProviderEvent = TextDelta | ToolCall | TurnEnd


@dataclass(frozen=True, slots=True)
class ToolResultInput:
    call_id: str
    name: str
    content: str
    is_error: bool = False


@dataclass(frozen=True, slots=True)
class Turn:
    role: Literal["user", "assistant"]
    text: str = ""
    tool_calls: tuple[ToolCall, ...] = ()
    tool_results: tuple[ToolResultInput, ...] = ()


@dataclass(frozen=True, slots=True)
class ToolSpec:
    """Minimal provider-facing tool definition."""

    name: str
    description: str
    schema: dict[str, Any]
