# Garda Code Action + Neosantara

Garda Code Action keeps Garda Code Action's review workflows and adds Neosantara-first model routing. This lean build removes LangChain and AWS-specific surfaces while keeping the existing non-AWS Garda Code Action tools.

## Handler matrix

| Handler | Config value | Dependency | Purpose |
| --- | --- | --- | --- |
| Neosantara OpenAI-compatible | `neosantara` | `openai` | Default, simplest and most stable path. |
| Agno native | `agno` | `agno` | Uses Agno's native `agno.models.neosantara.Neosantara` provider. |
| Any-LLM native | `any_llm` | `any-llm-sdk` | Uses Any-LLM provider id `neosantara`. |
| LiteLLM legacy | `litellm` | `litellm` | Kept for non-AWS upstream model routing. |
| OpenAI legacy | `openai` | `openai` | Existing direct OpenAI handler. |

## Environment variables

```bash
export NEOSANTARA_API_KEY="..."
export GARDA_AI_HANDLER="neosantara" # optional
```

Optional values for `GARDA_AI_HANDLER`:

- `neosantara`
- `agno`
- `any_llm`
- `litellm`
- `openai`

## Repository config override

Create `.garda.toml` in the repository being reviewed:

```toml
[config]
ai_handler = "any_llm"
model = "grok-4.1-fast-non-reasoning"

[any_llm]
provider = "neosantara"
```

For Agno:

```toml
[config]
ai_handler = "agno"
model = "grok-4.1-fast-non-reasoning"
```

For legacy LiteLLM:

```toml
[config]
ai_handler = "litellm"
model = "openai/gpt-4o-mini"
```

## Removed from lean Garda build

- LangChain handler and optional LangChain dependency notes
- AWS Secrets Manager provider
- AWS CodeCommit provider
- AWS Lambda deployment targets
- Amazon Bedrock model/config docs
- `boto3` runtime dependency
