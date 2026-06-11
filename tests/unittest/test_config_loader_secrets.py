from unittest.mock import MagicMock, patch

from garda.config_loader import apply_secrets_to_config


class TestConfigLoaderSecrets:

    def test_apply_secrets_to_config_nested_keys(self):
        with patch('garda.config_loader.get_settings') as mock_get_settings:
            settings = MagicMock()
            settings.get.return_value = None
            settings.set = MagicMock()
            mock_get_settings.return_value = settings

            secrets = {
                'openai.key': 'sk-test',
                'github.webhook_secret': 'webhook-secret'
            }

            apply_secrets_to_config(secrets)

            settings.set.assert_any_call('OPENAI.KEY', 'sk-test')
            settings.set.assert_any_call('GITHUB.WEBHOOK_SECRET', 'webhook-secret')

    def test_apply_secrets_to_config_existing_value_preserved(self):
        with patch('garda.config_loader.get_settings') as mock_get_settings:
            settings = MagicMock()
            settings.get.return_value = 'existing-value'
            settings.set = MagicMock()
            mock_get_settings.return_value = settings

            apply_secrets_to_config({'openai.key': 'sk-test'})

            settings.set.assert_not_called()

    def test_apply_secrets_to_config_single_key(self):
        with patch('garda.config_loader.get_settings') as mock_get_settings:
            settings = MagicMock()
            settings.get.return_value = None
            settings.set = MagicMock()
            mock_get_settings.return_value = settings

            apply_secrets_to_config({'simple_key': 'simple_value'})

            settings.set.assert_not_called()

    def test_apply_secrets_to_config_multiple_dots(self):
        with patch('garda.config_loader.get_settings') as mock_get_settings:
            settings = MagicMock()
            settings.get.return_value = None
            settings.set = MagicMock()
            mock_get_settings.return_value = settings

            apply_secrets_to_config({'section.subsection.key': 'value'})

            settings.set.assert_not_called()
