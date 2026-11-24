# VENDOR_MANIFEST.md
Fetched by the 'Fetch vendor libraries' workflow on 2026-11-23 from the official npm registry (pdfjs-dist, mammoth, tesseract.js, tesseract.js-core), cdn.sheetjs.com (SheetJS 0.20.3) and github.com/tesseract-ocr/tessdata_fast. Versions are the ones requested: pdf.js 3.11.174, mammoth 1.8.0, SheetJS 0.20.3, tesseract.js 5.1.1 (+ tesseract.js-core 5.1.1).

## Verified by Developer 4 on 2026-11-23
The 25 files fetched by the workflow, listed below, were re-hashed from the files delivered to me (SHA-256 and size): **25 of 25 match, 0 differ.** The owner later added one more file, `LICENSE-eng.traineddata` (last row), which is not from the registry workflow. The versions were read from the files themselves where they state them (pdf.js 3.11.174, SheetJS 0.20.3); mammoth 1.8.0 and tesseract.js 5.1.1 (+ core 5.1.1) are as named by the workflow and the folder names. I did not compare against the registries (no network here).

## Licences
| Library | Licence | Licence file |
|---|---|---|
| pdf.js 3.11.174 | Apache-2.0 | vendor/pdfjs-3.11.174/LICENSE |
| mammoth 1.8.0 | BSD-2-Clause | vendor/mammoth-1.8.0/LICENSE |
| SheetJS Community 0.20.3 | Apache-2.0 | vendor/sheetjs-0.20.3/LICENSE |
| tesseract.js 5.1.1 | Apache-2.0 | vendor/tesseract-5.1.1/LICENSE.md |
| tesseract.js-core 5.1.1 | Apache-2.0 | vendor/tesseract-5.1.1/core/LICENSE |
| eng.traineddata (tessdata_fast) | Apache-2.0 (the licence text the owner added is the standard Apache-2.0 text and names no copyright holder) | vendor/tesseract-5.1.1/lang/LICENSE-eng.traineddata |

## Notes
- **pdf.js 3.11.174 and untrusted PDFs.** To my knowledge this release is affected by CVE-2024-4367 (code execution through a crafted PDF when font evaluation is enabled), fixed in pdf.js 4.2.67 and later. The app opens every PDF with `isEvalSupported: false`, the documented workaround (in `pc-import-tools.js`). pdf.js 4.x is ES-module only and the app has no build step, so I stayed on 3.11.174. I could not verify the CVE details offline; the owner should check them. Decision for the Lead if a newer pdf.js is wanted.
- **mammoth 1.8.0.** I recall an advisory for versions before 1.11.0 about external linked images and file access in Node. The app uses only the browser build, which has no file system. Not verified offline.
- **Unused files.** The app loads only the files marked in the last column of the table. The other tesseract-core variants (`tesseract-core.js`, `tesseract-core-simd.js`, `tesseract-core-lstm.js`, `tesseract-core-simd-lstm.js`, the plain `.wasm` files and the non-LSTM `.wasm.js`) and the uncompressed `eng.traineddata` are not loaded; the Lead may leave them out of the offline cache. Together they are about 25 MB of the 35 MB in `vendor/tesseract-5.1.1`; the app loads about 10 MB of it (and only one of the two cores on a given device).
- **Download sizes for the offline button** (what the app fetches): PDF 1.4 MB; Word 0.6 MB; Excel 0.9 MB; OCR about 6.1 MB plus the PDF tool 1.4 MB (OCR renders pages with pdf.js).
- **Local paths only.** Every library, the OCR worker, the OCR core and the language data load from `vendor/` through relative paths. The Stage 2 browser check records every request made during OCR and fails if any leaves the app.

## Files
| File | Bytes | SHA-256 | Used by the app for |
|---|---|---|---|
| vendor/mammoth-1.8.0/LICENSE | 1307 | 6663bbd049205d38a496ccacb412a151980b444627d38de218b3b809aef330f1 | (licence text) |
| vendor/mammoth-1.8.0/mammoth.browser.min.js | 642194 | deb07bf230d1cb3e190bc5adc6743f35c6531b6571d1e5469b24f452a7f0f4ab | DOCX (import worker) |
| vendor/pdfjs-3.11.174/LICENSE | 10174 | 0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594 | (licence text) |
| vendor/pdfjs-3.11.174/pdf.min.js | 320004 | 5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946 | PDF (page) + OCR page rendering |
| vendor/pdfjs-3.11.174/pdf.worker.min.js | 1087212 | feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b | PDF (pdf.js own worker) |
| vendor/sheetjs-0.20.3/LICENSE | 11355 | 4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64 | (licence text) |
| vendor/sheetjs-0.20.3/xlsx.full.min.js | 951904 | cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41 | XLSX / XLS (import worker) |
| vendor/tesseract-5.1.1/LICENSE.md | 11357 | b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1 | (licence text) |
| vendor/tesseract-5.1.1/core/LICENSE | 11358 | c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08 | (licence text) |
| vendor/tesseract-5.1.1/core/tesseract-core-lstm.js | 124391 | fc54a973687325599214294ec90ea9665309cbdf6ca727c43a64651f24e923f7 | not used (see notes) |
| vendor/tesseract-5.1.1/core/tesseract-core-lstm.wasm | 2859424 | 5db58ea4d1bd4256be81e8ae3b4fa226c4625dfba1850b1b3308dbf3700e9929 | not used (see notes) |
| vendor/tesseract-5.1.1/core/tesseract-core-lstm.wasm.js | 3938277 | 8f04aa0cc81e7bde33f80e92fa01a7a665f0b4884d098acf5de9c7104a11dfaa | OCR core, devices without SIMD |
| vendor/tesseract-5.1.1/core/tesseract-core-simd-lstm.js | 124396 | 4135a3f6f1cccf3bc92058c1273c49bb4cff6356e1ba15d1b8b4e76e9890526b | not used (see notes) |
| vendor/tesseract-5.1.1/core/tesseract-core-simd-lstm.wasm | 2859709 | 66b601224a0c4a8977bc9d92dd39841189f9ca22cc4122fcd7208cdb0961eeef | not used (see notes) |
| vendor/tesseract-5.1.1/core/tesseract-core-simd-lstm.wasm.js | 3938657 | ce20eda9533cbed1e6c2b4276fbae1e0adc61b6754b5513084be601787b457cf | OCR core, devices with SIMD |
| vendor/tesseract-5.1.1/core/tesseract-core-simd.js | 124079 | 74f0f7bacae500794c9e61a54956f23c3b271bf15a9847776d98f93164ba9400 | not used (see notes) |
| vendor/tesseract-5.1.1/core/tesseract-core-simd.wasm | 3457317 | baa2f54ef5af43ada4605fd7ae999bde3c6ecc96bfe0d0410b0b4f4a5f9c8b91 | not used (see notes) |
| vendor/tesseract-5.1.1/core/tesseract-core-simd.wasm.js | 4735153 | 63f232c4f7a97b04e52eb940202700b2c6239783a75d0ff0553274fac530cd5c | not used (see notes) |
| vendor/tesseract-5.1.1/core/tesseract-core.js | 124074 | c8ff737be3e8e12f6426773f13186965ea4455977ab12a759f051da7c6493100 | not used (see notes) |
| vendor/tesseract-5.1.1/core/tesseract-core.wasm | 3457035 | b47a852b19181ae0999f9d970c368cd351135a320ea978b35bd38602d8bcc0bc | not used (see notes) |
| vendor/tesseract-5.1.1/core/tesseract-core.wasm.js | 4734777 | 2b8c8c92b8788807061fb4bb16c5acdf000c149e100255f879f78d2c58ca9969 | not used (see notes) |
| vendor/tesseract-5.1.1/lang/eng.traineddata | 4113088 | 7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2 | not used (see notes) |
| vendor/tesseract-5.1.1/lang/eng.traineddata.gz | 1976309 | 2a692e1244b5873d821e07568c31fb572f4ef6071f03a0aa09bea146bf8f0551 | OCR English language data (the app uses the compressed file) |
| vendor/tesseract-5.1.1/tesseract.min.js | 66695 | a8e29918d098b2b06e1012bdaeffb4aec0445c5d5654709023e0bd1f442a80e8 | OCR (page) |
| vendor/tesseract-5.1.1/worker.min.js | 123724 | aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc | OCR worker |
| vendor/tesseract-5.1.1/lang/LICENSE-eng.traineddata | 11357 | c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4 | licence text for eng.traineddata, added by the owner on 2026-11-24 |
