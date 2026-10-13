# Vendored libraries

- `html2pdf.bundle.min.js` — html2pdf.js 0.10.1 (MIT), bundled with html2canvas and jsPDF.
  Used by the report page to create the PDF in the browser. It is served from this
  site so the PDF export does not depend on any external website.
  The trailing source-map comment was removed so the browser never looks for the `.map` file.
  Licenses of the bundled libraries: `html2pdf.bundle.min.js.LICENSE.txt`.
