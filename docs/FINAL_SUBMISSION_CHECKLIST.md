# Final Submission Checklist

## Required Links And Artifacts

- [ ] GitHub repo URL: add final repository link before submission.
- [ ] Deployed dashboard link: add final deployment URL before submission.
- [x] Architecture doc: `docs/ARCHITECTURE.md`.
- [x] Evidence export Markdown: `docs/evidence/final-jito-evidence-summary.md`.
- [x] Evidence export JSON: `docs/evidence/final-jito-evidence-summary.json`.
- [ ] Screenshots: capture dashboard, requirement tracker, and evidence export screenshots before final upload.
- [x] README answers: `README.md` includes all three judge answers.

## Final Evidence Counts

- Landed real Jito bundles: 31
- Unique bundles with status checks: 62
- Total status-check attempts: 76
- Landed slots recorded: 31
- Yellowstone: not configured; RPC fallback only

Bundle ID alone was not treated as success; status was checked separately. Failed and network-error records remain operational evidence and are not counted as landed.

## Commit Safety

- `.env.local` and `.env*` are ignored except `.env.example`.
- `.data/` is ignored.
- Use the sanitized exports in `docs/evidence/`; do not commit raw `.data/jito-evidence.json`.
