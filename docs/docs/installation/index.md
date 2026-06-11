# Installation

There are several ways to use Garda Code Action:

- [Locally](./locally.md)
- [GitHub integration](./github.md)
- [GitLab integration](./gitlab.md)
- [BitBucket integration](./bitbucket.md)
- [Azure DevOps integration](./azure.md)
- [Gitea integration](./gitea.md)

!!! note "Docker Hub namespace migration"
    Releases **`0.34.2` and later** are published under [`neosantara/garda-code-action`](https://hub.docker.com/r/neosantara/garda-code-action). Older releases (up to and including `v0.31`) remain at the legacy [`neosantara/garda-code-action`](https://hub.docker.com/r/neosantara/garda-code-action) namespace as a frozen archive — no new images are pushed there. The examples on this site reference the new namespace; if you are pinning to a release before `0.34.2`, swap `neosantara/garda-code-action` for `neosantara/garda-code-action` in your `image:` / `docker pull` / `uses: docker://` references.
