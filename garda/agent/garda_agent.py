import shlex
from functools import partial

from garda.algo.ai_handlers.base_ai_handler import BaseAiHandler
from garda.algo.ai_handlers.default_ai_handler import DefaultAIHandler
from garda.algo.cli_args import CliArgs
from garda.algo.utils import update_settings_from_args
from garda.config_loader import get_settings
from garda.git_providers.utils import apply_repo_settings
from garda.log import get_logger
from garda.tools.pr_add_docs import PRAddDocs
from garda.tools.pr_code_suggestions import PRCodeSuggestions
from garda.tools.pr_config import PRConfig
from garda.tools.pr_description import PRDescription
from garda.tools.pr_generate_labels import PRGenerateLabels
from garda.tools.pr_help_docs import PRHelpDocs
from garda.tools.pr_help_message import PRHelpMessage
from garda.tools.pr_line_questions import PR_LineQuestions
from garda.tools.pr_questions import PRQuestions
from garda.tools.pr_reviewer import PRReviewer
from garda.tools.pr_similar_issue import PRSimilarIssue
from garda.tools.pr_update_changelog import PRUpdateChangelog

command2class = {
    "auto_review": PRReviewer,
    "answer": PRReviewer,
    "review": PRReviewer,
    "review_pr": PRReviewer,
    "describe": PRDescription,
    "describe_pr": PRDescription,
    "improve": PRCodeSuggestions,
    "improve_code": PRCodeSuggestions,
    "ask": PRQuestions,
    "ask_question": PRQuestions,
    "ask_line": PR_LineQuestions,
    "update_changelog": PRUpdateChangelog,
    "config": PRConfig,
    "settings": PRConfig,
    "help": PRHelpMessage,
    "similar_issue": PRSimilarIssue,
    "add_docs": PRAddDocs,
    "generate_labels": PRGenerateLabels,
    "help_docs": PRHelpDocs,
}

commands = list(command2class.keys())



class GardaAgent:
    def __init__(self, ai_handler: partial[BaseAiHandler,] = DefaultAIHandler):
        self.ai_handler = ai_handler  # will be initialized in run_action

    async def _handle_request(self, pr_url, request, notify=None) -> bool:
        # First, apply repo specific settings if exists
        apply_repo_settings(pr_url)

        # Then, apply user specific settings if exists
        if isinstance(request, str):
            request = request.replace("'", "\\'")
            lexer = shlex.shlex(request, posix=True)
            lexer.whitespace_split = True
            action, *args = list(lexer)
        else:
            action, *args = request

        # validate args
        is_valid, arg = CliArgs.validate_user_args(args)
        if not is_valid:
            get_logger().error(
                f"CLI argument for param '{arg}' is forbidden. Use instead a configuration file."
            )
            return False

        # Update settings from args
        args = update_settings_from_args(args)

        # Append the response language in the extra instructions
        response_language = get_settings().config.get('response_language', 'en-us')
        if response_language.lower() != 'en-us':
            get_logger().info(f'User has set the response language to: {response_language}')
            for key in get_settings():
                setting = get_settings().get(key)
                if str(type(setting)) == "<class 'dynaconf.utils.boxing.DynaBox'>":
                    if hasattr(setting, 'extra_instructions'):
                        current_extra_instructions = setting.extra_instructions
                        
                        # Define the language-specific instruction and the separator
                        lang_instruction_text = f"Your response MUST be written in the language corresponding to locale code: '{response_language}'. This is crucial."
                        separator_text = "\n======\n\nIn addition, "

                        # Check if the specific language instruction is already present to avoid duplication
                        if lang_instruction_text not in str(current_extra_instructions):
                            if current_extra_instructions: # If there's existing text
                                setting.extra_instructions = str(current_extra_instructions) + separator_text + lang_instruction_text
                            else: # If extra_instructions was None or empty
                                setting.extra_instructions = lang_instruction_text
                        # If lang_instruction_text is already present, do nothing.

        action = action.lstrip("/").lower()
        if action not in command2class:
            get_logger().warning(f"Unknown command: {action}")
            return False
        with get_logger().contextualize(command=action, pr_url=pr_url):
            get_logger().info("Garda Code Action request handler started", analytics=True)
            if action == "answer":
                if notify:
                    notify()
                await PRReviewer(pr_url, is_answer=True, args=args, ai_handler=self.ai_handler).run()
            elif action == "auto_review":
                await PRReviewer(pr_url, is_auto=True, args=args, ai_handler=self.ai_handler).run()
            elif action in command2class:
                if notify:
                    notify()

                await command2class[action](pr_url, ai_handler=self.ai_handler, args=args).run()
            else:
                return False
            return True

    async def handle_request(self, pr_url, request, notify=None) -> bool:
        try:
            return await self._handle_request(pr_url, request, notify)
        except:
            get_logger().exception("Failed to process the command.")
            return False
