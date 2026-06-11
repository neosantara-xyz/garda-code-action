import os

import openai
from openai import AsyncOpenAI
from tenacity import retry, retry_if_exception_type, retry_if_not_exception_type, stop_after_attempt

from garda.algo.ai_handlers.base_ai_handler import BaseAiHandler
from garda.config_loader import get_settings
from garda.log import get_logger

NEOSANTARA_RETRIES = 5
DEFAULT_NEOSANTARA_BASE_URL = "https://api.neosantara.xyz/v1"


class NeosantaraAIHandler(BaseAiHandler):
    """OpenAI-compatible Neosantara handler.

    This keeps the original Garda Code Action flow intact while routing requests to
    Neosantara by default. Agno and Any-LLM handlers are provided separately
    when a project wants those native SDK surfaces explicitly.
    """

    def __init__(self):
        super().__init__()
        self.api_key = self._get_api_key()
        self.base_url = self._get_base_url()
        self.client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)

    @property
    def deployment_id(self):
        return get_settings().get("NEOSANTARA.DEPLOYMENT_ID", None)

    def _get_api_key(self) -> str:
        key = (
            get_settings().get("NEOSANTARA.KEY", None)
            or os.environ.get("NEOSANTARA_API_KEY")
            or os.environ.get("NEOSANTARA_KEY")
        )
        if not key:
            raise ValueError("NEOSANTARA_API_KEY or neosantara.key is required for NeosantaraAIHandler")
        os.environ.setdefault("NEOSANTARA_API_KEY", key)
        return key

    def _get_base_url(self) -> str:
        return (
            get_settings().get("NEOSANTARA.BASE_URL", None)
            or os.environ.get("NEOSANTARA_BASE_URL")
            or DEFAULT_NEOSANTARA_BASE_URL
        )

    @retry(
        retry=retry_if_exception_type(openai.APIError) & retry_if_not_exception_type(openai.RateLimitError),
        stop=stop_after_attempt(NEOSANTARA_RETRIES),
    )
    async def chat_completion(self, model: str, system: str, user: str, temperature: float = 0.2, img_path: str = None):
        try:
            if img_path:
                get_logger().warning(f"Image path is not supported for NeosantaraAIHandler. Ignoring image path: {img_path}")

            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": user})

            kwargs = {
                "model": self._normalize_model(model),
                "messages": messages,
            }
            if not get_settings().get("CONFIG.CUSTOM_REASONING_MODEL", False):
                kwargs["temperature"] = temperature

            chat_completion = await self.client.chat.completions.create(**kwargs)
            resp = chat_completion.choices[0].message.content
            finish_reason = chat_completion.choices[0].finish_reason
            usage = getattr(chat_completion, "usage", None)
            get_logger().info(
                "Neosantara AI response",
                response=resp,
                messages=messages,
                finish_reason=finish_reason,
                model=kwargs["model"],
                usage=usage,
            )
            return resp, finish_reason
        except openai.RateLimitError as e:
            get_logger().error(f"Rate limit error during Neosantara inference: {e}")
            raise
        except openai.APIError as e:
            get_logger().warning(f"Error during Neosantara inference: {e}")
            raise
        except Exception as e:
            get_logger().warning(f"Unknown error during Neosantara inference: {e}")
            raise openai.APIError from e

    @staticmethod
    def _normalize_model(model: str) -> str:
        """Accept native ids and common provider-prefixed forms."""
        for prefix in ("neosantara:", "neosantara/"):
            if model.startswith(prefix):
                return model[len(prefix):]
        return model
