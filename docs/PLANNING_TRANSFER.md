# Planning transfer inventory

Transferred on October 8, 2026 from the Vault Notes planning repository at commit `6c66f5a`. All seven source-controlled files are accounted for below. That repository contained planning and reference material, not application code. The source repository was left unchanged.

| Source material | Destination and handling |
| --- | --- |
| Execution guidance (`AGENTS.md`) | Merged into [agent instructions](../AGENTS.md), including technology selection, evidence, compatibility, and hardware qualification rules |
| Unified plan | Merged into the [specification and plan](plans/2026-10-08-0149-feat-native-vault-notes-plan.md), including KTD8 and the technology gates in U1-U7; R1-R18 are unchanged |
| Technology-options research | Included in [technology options](technology-options-2026-10.md); adapted the project name, SDK 58 scope, and reference link |
| Registry version snapshot | Copied unchanged to [version evidence](references/technology-versions-2026-10-08.json) |
| Private reference README and configuration | Represented by the [public reference inventory](references/README.md) and [sanitized profile](references/obsidian/daily-note-profile.json) |
| Private filled-in daily note | Represented by the approved [sanitized daily note](references/obsidian/vault/Daily/2000-01-03.md), with linked notes included |
| Private daily template | Represented by the approved [sanitized template](<references/obsidian/vault/Templates/Daily Template.md>), with its unsupported syntax preserved |

## Precedence and adaptations

- This public repository is the destination for further app implementation and planning updates. Its cloud workers do not need the original checkout.
- Preserve the existing SDK 58 starter and lockfile. The source plan's instructions to scaffold a new app or choose SDK 57 were superseded by the user's SDK 58 request.
- Implement iOS on iPhone/iPad only for now. Android and web feature work and acceptance requirements are outside scope; their starter bundle checks do not change that.
- Preserve the cloud instructions, verification evidence, and sanitized examples already present here. The user's public-repository sanitization choice supersedes the source project's permission to store private originals.
- Technology research is dated evidence, not a fresh verification or an installed dependency list. Recheck official sources before adopting a candidate and record decisions as required by KTD8.
- Future feature paths and decision/validation documents remain implementation tasks. Transferring the plan does not claim those features or their tests are complete.
