# Instructions for AI coding assistants

This project is specified for Kiro. If you are another assistant (Claude Code, Cursor, Copilot, Codex…), follow the same rules:

1. **Before any change, read the steering files:** `.kiro/steering/product.md`, `.kiro/steering/tech.md`, `.kiro/steering/structure.md`. Their rules are mandatory.
2. **Work task by task** from the specs in `.kiro/specs/<spec>/`: read `requirements.md` and `design.md`, then implement one task from `tasks.md`.
3. **When a task is done**, tick its box (`- [x]`) in `tasks.md`, including sub-tasks.
4. **Every correctness property** in a `design.md` (M1, V3, A2, H5…) gets a fast-check test with the same name in `tests/properties/`.
5. **Do not change** the interfaces in `v23-modem/design.md` without telling the other team member. They are the contract between the two developers.
6. **Stay in your folders** (see `docs/repartition.md`) to avoid git conflicts.
7. If the code must deviate from a spec, update the spec in the same commit and say why.
