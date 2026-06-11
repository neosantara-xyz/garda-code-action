import asyncio
import os

from tenacity import retry, stop_after_attempt, wait_exponential

from garda.algo.ai_handlers.base_ai_handler import BaseAiHandler
from garda.config_loader import get_settings
from garda.log import get_logger

ANY_LLM_RETRIES = 3


class AnyLLMAIHandler(BaseAiHandler):
    """Any-LLM SDK handler, defaulting to the native Neosantara provider id."""

    def __init__(self):
        super().__init__()
        try:
            from any_llm import completion
        except ImportError as e:
            raise ImportError(
                "AnyLLMAIHandler requires the optional dependency `any-llm-sdk`. "
                "Install it or set config.ai_handler to `neosantara`/`litellm`."
            ) from e

        self._completion = completion
        self.provider = (
            get_settings().get("ANY_LLM.PROVIDER", None)
            or os.environ.get("ANY_LLM_PROVIDER")
            or get_settings().get("NEOSANTARA.PROVIDER", None)
            or "neosantara"
        )
        self.api_key = (
            get_settings().get("ANY_LLM.API_KEY", None)
            or os.environ.get("ANY_LLM_API_KEY")
            or get_settings().get("NEOSANTARA.KEY", None)
            or os.environ.get("NEOSANTARA_API_KEY")
        )
        if self.api_key and self.provider == "neosantara":
            os.environ.setdefault("NEOSANTARA_API_KEY", self.api_key)

    @property
    def deployment_id(self):
        return get_settings().get("ANY_LLM.DEPLOYMENT_ID", None)

    @retry(stop=stop_after_attempt(ANY_LLM_RETRIES), wait=wait_exponential(multiplier=1, min=1, max=8))
    async def chat_completion(self, model: str, system: str, user: str, temperature: float = 0.2, img_path: str = None):
        if img_path:
            get_logger().warning(f"Image path is not supported for AnyLLMAIHandler. Ignoring image path: {img_path}")

        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})

        kwargs = {
            "model": self._normalize_model(model),
            "messages": messages,
            "provider": self.provider,
        }
        if not get_settings().get("CONFIG.CUSTOM_REASONING_MODEL", False):
            kwargs["temperature"] = temperature

        response = await asyncio.to_thread(self._completion, **kwargs)
        resp = self._extract_content(response)
        finish_reason = self._extract_finish_reason(response)
        get_logger().info(
            "Any-LLM AI response",
            response=resp,
            messages=messages,
            finish_reason=finish_reason,
            model=kwargs["model"],
            provider=self.provider,
        )
        return resp, finish_reason

    def _normalize_model(self, model: str) -> str:
        prefix = f"{self.provider}:"
        if model.startswith(prefix):
            return model[len(prefix):]
        return model

    @staticmethod
    def _extract_content(response) -> str:
        if hasattr(response, "choices") and response.choices:
            message = response.choices[0].message
            if hasattr(message, "content"):
                return message.content
            if isinstance(message, dict):
                return message.get("content", "")
        if isinstance(response, dict):
            choices = response.get("choices") or []
            if choices:
                message = choices[0].get("message", {})
                return message.get("content", "")
            return response.get("content", "")
        return str(response)

    @staticmethod
    def _extract_finish_reason(response) -> str:
        if hasattr(response, "choices") and response.choices:
            return getattr(response.choices[0], "finish_reason", None) or "stop"
        if isinstance(response, dict):
            choices = response.get("choices") or []
            if choices:
                return choices[0].get("finish_reason") or "stop"
        return "stop"
