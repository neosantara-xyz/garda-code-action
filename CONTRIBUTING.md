# Contributing

Thanks for helping improve Garda Code Action.

## Local setup

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
```

## Development notes

- Keep the public package name as `garda-code-action`.
- Keep the Python package namespace as `garda`.
- Keep repository config as `.garda.toml`; do not reintroduce legacy config aliases.
- Neosantara is the default handler. LiteLLM/OpenAI remain optional handlers.
- Do not reintroduce removed AWS, Lambda, CodeCommit, or LangChain surfaces unless the product scope changes.

## Validation

For a lightweight check:

```bash
python -m compileall -q garda tests
```

For full validation after dependencies are installed:

```bash
pytest -q
```
