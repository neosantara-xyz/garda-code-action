import os
from typing import Type

from garda.algo.ai_handlers.base_ai_handler import BaseAiHandler
from garda.config_loader import get_settings
from garda.log import get_logger


_HANDLER_ALIASES = {
    "neosantara": "neosantara",
    "garda": "neosantara",
    "garda-code-action": "neosantara",
    "garda_garda": "neosantara",
    "agno": "agno",
    "agno-neosantara": "agno",
    "agno_neosantara": "agno",
    "any-llm": "any_llm",
    "any_llm": "any_llm",
    "anyllm": "any_llm",
    "litellm": "litellm",
    "lite_llm": "litellm",
    "openai": "openai",
}


def get_configured_ai_handler_name() -> str:
    raw = (
        get_settings().get("CONFIG.AI_HANDLER", None)
        or os.environ.get("GARDA_AI_HANDLER")
        or os.environ.get("AI_HANDLER")
        or "neosantara"
    )
    normalized = str(raw).strip().lower().replace(" ", "_")
    return _HANDLER_ALIASES.get(normalized, normalized)


def get_ai_handler_class() -> Type[BaseAiHandler]:
    handler_name = get_configured_ai_handler_name()
    if handler_name == "neosantara":
        from garda.algo.ai_handlers.neosantara_ai_handler import NeosantaraAIHandler
        return NeosantaraAIHandler
    if handler_name == "agno":
        from garda.algo.ai_handlers.agno_ai_handler import AgnoAIHandler
        return AgnoAIHandler
    if handler_name == "any_llm":
        from garda.algo.ai_handlers.any_llm_ai_handler import AnyLLMAIHandler
        return AnyLLMAIHandler
    if handler_name == "litellm":
        from garda.algo.ai_handlers.litellm_ai_handler import LiteLLMAIHandler
        return LiteLLMAIHandler
    if handler_name == "openai":
        from garda.algo.ai_handlers.openai_ai_handler import OpenAIHandler
        return OpenAIHandler
    raise ValueError(
        "Unsupported AI handler: "
        f"{handler_name}. Supported: neosantara, agno, any_llm, litellm, openai."
    )


class DefaultAIHandler:
    """Lazy selector used by tools that instantiate an AI handler directly."""

    def __new__(cls, *args, **kwargs):
        handler_cls = get_ai_handler_class()
        get_logger().info(f"Using AI handler: {handler_cls.__name__}")
        return handler_cls(*args, **kwargs)
