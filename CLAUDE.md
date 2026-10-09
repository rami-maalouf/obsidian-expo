# Claude Code instructions

[AGENTS.md](AGENTS.md) holds the project instructions. Claude Code loads it through this import:

@AGENTS.md

## Commit identity

- Commit as `Rami Maalouf <me@ramimaalouf.com>` for both author and committer, not as the cloud session's default identity. Do not add `Co-Authored-By`, `Claude-Session`, or other assistant attribution lines, and do not sign commits with a session key. In a cloud session, set `user.name`, `user.email`, and `commit.gpgsign false` in the repository's git config before the first commit.
