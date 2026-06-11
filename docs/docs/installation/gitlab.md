## Run as a GitLab Pipeline

You can use a pre-built Action Docker image to run Garda Code Action as a GitLab pipeline. This is a simple way to get started with Garda Code Action without setting up your own server.

(1) Add the following file to your repository under `.gitlab-ci.yml`:

```yaml
stages:
  - garda

garda_job:
  stage: garda
  image:
    name: neosantara/garda-code-action:latest
    entrypoint: [""]
  script:
    - cd /app
    - echo "Running Garda Code Action action step"
    - export MR_URL="$CI_MERGE_REQUEST_PROJECT_URL/merge_requests/$CI_MERGE_REQUEST_IID"
    - echo "MR_URL=$MR_URL"
    - export gitlab__url=$CI_SERVER_PROTOCOL://$CI_SERVER_FQDN
    - export gitlab__PERSONAL_ACCESS_TOKEN=$GITLAB_PERSONAL_ACCESS_TOKEN
    - export config__git_provider="gitlab"
    - export openai__key=$OPENAI_KEY
    - python -m garda.cli --pr_url="$MR_URL" describe
    - python -m garda.cli --pr_url="$MR_URL" review
    - python -m garda.cli --pr_url="$MR_URL" improve
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
```

This script will run Garda Code Action on every new merge request. You can modify the `rules` section to run Garda Code Action on different events.
You can also modify the `script` section to run different Garda Code Action commands, or with different parameters by exporting different environment variables.

(2) Add the following masked variables to your GitLab repository (CI/CD -> Variables):

- `GITLAB_PERSONAL_ACCESS_TOKEN`: Your GitLab personal access token.

- `OPENAI_KEY`: Your OpenAI key.

Note that if your base branches are not protected, don't set the variables as `protected`, since the pipeline will not have access to them.

> **Note**: The `$CI_SERVER_FQDN` variable is available starting from GitLab version 16.10. If you're using an earlier version, this variable will not be available. However, you can combine `$CI_SERVER_HOST` and `$CI_SERVER_PORT` to achieve the same result. Please ensure you're using a compatible version or adjust your configuration.

> **Note**: The `gitlab__SSL_VERIFY` environment variable can be used to specify the path to a custom CA certificate bundle for SSL verification. GitLab exposes the `$CI_SERVER_TLS_CA_FILE` variable, which points to the custom CA certificate file configured in your GitLab instance.
> Alternatively, SSL verification can be disabled entirely by setting `gitlab__SSL_VERIFY=false`, although this is not recommended.

## Run a GitLab webhook server

1. In GitLab create a new user and give it "Reporter" role for the intended group or project.

2. For the user from step 1, generate a `personal_access_token` with `api` access.

3. Generate a random secret for your app, and save it for later (`shared_secret`). For example, you can use:

```bash
SHARED_SECRET=$(python -c "import secrets; print(secrets.token_hex(10))")
```

4. Clone this repository:

```bash
git clone https://github.com/neosantara-xyz/garda-code-action.git
```

5. Prepare variables and secrets. Skip this step if you plan on setting these as environment variables when running the agent:
    1. In the configuration file/variables:
        - Set `config.git_provider` to "gitlab"

    2. In the secrets file/variables:
        - Set your AI model key in the respective section
        - In the [gitlab] section, set `personal_access_token` (with token from step 2) and `shared_secret` (with secret from step 3)
        - **Authentication type**: Set `auth_type` to `"private_token"` for older GitLab versions (e.g., 11.x) or private deployments. Default is `"oauth_token"` for gitlab.com and newer versions.

6. Build a Docker image for the app and optionally push it to a Docker repository. We'll use Dockerhub as an example:

```bash
docker build . -t gitlab_garda --target gitlab_webhook -f docker/Dockerfile
docker push neosantara/garda-code-action:gitlab_webhook  # Push to your Docker repository
```

7. Set the environmental variables, the method depends on your docker runtime. Skip this step if you included your secrets/configuration directly in the Docker image.

```bash
CONFIG__GIT_PROVIDER=gitlab
GITLAB__PERSONAL_ACCESS_TOKEN=<personal_access_token>
GITLAB__SHARED_SECRET=<shared_secret>
GITLAB__URL=https://gitlab.com
GITLAB__AUTH_TYPE=oauth_token  # Use "private_token" for older GitLab versions
OPENAI__KEY=<your_openai_api_key>
PORT=3000  # Optional: override the webhook server port
```

8. Create a webhook in your GitLab project. Set the URL to `http[s]://<GARDA_HOSTNAME>/webhook`, the secret token to the generated secret from step 3, and enable the triggers `push`, `comments` and `merge request events`.

9. Test your installation by opening a merge request or commenting on a merge request using one of Garda Code Action's commands.

