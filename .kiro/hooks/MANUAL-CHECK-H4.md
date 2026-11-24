# Manual check H4: no ghost code in clear text (not a hook)

This is a manual security check, run by hand before a commit that touches `public/` or on request.
It is not automated. It becomes automatic only if a real Git hook is installed.

Property H4 (`fantome` spec): no file in `dist/` or `public/` contains any code (normalized or not) as a substring.

## When it can run

Only once `content/fantome/levels.json` and `public/transmissions/` exist (Role A, fantome tasks 1 to 3).
Until then the check is impossible and must be reported as "not run".

## Steps

1. Read the plain codes from `content/fantome/levels.json` (never copy them anywhere else).
2. For each code, search `public/` and `dist/` for the raw code and for its normalized form
   (normalization as defined in `src/fantome/`).
3. Any match is a leak: do not commit, report it to Role A.
4. Record the result (date, commit, "no match" or the matching files) in the pull request description.

## State

| Check | Configured | Dry run | Real run observed |
|---|---|---|---|
| H4 manual check | yes (this file) | not possible (target files absent) | never |
