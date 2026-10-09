# Project context

## Where the plan came from

The [combined specification and implementation plan](plans/2026-10-08-0149-feat-native-vault-notes-plan.md) was produced through the Compound Engineering planning workflow. Its frontmatter records `artifact_contract: ce-unified-plan/v1` and `product_contract_source: ce-plan-bootstrap`. Product requirements were assembled from the planning conversation; there is no separate required spec document or hidden brainstorm file.

It began with the working name Vault Notes and an SDK 57 assumption. The user then explicitly requested this separate public `obsidian-expo` repository on SDK 58. The repository copy updates the setup decision and completed-starter status, while preserving all 18 product requirements. This copy is the plan to use here; the original planning checkout is not a dependency.

## What the user asked to build

- An Obsidian-compatible core writing experience with simple Markdown files, fast native editing, and easy search across thousands of notes.
- Open an existing vault in place, including iCloud locations, rather than requiring migration into an app-only database.
- A left file explorer sidebar and file bookmarks.
- A calendar in a sidebar or suitable compact presentation. Selecting a day opens its existing daily note or creates it from a template.
- A small Templater-compatible date/time subset initially. Full scripting and the rest of Obsidian's features are later work.
- The primary habit: open the app, reach today's note, and start writing immediately.
- Reliable vault access, saving, editing, and search before the convenience features.
- Expo was selected after considering Exact. SDK 58 and the repository name `obsidian-expo` were explicit later requests.
- Project context and references must be available from this repository for cloud execution, without navigating the original computer's folders.

## Defaults versus requirements

The user confirmed iOS-only implementation at first, covering iPhone and iPad. On October 9, 2026, the user asked for the Android version as well and left its design to the executor; [technology decisions](technology-decisions.md) (T16) records the choices. Web feature work is outside scope. The updated plan delegates library choices to the executor using the [technology options](technology-options-2026-10.md), while retaining native input, lossless source handling, coordinated vault access, SQLite FTS5, and the required sidebar/calendar behavior. Record selections before dependent implementation. The starter's Android and web bundles do not qualify vault features on those platforms.

The default daily-note profile is `Daily/YYYY-MM-DD.md`. Selected calendar dates determine note paths and titles; `tp.date.now()` uses the actual captured creation clock unless given an explicit reference. Existing notes are never templated again. The exact syntax whitelist is KTD6 in the plan.

## What exists now

The Expo starter runs on web and in an iOS development build. Bun installation, type checking, linting, dependency alignment, and production exports were verified. See [starter verification](../VERIFICATION.md) for platform limits.

The plan, this context, [cloud guide](CLOUD_DEVELOPMENT.md), [reference inventory](references/README.md), and all starter assets are committed. The reference inventory identifies which examples are synthetic and what they test.

The template renderer and the daily-note resolution logic (U6) exist as tested TypeScript, together with U1's fixtures, generator, and `bun test` setup. [Validation](validation.md) records what that evidence covers and what is still open. Vault access, native editor sessions, indexing, file bookmarks, and calendar behavior are still planned. File paths listed under U1-U8 describe future implementation work unless they already exist in Git. Do not create empty placeholder implementations just to make every proposed path exist.

## Working without local plugins or history

The complete product and technical contracts are in the plan. Implement one dependency-ready unit at a time, preserve its invariants, verify its scenarios, and record evidence. Use the unit's file list as a proposal, not as an instruction to load a file from another machine. No local agent memory, custom skill path, or personal vault is required.

Public framework links are supporting documentation and require network access. The repository contains the project-specific requirements and decisions; it is not an offline mirror of Apple, Expo, React Native, or Templater documentation.

## Planning-work transfer

The newer technology research, registry snapshot, and technology-selection gates from the planning project are now included here. See the [transfer inventory](PLANNING_TRANSFER.md) for the mapping of every source file and the repository-specific adaptations. This repository is the destination for further app work.
