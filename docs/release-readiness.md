# Release Readiness Checklist

Use this before moving the floating `v1` tag or publishing to GitHub Marketplace.

## Required local checks

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
node --check dist/index.js
node --check dist/simulate.js
npm audit --omit=dev
```

## Required repository checks

- `action.yml` is at the repository root.
- `dist/index.js` and `dist/simulate.js` are committed.
- The repository is public before Marketplace publishing.
- The release tag points to the commit that includes the generated `dist` files.
- `.github/workflows/ci.yml` passes on GitHub-hosted Ubuntu with Node 24.

## Required live matrix before `v1`

| Scenario                                 | Expected result                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| PR opened, same repository               | Garda posts one sticky review comment and optional batch inline review. |
| `@garda review` issue comment on PR      | Garda hydrates PR context and checks out PR head before reading files.  |
| Fork PR                                  | Review-only behavior; write tools and commits are unavailable.          |
| Issue `@garda fix` with `allow_fix=true` | Garda creates a `garda/issue-*` branch and links a create-PR URL.       |
| Same-repo PR fix with `allow_fix=true`   | Garda commits only to the PR head branch.                               |
| `allowed_tools` read-only policy         | Write/commit tools are unavailable even if the model asks for them.     |
| GitHub App token workflow                | Comments appear as `garda-code[bot]` or your configured app bot.        |

## Recommended alpha tag flow

```bash
git tag v0.1.9
git push origin v0.1.9
```

Move `v1` only after the live matrix passes:

```bash
git tag -f v1 v0.1.9
git push origin v1 --force
```
