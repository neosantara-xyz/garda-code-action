# TypeScript parity audit

This audit compares Garda Code Action with the referenced Claude Code Action source for TypeScript safety.

## Findings

Claude Code Action does use `any`, but it keeps most usages at integration boundaries, tests, and transcript formatting. In the referenced source snapshot, the production `src`/`base-action/src` tree has about 22 syntax-level `any` usages, while tests have about 102.

Before this patch, Garda Code Action had about 56 syntax-level `any` usages in production `src` and 10 in tests. Most of them came from three areas:

- GitHub/Octokit client boundaries
- Neosantara Responses API parsing
- Inline classifier JSON normalization

## Patch result

Garda Code Action now has zero syntax-level `any` usages in both production source and tests.

The audit command used was:

```bash
pattern='(: any\\b|as any\\b|<any\\b|any\\[\\]|Record<string, any>|Promise<any>|\\bany\\[)'
rg -n "$pattern" src test --glob '*.ts'
```

## TypeScript compiler strictness

The action now keeps `strict: true` and adds the stricter flags used by Claude Code Action:

```json
{
  "noFallthroughCasesInSwitch": true,
  "noUncheckedIndexedAccess": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true
}
```

`exactOptionalPropertyTypes` is intentionally not enabled because the referenced Claude Code Action snapshot does not enable it either. Enabling it is possible later, but it would require broader optional-field normalization across GitHub webhook payload types.

## Replacements made

- Added typed GitHub payload/client boundary types in `src/github/types.ts`.
- Replaced Octokit `any` with typed `GitHubClient`.
- Replaced Responses API `any` parsing with `unknown` plus narrow local response interfaces.
- Replaced classifier JSON casts with `unknown` type guards.
- Replaced test mocks with explicit local request/call types.
- Kept external API responses parsed defensively rather than trusted.

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run build
node --check dist/index.js
node --check dist/simulate.js
npm audit --omit=dev
```
