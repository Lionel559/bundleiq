# Final Submission Checklist

## Required Links And Artifacts

- [ ] GitHub repo URL: add final repository link before submission.
- [ ] Deployed dashboard link: add final deployment URL before submission.
- [x] Architecture doc: `docs/ARCHITECTURE.md`.
- [ ] Public Architecture Document: [TO BE ADDED: Google Docs/Notion public URL].
- [x] Evidence export Markdown: `docs/evidence/final-jito-evidence-summary.md`.
- [x] Evidence export JSON: `docs/evidence/final-jito-evidence-summary.json`.
- [ ] Screenshots: capture dashboard, requirement tracker, and evidence export screenshots before final upload.
- [x] README answers: `README.md` includes all three judge answers.
- [x] SolInfra Yellowstone final validation: connected to live gRPC stream in FRA.
- [x] Build validation: `npm run lint` and `npm run build` pass.

## Final Evidence Counts

- Landed real Jito bundles: 31
- Unique bundles with status checks: 62
- Total status-check attempts: 76
- Landed slots recorded: 31
- SolInfra Yellowstone: connected during final validation
- SolInfra endpoint region: FRA

Bundle ID alone was not treated as success; status was checked separately. Failed and network-error records remain operational evidence and are not counted as landed.

The dynamic tip engine supports live/recent network inputs. The final landed Jito evidence used the minimum configured tip where applicable, so the submission does not claim that every landed bundle used varied dynamic tips.

## Commit Safety

- `.env.local` and `.env*` are ignored except `.env.example`.
- `.data/` is ignored.
- Use the sanitized exports in `docs/evidence/`; do not commit raw `.data/jito-evidence.json`.
