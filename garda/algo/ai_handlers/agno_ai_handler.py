import os

from tenacity import retry, stop_after_attempt, wait_exponential

from garda.algo.ai_handlers.base_ai_handler import BaseAiHandler
from garda.config_loader import get_settings
from garda.log import get_logger

AGNO_RETRIES = 3
DEFAULT_NEOSANTARA_BASE_URL = "https://api.neosantara.xyz/v1"


class AgnoAIHandler(BaseAiHandler):
    """Agno handler using Agno's native Neosantara model provider."""

    def __init__(self):
        super().__init__()
        try:
            from agno.agent import Agent
            from agno.models.neosantara import Neosantara
        except ImportError as e:
            raise ImportError(
                "AgnoAIHandler requires the optional dependency `agno`. "
                "Install it or set config.ai_handler to `neosantara`/`litellm`."
            ) from e

        self._agent_cls = Agent
        self._model_cls = Neosantara
        self.api_key = (
            get_settings().get("NEOSANTARA.KEY", None)
            or os.environ.get("NEOSANTARA_API_KEY")
            or os.environ.get("NEOSANTARA_KEY")
        )
        if not self.api_key:
            raise ValueError("NEOSANTARA_API_KEY or neosantara.key is required for AgnoAIHandler")
        os.environ.setdefault("NEOSANTARA_API_KEY", self.api_key)
        self.base_url = (
            get_settings().get("NEOSANTARA.BASE_URL", None)
            or os.environ.get("NEOSANTARA_BASE_URL")
            or DEFAULT_NEOSANTARA_BASE_URL
        )

    @property
    def deployment_id(self):
        return get_settings().get("AGNO.DEPLOYMENT_ID", None)

    @retry(stop=stop_after_attempt(AGNO_RETRIES), wait=wait_exponential(multiplier=1, min=1, max=8))
    async def chat_completion(self, model: str, system: str, user: str, temperature: float = 0.2, img_path: str = None):
        if img_path:
            get_logger().warning(f"Image path is not supported for AgnoAIHandler. Ignoring image path: {img_path}")

        model_instance = self._model_cls(
            id=self._normalize_model(model),
            api_key=self.api_key,
            base_url=self.base_url,
            temperature=temperature,
        )
        agent = self._agent_cls(
            model=model_instance,
            instructions=[system] if system else None,
            markdown=True,
        )
        response = await agent.arun(input=user)
        resp = self._extract_content(response)
        get_logger().info("Agno AI response", response=resp, model=model, provider="neosantara")
        return resp, "stop"

    @staticmethod
    def _normalize_model(model: str) -> str:
        for prefix in ("neosantara:", "neosantara/"):
            if model.startswith(prefix):
                return model[len(prefix):]
        return model

    @staticmethod
    def _extract_content(response) -> str:
        if hasattr(response, "content"):
            return response.content
        if isinstance(response, dict):
            return response.get("content", str(response))
        return str(response)
