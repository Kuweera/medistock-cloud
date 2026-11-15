# GUIDELINES_SPEC.md
Phase 5, Developer 2 (Clinical Guidelines and Information Library). Status: **built and tested on an in-memory Firestore stand-in. Not run against real Firebase. Not released.**
Owned files: `guidelines.html`, `pc-guidelines.js`, `tests/guidelines*`, `docs/GUIDELINES_*`, `docs/guidelines-import-template.json`.
**No existing file was changed** (checked by diffing against the supplied zip). `mc-core.js`, `firestore.rules`, `nav.js`, `sw.js`, `users.html` and every inventory/sales file are untouched. The page uses only `window.top.MC.api(window)` (`collection`, `doc`, `query`, `where`, `onSnapshot`, `writeBatch`, ...).

## 0. What is NOT in this delivery, and why
**No clinical content is shipped.** The master plan forbids inventing doses, thresholds, diagnostic criteria or regimens, and the project does not contain the Uganda Clinical Guidelines. The library therefore starts empty. Content must be typed in or imported (draft) from the real source by the facility, then approved by an authorised person. Test data in `tests/` is obviously fake ("TEST ..."). A test checks that `pc-guidelines.js` contains no doses or thresholds.

## 1. Data Contract: how it was applied
| Contract item | Built as | Notes |
|---|---|---|
| `guidelines.id` | document id = `gl_{guidelineKey}_v{version}`; also stored in field `id` | unique per **version**, so a clinical record can point at the exact version it used |
| `title` | string | |
| `category` | string, one of 13 **keys** (below) | store the key, show `PCG.categoryLabel(key)` |
| `symptoms` | `string[]` | complaints/symptoms the entry relates to. Used only to help find it. Never a diagnosis |
| `investigations` | `string[]` | test names |
| `treatment` | `string` | treatment text exactly as the source states it (multi-line). Not an order |
| `source` | `string` | composed automatically: `Title (Edition) — Publisher — Chapter/page — Country`, e.g. `Uganda Clinical Guidelines (2023) — Ministry of Health, Uganda — Chapter 3, page 120 — Uganda` |

Category keys: `general_assessment, common_illnesses, infectious, respiratory, gastrointestinal, paediatric, maternal, ncd, emergency, wound, laboratory, medication_safety, followup_referral`.

**Additive fields (the master plan requires them; none of the contract names were changed):**
- Standard Patient Care stamp: `businessId, facilityId, schemaVersion, createdBy, createdAt (server time), clientCreatedAt`.
- Identity/version: `guidelineKey` (same for every version of one entry), `version` (int), `approvalStatus` (`draft | approved | superseded | retired`), `supersedes`, `supersededBy`.
- `scope`: `national` (national or published guideline, visible to the whole business) or `facility` (local protocol, visible only to the facility that wrote it). `basedOnKey` (facility only, optional): the `guidelineKey` of a related national entry.
- Source details (plan section 2): `sourceTitle, sourceOrg, sourceEdition, sourceRef, jurisdiction, enteredDate, effectiveDate, reviewDate` (dates `yyyy-mm-dd`), `approvedBy, approvedByName, approvedAt, selfApproved`, `retiredReason, retiredBy, retiredByName, retiredAt`, `enteredByName`, `origin` (`manual | import | new_version`).
- Clinical cards (plan section 3): `assessment{questions[], history[], document[], examination[]}`, `warningSigns{danger[], urgent[], referral[]}`, `investigationNotes[]`, `precautions[]`, `followUp[]`, `referralAdvice[]`, `sectionRefs{assessment, warnings, investigations, management}` (page for each section, shown under it as "Source: ..."), `aliases[]` (other names, search only).
- Also written: `pc_audit_logs` documents, **existing shape only**, with actions `guideline.create | edit_draft | approve | new_version | retire | discard | import`.

## 2. How the plan items were met
| Plan item | Where |
|---|---|
| Library, 13 categories, search | `guidelines.html`: category pills, search over title, other names, symptoms, tests, treatment text and all points (title and symptoms rank first, partial words work, every word must match) |
| Every entry shows source, edition, page, country, dates, approval, approver | Source box on every card; approval is refused if any is empty (`PCG.approvalProblems`) |
| Cards A–D (assessment, warning signs, investigations, management) | Each section shows its own "Source: ... · page" line, so every recommendation stays linked to its source |
| No invented content | Library empty by default; import/typing only; drafts invisible to ordinary staff |
| Facility protocols | `scope: "facility"`. Always labelled **Local facility protocol**; national entries are never hidden or replaced. A local protocol and its related national entry link to each other on both cards |
| Version management | Approved text is never edited. "Create a new version" copies it to a new draft (`v+1`). Approving it marks the previous approved version `superseded` in the **same batch**. Old versions stay readable ("Version history"). `reviewDate` passed -> red "Review overdue"; due within 30 days -> "Review due soon"; managers get a count and a filter |
| Records keep the version used | Other screens store `PCG.refOf(g)` (see 3). Because the id includes the version, the old text stays readable forever |
| Offline | Reads come through the app's cache. Saving a draft offline is queued by Firestore and shown as "Waiting to sync / NOT reached the server", never as saved. **Approve, retire and discard need a connection** (a safety choice: an approval must be confirmed) |
| Plain-language errors | `PCG.friendlyError` (no `permission-denied` etc. shown) |
| Mobile and desktop | Single column with horizontally scrolling category pills on phones; two columns with a sticky card on desktop; 40–48 px tap targets. Checked at 390 px and 1280 px |

## 3. How other screens connect (for Developer 3; reading only, no data structure changes)
Add `<script src="pc-guidelines.js"></script>` to a screen, then:
```js
// 1. a plain link or button anywhere (consultation, triage, investigations, diagnosis, treatment, dosing rules, MAR):
mcGo(PCG.linkFor({ q: complaintText }));            // opens the library with the search filled in
mcGo(PCG.linkFor({ id: ref.guidelineId }));         // opens exactly the version a record used
// 2. a "Related guidance" strip next to what the clinician recorded (retrieval only, never a diagnosis):
const rows = [];  // read-only listeners on guidelines:
//   query(collection(db,"guidelines"), where("businessId","==",businessId), where("scope","==","national"))
//   query(collection(db,"guidelines"), where("businessId","==",businessId), where("facilityId","==",facilityId), where("scope","==","facility"))
const hits = PCG.suggest(PCG.currentOnly(rows), { complaints: [...], diagnoses: [...], medicines: [...], tests: [...] });  // [{g, score, matchedOn[]}]
// 3. if a clinician chooses to cite a guideline, store this small object on THEIR record (additive field `guidelineRef`):
const ref = PCG.refOf(g);   // { guidelineId, guidelineKey, guidelineVersion, guidelineTitle, guidelineScope, guidelineSource }
```
Adding `guidelineRef` to an existing clinical collection is a data-structure change: agree it with the owner of that collection and Developer 4 (rules) first. The library page works without it.
Label the strip "Reference material to read. This is not a diagnosis." Link query parameters: `q`, `cat`, `id`, `scope`.
Field text that Developer 3 may reuse is in `guidelines.html` (every field has what/why/how/required-or-optional help).

## 4. Requirements for Developer 4 (rules, tests, integration)
**Rules are NOT in `firestore.rules`.** Until added, `guidelines` is default-deny: the page shows "...security rules are not published yet". Proposed rules and the emulator test list are in `docs/GUIDELINES_RULES_PROPOSAL.txt` (untested). Points to decide:
- Read: national entries by any active member of the business; facility protocols by that facility only. Known limit: drafts are readable at database level by members (rules cannot filter a list query); the screen hides them.
- New permission keys (add to `users.html`, Developer 3): `guidelines.manage`, `guidelines.approve`. Until then only the owner can add/approve; everyone else can read.
- Self-approval: allowed (a one-person clinic must be able to approve) but stored as `selfApproved: true` and shown on the card. Decide whether to forbid it for facilities with more than one user.
- Queries used (equality only, no composite index): `businessId + scope` and `businessId + facilityId + scope`. Both listen with `includeMetadataChanges` to show "Waiting to sync".
- Page needs `patient_care` enabled on the shop (same as the other pages). Writes use `writeBatch` so approve + supersede + audit are all-or-nothing.
- Integration lines (not applied): `nav.js` ITEMS `["guidelines.html", "Guidelines"]`; `sw.js` PAGES `"guidelines.html", "pc-guidelines.js"` and bump `VERSION` (coordinate with Developer 1's pharmacy lines in the same edit).
- Add the collection to `docs/DATABASE_SCHEMA.md` (use section 1 above).
- Tests: `node --test tests/` (17 logic tests, Node 18+, no installs). `tests/guidelines-browser-check.js` + `tests/guidelines-harness.html` drive the page in Chromium on an in-memory database (serve the repo, e.g. `python3 -m http.server 8765`, then `node tests/guidelines-browser-check.js`). Emulator rule tests still need writing.

## 5. Known gaps (not built)
- Not tested against real Firebase, the real rules, or a physical phone. Not released.
- No clinical content. Someone with the real Uganda Clinical Guidelines / MoH / WHO documents must enter or import it and a second qualified person should approve it.
- Search runs in the browser over everything loaded (fine for hundreds to a few thousand entries). Very large libraries would need an index.
- Import is JSON only (template in `docs/guidelines-import-template.json` or the Import tab). No PDF or Word parsing; copy text from the source.
- Entries are per business. There is no sharing of one national library across different businesses.
- No attachments or images (algorithms/flowcharts) yet.
- The "Related guidance" strips inside consultation, triage, investigations, diagnosis, treatment, dosing rules and MAR are **not wired** because those screens belong to Developer 3. The helpers and deep links above are ready.
- Approved entries cannot be corrected in place (by design). A typo needs a new version.
