MediStock Cloud - Lead Developer update (v19, 2026-11-20). Only changed and new files are in this zip. Paths are relative to the repository root.

1. Upload/replace the files in this zip at the same paths.
2. DELETE these two stale files from the repository ROOT (a zip cannot delete). Their copies are kept in tests/archive/:
     rules.test.js
     dispense.test.js
3. Run the CI (Actions). Both jobs should pass. If a test named "v19: ..." fails, report which one and paste its error: the new tests were written without an emulator.
4. Do NOT publish firestore.rules v19 to the real Firebase project until CI is green and a test project check is done.
5. Developers: read docs/DEVELOPER_BRIEFS_V19.md and docs/DATA_CONTRACT_V19.md before changing anything.

Changed:  firestore.rules, laboratory.html, pc-lab.js, tests/integration.test.js, tests/lab.test.js, tests/lab-check.js, tests-emulator/rules.test.js,
          docs/DATABASE_SCHEMA.md, docs/IMPLEMENTATION_PROGRESS.md, docs/SECURITY_TEST_REPORT.md
New:      docs/DATA_CONTRACT_V19.md, docs/STAGE0_FINDINGS.md, docs/DEVELOPER_BRIEFS_V19.md, tests/archive/rules.test.root-copy.js, tests/archive/dispense.test.root-copy.js
Not changed: sw.js, nav.js, users.html, mc-core.js and every other file (no new page or script was added, so no offline-cache change is needed).
