# Project skills

Skills that Claude Code loads in this repository.

| Skill | Source | Use here |
|---|---|---|
| `wizard` | Vendored unchanged from [mattpocock/skills](https://github.com/mattpocock/skills) at commit `abeeaf95660ba9e8b7c753eb38f441ca707a8823` (MIT, see `LICENSE-mattpocock-skills`) | Scripts that walk the owner through steps only a human can take on the LAN or a public network (compiler host, local stack, Preprod wallet). First use: `scripts/wizards/ce29-rerun.sh`. |
| `domain-modeling` | Same source and commit | Keeps `GLOSSARY.md` and `docs/adr/` current. |

Rules for this repository take precedence over the vendored text: everything is written in English, no
secrets or internal host names go into a wizard or a committed `.env`, and the status of any check is
reported as verified or assumed (`CLAUDE.md`).

Do not edit the vendored files. Changes and our own skills belong in the separate skills repository planned in
`docs/agent-skills-plan.md`. To update the vendored files, copy them again from a newer commit and update the
commit hash above.
