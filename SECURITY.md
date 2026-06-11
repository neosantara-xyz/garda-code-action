# Security Policy

Garda Code Action is a Neosantara-first open-source tool for automated pull request review and code collaboration workflows.

## Data flow

When using Garda Code Action with your own provider key, the security relationship is directly between your repository environment and the configured provider. For the default setup, requests are sent to Neosantara using `NEOSANTARA_API_KEY`.

Garda Code Action should be deployed with the minimum permissions required for your Git provider. For GitHub Actions, prefer repository-scoped secrets and the following permissions:

```yaml
permissions:
  contents: read
  issues: write
  pull-requests: write
```

## Secrets

Store provider keys in your CI or platform secret manager. Do not commit `.env` files or API keys to the repository.

Required default secret:

```text
NEOSANTARA_API_KEY
```

Optional handler selector:

```text
GARDA_AI_HANDLER
```

## Reporting vulnerabilities

Please report security issues privately to the maintainers of the repository before public disclosure.
