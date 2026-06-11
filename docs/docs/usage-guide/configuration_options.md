The different tools and sub-tools used by Garda Code Action are adjustable via a Git configuration file.
There are four main ways to set persistent configurations:

1. [Wiki](./configuration_options.md#wiki-configuration-file) configuration page
2. [Local](./configuration_options.md#local-configuration-file) configuration file
3. [Global](./configuration_options.md#global-configuration-file) configuration file
4. [External configuration URL](./configuration_options.md#external-configuration-url) (CLI flag)

In terms of precedence, wiki configurations will override local configurations, local configurations will override global configurations, and global configurations will override an external configuration URL.


For a list of all possible configurations, see the [configuration options](https://github.com/neosantara-xyz/garda-code-action/blob/main/garda/settings/configuration.toml) page.
In addition to general configuration options, each tool has its own configurations. For example, the `review` tool will use parameters from the [pr_reviewer](https://github.com/neosantara-xyz/garda-code-action/blob/main/garda/settings/configuration.toml#L76) section in the configuration file.

!!! tip "Tip1: Edit only what you need"
    Your configuration file should be minimal, and edit only the relevant values. Don't copy the entire configuration options, since it can lead to legacy problems when something changes.
!!! tip "Tip2: Show relevant configurations"
    If you set `config.output_relevant_configurations` to True, each tool will also output in a collapsible section its relevant configurations. This can be useful for debugging, or getting to know the configurations better.



## Wiki configuration file

`Platforms supported: GitHub, GitLab, Bitbucket`

With Garda Code Action, you can set configurations by creating a page called `.garda.toml` in the [wiki](https://github.com/neosantara-xyz/garda-code-action/wiki/garda.toml) of the repo.
The advantage of this method is that it allows to set configurations without needing to commit new content to the repo - just edit the wiki page and **save**.


An example content:

```toml
[pr_description]
generate_ai_title=true
```

Garda Code Action will know to remove the surrounding quotes when reading the configuration content.

## Local configuration file

`Platforms supported: GitHub, GitLab, Bitbucket, Azure DevOps`

By uploading a local `.garda.toml` file to the root of the repo's default branch, you can edit and customize any configuration parameter. Note that you need to upload or update `.garda.toml` before using the Garda Code Action tools (either at PR creation or via manual trigger) for the configuration to take effect.

For example, if you set in `.garda.toml`:

```
[pr_reviewer]
extra_instructions="""\
- instruction a
- instruction b
...
"""
```

Then you can give a list of extra instructions to the `review` tool.

## Global configuration file

`Platforms supported: GitHub, GitLab (cloud), Bitbucket (cloud)`

If you create a repo called `garda-code-action-settings` in your **organization**, its configuration file `.garda.toml` will be used as a global configuration file for any other repo that belongs to the same organization.
Parameters from a local `.garda.toml` file, in a specific repo, will override the global configuration parameters.

For example, in the GitHub organization `neosantara-xyz`:

- The file [`https://github.com/neosantara-xyz/garda-code-action-settings/.garda.toml`](https://github.com/neosantara-xyz/garda-code-action-settings/blob/main/.garda.toml)  serves as a global configuration file for all the repos in the GitHub organization `neosantara-xyz`.

- The repo [`https://github.com/neosantara-xyz/garda-code-action`](https://github.com/neosantara-xyz/garda-code-action/blob/main/.garda.toml) inherits the global configuration file from `garda-code-action-settings`.

## Project/Group level configuration file

`Platforms supported: GitLab, Bitbucket Data Center`

Create a repository named `garda-code-action-settings` within a specific project (Bitbucket) or a group/subgroup (Gitlab). 
The configuration file in this repository will apply to all repositories directly under the same project/group/subgroup.

!!! note "Note"
    For Gitlab, in case of a repository nested in several sub groups, the lookup for a garda-code-action-settings repo will be only on one level above such repository.


## Organization level configuration file

`Relevant platforms: Bitbucket Data Center`

Create a dedicated project to hold a global configuration file that affects all repositories across all projects in your organization.

**Setting up organization-level global configuration:**

1. Create a new project with both the name and key: GARDA_SETTINGS.
2. Inside the GARDA_SETTINGS project, create a repository named garda-code-action-settings.
3. In this repository, add a `.garda.toml` configuration file—structured similarly to the global configuration file described above.
4. Optionally, you can add organizational-level [global best practices](../tools/improve.md#global-hierarchical-best-practices).

Repositories across your entire Bitbucket organization will inherit the configuration from this file.

!!! note "Note"
    If both organization-level and project-level global settings are defined, the project-level settings will take precedence over the organization-level configuration. Additionally, parameters from a repository’s local .garda.toml file will always override both global settings.

## External configuration URL

`Platforms supported: GitHub, GitLab, Bitbucket, Azure DevOps`

When running Garda Code Action from the CLI (or any wrapper that exposes its arguments), you can merge an additional `.garda.toml` from any URL or local path before the repo-local and global configurations are applied. This is useful when:

- You want a single shared configuration that applies to repositories nested deep inside subgroups, where the [project/group-level lookup](./configuration_options.md#projectgroup-level-configuration-file) only walks one level up.
- The shared configuration is published outside of a Git host (a static site, an internal artifact server, an S3 bucket, etc.).
- You want CI-time control over which defaults are layered in, without committing a file to the target repository.

### Usage

Pass `--extra_config_url` to the CLI, or set the `GARDA_EXTRA_CONFIG_URL` environment variable:

```bash
python -m garda.cli \
  --pr_url=<MR/PR URL> \
  --extra_config_url=https://config.example.com/garda-code-action/shared.toml \
  review
```

Accepted values:

- `https://…` or `http://…` — fetched at runtime
- `file:///path/to/shared.toml` — read from the local filesystem
- A bare filesystem path — same as `file://`

### Authentication for private endpoints

For private endpoints (e.g. a GitLab API URL pointing at a private `garda-code-action-settings` file), provide a single header via the `GARDA_EXTRA_CONFIG_AUTH_HEADER` environment variable, formatted as `<HeaderName>: <value>`:

```bash
# GitLab Personal Access Token
export GARDA_EXTRA_CONFIG_AUTH_HEADER="PRIVATE-TOKEN: <your-personal-access-token>"

# GitLab CI job token
export GARDA_EXTRA_CONFIG_AUTH_HEADER="JOB-TOKEN: $CI_JOB_TOKEN"

# Generic bearer token
export GARDA_EXTRA_CONFIG_AUTH_HEADER="Authorization: Bearer <your-token>"
```

### Precedence

External-URL settings are applied **first**, so every other layer overrides them:

```
built-in defaults
  < --extra_config_url
    < global garda-code-action-settings
      < local .garda.toml (repo default branch)
        < wiki .garda.toml
          < environment variables (GARDA__SECTION__KEY)
```

This means an external URL acts as an organization-wide *default* that any team can still override with their own `garda-code-action-settings` or repo-local `.garda.toml`.

### Security and limits

The external file is loaded through the same secure loader as the repo-local `.garda.toml`: includes, preloads, custom loaders, and other directives that could execute code or read arbitrary files are rejected. The fetcher additionally:

- Limits the response size to **1 MB**
- Uses a **10-second** request timeout
- Only accepts `http`, `https`, `file` schemes (or a bare local path)

If the fetch fails, the request is logged and Garda Code Action continues with the remaining configuration layers.
