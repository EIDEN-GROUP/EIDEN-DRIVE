# 05 — Universal file reader + file-type icons

Goal: **every file can be read inside the app**, with no "download to view" dead end — and file icons that tell you
what a file is at a glance.

## 1. What opens, and how (`components/viewer/*`, shell: `components/drive/FileViewer.tsx`)
| Type | Extensions | Reader |
|---|---|---|
| Images | png jpg gif webp avif bmp ico svg heic heif tiff | zoom (wheel/buttons), drag-to-pan, rotate, fit, pixel size; **HEIC/TIFF decoded in the browser** when the browser can't; SVG shown as an image (scripts never run) + *Source* toggle |
| PDF | pdf | **PDF.js**: pages rendered lazily, page jump, zoom, **Text tab** (select/copy/search per page), password prompt, falls back to the browser's PDF frame if the worker can't load |
| Word | docx docm dotx | converted to semantic HTML (headings, lists, tables, images, links) |
| Spreadsheets | xlsx xlsm xlsb **xls** ods numbers | every sheet as a tab, formatted values, filter, row/column headers (SheetJS 0.20.3 — the patched official build) |
| Presentations | pptx ppsx potx | every slide's text in reading order + speaker notes + pictures |
| OpenDocument | odt odp ott otp | headings, paragraphs, lists, tables as text |
| Ebooks | epub | chapter reader (spine order), inline pictures |
| Tables | csv tsv | real table: delimiter auto-detected (`, ; tab \|`), quotes/CRLF/multiline cells, sticky header, sort, filter, encoding fallback |
| JSON | json geojson har … | collapsible tree + formatted text; invalid JSON falls back to text with the error |
| Notebooks | ipynb | markdown cells, highlighted code, outputs (text, tables, plots, errors) |
| Markdown | md markdown mdx | GitHub-flavoured (tables, task lists, fenced code) via `marked` + sanitiser |
| HTML | html htm | sandboxed preview (scripts blocked) + Source tab |
| Text / code | 100+ extensions incl. logs, srt/vtt, ics, eml, configs, source | line numbers, find with count, wrap, copy; huge files show the first 5 MB with a notice |
| RTF | rtf | plain-text conversion |
| Archives | zip jar apk cbz whl … **tar tgz tar.gz gz** | browsable tree with sizes + search (nothing is extracted); a `.gz` that wraps text opens as text |
| Fonts | ttf otf woff woff2 | specimen at several sizes + editable sample (FontFace API) |
| Video / audio | mp4 webm mov… / mp3 wav flac… | native players; the existing fallback chain (Drive transcoding, in-browser conversion) is unchanged |
| Legacy Office / anything else | doc ppt msg pub …, unknown binaries | **readable-text extraction** (ASCII + UTF-16, so old `.doc` content is legible) + hex dump + format detection |

**Unknown or mislabelled files** are identified from their *own bytes* (magic numbers): a PDF with no extension opens as a PDF, a text file with no extension opens as text, a ZIP-based file opens as an archive.

## 2. Safety (untrusted files are data, never code)
* All HTML produced from documents goes through **DOMPurify** with scripts/styles/forms/frames/handlers removed, `javascript:` links dropped, and **only embedded pictures allowed** (remote images are removed — opening a file can't phone home).
* HTML files render in a `sandbox=""` iframe; SVG is shown through `<img>`.
* Server (`/api/drive/download?raw=1`): every response is `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`; **HTML/SVG/XML/JS are forced to download and get `Content-Security-Policy: sandbox`** if someone opens the URL directly (the uploader-declared MIME type is not trusted).
* The earlier Markdown link-injection hole (`"` not escaped) is fixed in both the old renderer and the new one; regression tests cover it.
* Limits are stated, never silent: bytes over 25 MB come through the signed URL up to 80 MB; beyond that the viewer says so and offers Download.

## 3. File-type icons (`components/ui/Glyphs.tsx`)
* **Files** are paper pages with a folded corner and a coloured **type label** (PNG, PDF, DOCX, XLSX, ZIP…), a distinct accent per family (images sky-blue, video violet, audio pink, PDF red, Word blue, sheets green, slides orange, archives amber, code teal, fonts purple, ebooks brown) and a small drawn symbol (picture, play, note, grid, chart, zipper, `</>`, `{ }`, `Aa`, book).
* **Folders** are a two-tone folder with a lit front flap (follows the theme colour).
* Sizes < 44 px drop the letters and keep the accent bar so list rows stay crisp; grid tiles (64 px) and the details panel (132 px) show full labels.
* The Explorer's **Kind** column now names real types ("PDF document", "Spreadsheet", "Archive", "JSON data"…).

## 4. Setup notes
* New dependencies: `jszip mammoth dompurify marked pdfjs-dist@3.11.174 heic2any utif xlsx@0.20.3 (sheetjs.com tarball)`; dev: `jsdom`.
* `postinstall` copies the PDF.js worker to `public/pdfjs/` (git-ignored; regenerated on every install/deploy). `next.config.mjs` aliases Node's `canvas` away for the browser bundle.
* Readers are lazy chunks — opening the Drive page costs nothing extra.

## 5. Tests / verification
`npm test` **72/72** (new: file-type mapping, text decoding, CSV, RTF, magic-number sniffing, TAR, string extraction, sanitiser security, Markdown injection regression). `tsc` clean, `npm run build` passes. Every reader was exercised in a headless browser with generated sample files (docx, xlsx, xls, pptx, pdf, png, csv, json, md, rtf, ipynb, zip, tar.gz, epub, ttf, legacy-OLE .doc, random binary, extension-less text).

## 6. Not supported (honest list)
7z / rar / bz2 / xz listing; 3D models (glb/stl/obj); PSD/AI/RAW camera files; encrypted Office files; Office **page layout** (Word/PowerPoint are text-and-picture views — "Download" gives the original); `.numbers`/`.pages`/`.key` beyond best-effort text. These open in the **hex/readable-text** fallback instead of failing.
