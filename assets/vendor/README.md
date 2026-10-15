# Vendored libraries

- `exceljs.bare.min.js` - ExcelJS 4.4.0 (MIT), the "bare" browser build.
  Used by the report page to create the Excel (.xlsx) file in the browser. It is served from this
  site so the export does not depend on any external website.
  The trailing source-map comment was removed so the browser never looks for the `.map` file.
  License: `exceljs.bare.min.js.LICENSE.txt` (ExcelJS bundles JSZip, pako and others, whose
  notices are kept inside the file).
