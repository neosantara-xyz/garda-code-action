# Publish Garda Code Action

## Repository layout

The public action repository must contain `action.yml` at the root and a committed `dist/index.js` bundle.

Recommended repository name:

```txt
garda-code-action
```

Recommended use reference after release:

```yaml
uses: neosantara-xyz/garda-code-action@v1
```

## Publish steps

```bash
git init
git add .
git commit -m "feat: initial garda code action"
git branch -M main
git remote add origin git@github.com:neosantara-xyz/garda-code-action.git
git push -u origin main
```

Create immutable version tags:

```bash
git tag v0.1.9
git push origin v0.1.9
```

Move the major tag only after testing the version tag:

```bash
git tag -f v1 v0.1.9
git push origin v1 --force
```

## Marketplace

After the repository is public, open `action.yml` on GitHub. GitHub shows a Marketplace publishing banner from the action metadata file. Use a GitHub release tag to publish.

## Pre-publish checklist

```bash
npm ci
npm test
npm run typecheck
npm run build
node --check dist/index.js
node --check dist/simulate.js
npm audit --omit=dev
```

Also test once in a dummy repository with a real PR and a comment:

```txt
@garda review
```
