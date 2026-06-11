In this page we will cover how to install and run Garda Code Action as a GitHub Action or GitHub App, and how to configure it for your needs.

## Run as a GitHub Action

You can use our pre-built Github Action Docker image to run Garda Code Action as a Github Action.

1) Add the following file to your repository under `.github/workflows/garda.yml`:

```yaml
on:
  pull_request:
    types: [opened, reopened, ready_for_review]
  issue_comment:
jobs:
  garda_job:
    if: ${{ github.event.sender.type != 'Bot' }}
    runs-on: ubuntu-latest
    permissions:
      issues: write
      pull-requests: write
      contents: write
    name: Run Garda Code Action on every pull request, respond to user comments
    steps:
      - name: Garda Code Action action step
        id: garda
        uses: neosantara-xyz/garda-code-action@main
        env:
          OPENAI_KEY: ${{ secrets.OPENAI_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

2) Add the following secret to your repository under `Settings > Secrets and variables > Actions > New repository secret > Add secret`:

```
Name = OPENAI_KEY
Secret = <your key>
```

The GITHUB_TOKEN secret is automatically created by GitHub.

3) Merge this change to your main branch.
When you open your next PR, you should see a comment from `github-actions` bot with a review of your PR, and instructions on how to use the rest of the tools.

4) You may configure Garda Code Action by adding environment variables under the env section corresponding to any configurable property in the [configuration](https://github.com/neosantara-xyz/garda-code-action/blob/main/garda/settings/configuration.toml) file. Some examples:

```yaml
      env:
        # ... previous environment values
        OPENAI.ORG: "<Your organization name under your OpenAI account>"
        PR_REVIEWER.REQUIRE_TESTS_REVIEW: "false" # Disable tests review
        PR_CODE_SUGGESTIONS.NUM_CODE_SUGGESTIONS: 6 # Increase number of code suggestions
```

See detailed usage instructions in the [USAGE GUIDE](../usage-guide/automations_and_usage.md#github-action)

### Configuration Examples

This section provides detailed, step-by-step examples for configuring Garda Code Action with different models and advanced options in GitHub Actions.

#### Quick Start Examples

##### Basic Setup (OpenAI Default)

Copy this minimal workflow to get started with the default OpenAI models:

```yaml
name: Garda Code Action
on:
  pull_request:
    types: [opened, reopened, ready_for_review]
  issue_comment:
jobs:
  garda_job:
    if: ${{ github.event.sender.type != 'Bot' }}
    runs-on: ubuntu-latest
    permissions:
      issues: write
      pull-requests: write
      contents: write
    steps:
      - name: Garda Code Action action step
        uses: neosantara-xyz/garda-code-action@main
        env:
          OPENAI_KEY: ${{ secrets.OPENAI_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

##### Gemini Setup

Ready-to-use workflow for Gemini models:

```yaml
name: Garda Code Action (Gemini)
on:
  pull_request:
    types: [opened, reopened, ready_for_review]
  issue_comment:
jobs:
  garda_job:
    if: ${{ github.event.sender.type != 'Bot' }}
    runs-on: ubuntu-latest
    permissions:
      issues: write
      pull-requests: write
      contents: write
    steps:
      - name: Garda Code Action action step
        uses: neosantara-xyz/garda-code-action@main
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          config.model: "gemini/gemini-1.5-flash"
          config.fallback_models: '["gemini/gemini-1.5-flash"]'
          GOOGLE_AI_STUDIO.GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          github_action_config.auto_review: "true"
          github_action_config.auto_describe: "true"
          github_action_config.auto_improve: "true"
```

#### Claude Setup

Ready-to-use workflow for Claude models:

```yaml
name: Garda Code Action (Claude)
on:
  pull_request:
    types: [opened, reopened, ready_for_review]
  issue_comment:
jobs:
  garda_job:
    if: ${{ github.event.sender.type != 'Bot' }}
    runs-on: ubuntu-latest
    permissions:
      issues: write
      pull-requests: write
      contents: write
    steps:
      - name: Garda Code Action action step
        uses: neosantara-xyz/garda-code-action@main
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          config.model: "anthropic/claude-3-opus-20240229"
          config.fallback_models: '["anthropic/claude-3-haiku-20240307"]'
          ANTHROPIC.KEY: ${{ secrets.ANTHROPIC_KEY }}
          github_action_config.auto_review: "true"
          github_action_config.auto_describe: "true"
          github_action_config.auto_improve: "true"
```

#### Basic Configuration with Tool Controls

Start with this enhanced workflow that includes tool configuration:

```yaml
on:
  pull_request:
    types: [opened, reopened, ready_for_review]
  issue_comment:
jobs:
  garda_job:
    if: ${{ github.event.sender.type != 'Bot' }}
    runs-on: ubuntu-latest
    permissions:
      issues: write
      pull-requests: write
      contents: write
    name: Run Garda Code Action on every pull request, respond to user comments
    steps:
      - name: Garda Code Action action step
        id: garda
        uses: neosantara-xyz/garda-code-action@main
        env:
          OPENAI_KEY: ${{ secrets.OPENAI_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Enable/disable automatic tools
          github_action_config.auto_review: "true"
          github_action_config.auto_describe: "true"
          github_action_config.auto_improve: "true"
          # Configure which PR events trigger the action
          github_action_config.pr_actions: '["opened", "reopened", "ready_for_review", "review_requested"]'
```

#### Switching Models

##### Using Gemini (Google AI Studio)

To use Gemini models instead of the default OpenAI models:

```yaml
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        # Set the model to Gemini
        config.model: "gemini/gemini-1.5-flash"
        config.fallback_models: '["gemini/gemini-1.5-flash"]'
        # Add your Gemini API key
        GOOGLE_AI_STUDIO.GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
        # Tool configuration
        github_action_config.auto_review: "true"
        github_action_config.auto_describe: "true"
        github_action_config.auto_improve: "true"
```

**Required Secrets:**

- Add `GEMINI_API_KEY` to your repository secrets (get it from [Google AI Studio](https://aistudio.google.com/))

**Note:** When using non-OpenAI models like Gemini, you don't need to set `OPENAI_KEY` - only the model-specific API key is required.

##### Using Claude (Anthropic)

To use Claude models:

```yaml
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        # Set the model to Claude
        config.model: "anthropic/claude-3-opus-20240229"
        config.fallback_models: '["anthropic/claude-3-haiku-20240307"]'
        # Add your Anthropic API key
        ANTHROPIC.KEY: ${{ secrets.ANTHROPIC_KEY }}
        # Tool configuration
        github_action_config.auto_review: "true"
        github_action_config.auto_describe: "true"
        github_action_config.auto_improve: "true"
```

**Required Secrets:**

- Add `ANTHROPIC_KEY` to your repository secrets (get it from [Anthropic Console](https://console.anthropic.com/))

**Note:** When using non-OpenAI models like Claude, you don't need to set `OPENAI_KEY` - only the model-specific API key is required.

##### Using Azure OpenAI

To use Azure OpenAI services:

```yaml
      env:
        OPENAI_KEY: ${{ secrets.AZURE_OPENAI_KEY }}
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        # Azure OpenAI configuration
        OPENAI.API_TYPE: "azure"
        OPENAI.API_VERSION: "2023-05-15"
        OPENAI.API_BASE: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
        OPENAI.DEPLOYMENT_ID: ${{ secrets.AZURE_OPENAI_DEPLOYMENT }}
        # Set the model to match your Azure deployment
        config.model: "gpt-4o"
        config.fallback_models: '["gpt-4o"]'
        # Tool configuration
        github_action_config.auto_review: "true"
        github_action_config.auto_describe: "true"
        github_action_config.auto_improve: "true"
```

**Required Secrets:**

- `AZURE_OPENAI_KEY`: Your Azure OpenAI API key
- `AZURE_OPENAI_ENDPOINT`: Your Azure OpenAI endpoint URL
- `AZURE_OPENAI_DEPLOYMENT`: Your deployment name

##### Using Local Models (Ollama)

To use local models via Ollama:

```yaml
      env:
        OPENAI_KEY: ${{ secrets.OPENAI_KEY }}
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        # Set the model to a local Ollama model
        config.model: "ollama/qwen2.5-coder:32b"
        config.fallback_models: '["ollama/qwen2.5-coder:32b"]'
        config.custom_model_max_tokens: "128000"
        # Ollama configuration
        OLLAMA.API_BASE: "http://localhost:11434"
        # Tool configuration
        github_action_config.auto_review: "true"
        github_action_config.auto_describe: "true"
        github_action_config.auto_improve: "true"
```

**Note:** For local models, you'll need to use a self-hosted runner with Ollama installed, as GitHub Actions hosted runners cannot access localhost services.

#### Advanced Configuration Options

##### Custom Review Instructions

Add specific instructions for the review process:

```yaml
      env:
        OPENAI_KEY: ${{ secrets.OPENAI_KEY }}
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        # Custom review instructions
        pr_reviewer.extra_instructions: "Focus on security vulnerabilities and performance issues. Check for proper error handling."
        # Tool configuration
        github_action_config.auto_review: "true"
        github_action_config.auto_describe: "true"
        github_action_config.auto_improve: "true"
```

##### Language-Specific Configuration

Configure for specific programming languages:

```yaml
      env:
        OPENAI_KEY: ${{ secrets.OPENAI_KEY }}
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        # Language-specific settings
        pr_reviewer.extra_instructions: "Focus on Python best practices, type hints, and docstrings."
        pr_code_suggestions.num_code_suggestions: "8"
        pr_code_suggestions.suggestions_score_threshold: "7"
        # Tool configuration
        github_action_config.auto_review: "true"
        github_action_config.auto_describe: "true"
        github_action_config.auto_improve: "true"
```

##### Selective Tool Execution

Run only specific tools automatically:

```yaml
      env:
        OPENAI_KEY: ${{ secrets.OPENAI_KEY }}
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        # Only run review and describe, skip improve
        github_action_config.auto_review: "true"
        github_action_config.auto_describe: "true"
        github_action_config.auto_improve: "false"
        # Only trigger on PR open and reopen
        github_action_config.pr_actions: '["opened", "reopened"]'
```

#### Using Configuration Files

Instead of setting all options via environment variables, you can use a `.garda.toml` file in your repository root:

1. Create a `.garda.toml` file in your repository root:

```toml
[config]
model = "gemini/gemini-1.5-flash"
fallback_models = ["anthropic/claude-3-opus-20240229"]

[pr_reviewer]
extra_instructions = "Focus on security issues and code quality."

[pr_code_suggestions]
num_code_suggestions = 6
suggestions_score_threshold = 7
```

2. Use a simpler workflow file:

```yaml
on:
  pull_request:
    types: [opened, reopened, ready_for_review]
  issue_comment:
jobs:
  garda_job:
    if: ${{ github.event.sender.type != 'Bot' }}
    runs-on: ubuntu-latest
    permissions:
      issues: write
      pull-requests: write
      contents: write
    name: Run Garda Code Action on every pull request, respond to user comments
    steps:
      - name: Garda Code Action action step
        id: garda
        uses: neosantara-xyz/garda-code-action@main
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GOOGLE_AI_STUDIO.GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          ANTHROPIC.KEY: ${{ secrets.ANTHROPIC_KEY }}
          github_action_config.auto_review: "true"
          github_action_config.auto_describe: "true"
          github_action_config.auto_improve: "true"
```

#### Troubleshooting Common Issues

##### Model Not Found Errors

If you get model not found errors:

1. **Check model name format**: Ensure you're using the correct model identifier format (e.g., `gemini/gemini-1.5-flash`, not just `gemini-1.5-flash`)

2. **Verify API keys**: Make sure your API keys are correctly set as repository secrets

3. **Check model availability**: Some models may not be available in all regions or may require specific access

##### Environment Variable Format

Remember these key points about environment variables:

- Use dots (`.`) or double underscores (`__`) to separate sections and keys
- Boolean values should be strings: `"true"` or `"false"`
- Arrays should be JSON strings: `'["item1", "item2"]'`
- Model names are case-sensitive

##### Rate Limiting

If you encounter rate limiting:

```yaml
      env:
        OPENAI_KEY: ${{ secrets.OPENAI_KEY }}
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        # Add a fallback model for better reliability
        config.fallback_models: '["gpt-5.4-mini"]'
        # Increase timeout for slower models
        config.ai_timeout: "300"
        github_action_config.auto_review: "true"
        github_action_config.auto_describe: "true"
        github_action_config.auto_improve: "true"
```

##### Common Error Messages and Solutions

**Error: "Model not found"**
- **Solution**: Check the model name format and ensure it matches the exact identifier. See the [Changing a model in Garda Code Action](../usage-guide/changing_a_model.md) guide for supported models and their correct identifiers.

**Error: "API key not found"**
- **Solution**: Verify that your API key is correctly set as a repository secret and the environment variable name matches exactly
- **Note**: For non-OpenAI models (Gemini, Claude, etc.), you only need the model-specific API key, not `OPENAI_KEY`

**Error: "Rate limit exceeded"**
- **Solution**: Add fallback models or increase the `config.ai_timeout` value

**Error: "Permission denied"**
- **Solution**: Ensure your workflow has the correct permissions set:
  ```yaml
  permissions:
    issues: write
    pull-requests: write
    contents: write
  ```

**Error: "Invalid JSON format"**

- **Solution**: Check that arrays are properly formatted as JSON strings:

```yaml

Correct:
config.fallback_models: '["model1", "model2"]'
Incorrect (interpreted as a YAML list, not a string):
config.fallback_models: ["model1", "model2"]
```

##### Debugging Tips

1. **Enable verbose logging**: Add `config.verbosity_level: "2"` to see detailed logs
2. **Check GitHub Actions logs**: Look at the step output for specific error messages
3. **Test with minimal configuration**: Start with just the basic setup and add options one by one
4. **Verify secrets**: Double-check that all required secrets are set in your repository settings

##### Performance Optimization

For better performance with large repositories:

```yaml
      env:
        OPENAI_KEY: ${{ secrets.OPENAI_KEY }}
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        # Optimize for large PRs
        config.large_patch_policy: "clip"
        config.max_model_tokens: "32000"
        config.patch_extra_lines_before: "3"
        config.patch_extra_lines_after: "1"
        github_action_config.auto_review: "true"
        github_action_config.auto_describe: "true"
        github_action_config.auto_improve: "true"
```

#### Reference

For more detailed configuration options, see:

- [Changing a model in Garda Code Action](../usage-guide/changing_a_model.md)
- [Configuration options](../usage-guide/configuration_options.md)
- [Automations and usage](../usage-guide/automations_and_usage.md#github-action)

### Using a specific release

!!! tip ""
    if you want to pin your action to a specific release (v0.34.2 for example) for stability reasons, use:
    ```yaml
    ...
        steps:
          - name: Garda Code Action action step
            id: garda
            uses: docker://neosantara/garda-code-action:0.34.2-github_action
    ...
    ```

    For enhanced security, you can also specify the Docker image by its [digest](https://hub.docker.com/repository/docker/neosantara/garda-code-action/tags):
    ```yaml
    ...
        steps:
          - name: Garda Code Action action step
            id: garda
            uses: docker://neosantara/garda-code-action@sha256:a0b36966ca3a197ca739fa1e65c16703076fc1c744cd423ca203b8c21707d71c
    ...
    ```

    Official Docker Hub release images also publish GitHub Artifact Attestations, so you can verify that a pinned digest was built from this repository before using it:
    ```sh
    gh attestation verify \
      "oci://index.docker.io/neosantara/garda-code-action@sha256:<digest>" \
      --repo The-Garda Code Action/garda-code-action
    ```

### Action for GitHub enterprise server

!!! tip ""
    To use the action with a GitHub enterprise server, add an environment variable `GITHUB.BASE_URL` with the API URL of your GitHub server.

    For example, if your GitHub server is at `https://github.mycompany.com`, add the following to your workflow file:
    ```yaml
          env:
            # ... previous environment values
            GITHUB.BASE_URL: "https://github.mycompany.com/api/v3"
    ```

---

## Run as a GitHub App

Allowing you to automate the review process on your private or public repositories.

1) Create a GitHub App from the [Github Developer Portal](https://docs.github.com/en/developers/apps/creating-a-github-app).

   - Set the following permissions:
     - Pull requests: Read & write
     - Issue comment: Read & write
     - Metadata: Read-only
     - Contents: Read-only
   - Set the following events:
     - Issue comment
     - Pull request
     - Push (if you need to enable triggering on PR update)

2) Generate a random secret for your app, and save it for later. For example, you can use:

```bash
WEBHOOK_SECRET=$(python -c "import secrets; print(secrets.token_hex(10))")
```

3) Acquire the following pieces of information from your app's settings page:

   - App private key (click "Generate a private key" and save the file)
   - App ID

4) Clone this repository:

```bash
git clone https://github.com/neosantara-xyz/garda-code-action.git
```

5) Copy the secrets template file and fill in the following:

```bash
cp garda/settings/.secrets_template.toml garda/settings/.secrets.toml
# Edit .secrets.toml file
```

- Your OpenAI key.
- Copy your app's private key to the private_key field.
- Copy your app's ID to the app_id field.
- Copy your app's webhook secret to the webhook_secret field.
- Set deployment_type to 'app' in [configuration.toml](https://github.com/neosantara-xyz/garda-code-action/blob/main/garda/settings/configuration.toml)

    > The .secrets.toml file is not copied to the Docker image by default, and is only used for local development.
    > If you want to use the .secrets.toml file in your Docker image, you can add remove it from the .dockerignore file.
    > In most production environments, you would inject the secrets file as environment variables or as mounted volumes.
    > For example, in order to inject a secrets file as a volume in a Kubernetes environment you can update your pod spec to include the following,
    > assuming you have a secret named `garda-code-action-settings` with a key named `.secrets.toml`:

    ```
           volumes:
            - name: settings-volume
              secret:
                secretName: garda-code-action-settings
    // ...
           containers:
    // ...
              volumeMounts:
                - mountPath: /app/garda/settings_prod
                  name: settings-volume
    ```

    > Another option is to set the secrets as environment variables in your deployment environment, for example `OPENAI.KEY` and `GITHUB.USER_TOKEN`.

6) Build a Docker image for the app and optionally push it to a Docker repository. We'll use Dockerhub as an example:

    ```bash
    docker build . -t neosantara/garda-code-action:github_app --target github_app -f docker/Dockerfile
    docker push neosantara/garda-code-action:github_app  # Push to your Docker repository
    ```

7. Host the app using a server, serverless function, or container environment. Alternatively, for development and
   debugging, you may use tools like smee.io to forward webhooks to your local machine.

8. Go back to your app's settings, and set the following:

   - Webhook URL: The URL of your app's server or the URL of the smee.io channel.
   - Webhook secret: The secret you generated earlier.

9. Install the app by navigating to the "Install App" tab and selecting your desired repositories.

> **Note:** When running Garda Code Action from GitHub app, the default configuration file (configuration.toml) will be loaded.
> However, you can override the default tool parameters by uploading a local configuration file `.garda.toml`
> For more information please check out the [USAGE GUIDE](../usage-guide/automations_and_usage.md#github-app)
---

## Additional deployment methods

