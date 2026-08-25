#!/usr/bin/env node
/* Splice the PWA head snippet + PWA layer into a copy of index.html.
   Usage: node apply_pwa.js <in index.html> <out index.html>
   Idempotent: refuses to double-apply. Follows the repo convention of appending
   layers before the FINAL </body></html> (lastIndexOf, not the first match). */
const fs = require('fs');
const path = require('path');
const [,, inFile, outFile] = process.argv;
if (!inFile || !outFile) { console.error('usage: node apply_pwa.js <in> <out>'); process.exit(2); }

let html = fs.readFileSync(inFile, 'utf8');
if (html.includes('id="dyst-pwa-js"') || html.includes('rel="manifest"')) { console.error('already applied'); process.exit(1); }

const head = fs.readFileSync(path.join(__dirname, 'pwa_head_snippet.html'), 'utf8');
const layer = fs.readFileSync(path.join(__dirname, 'pwa_layer.html'), 'utf8');

// 1. head: right after <title>Dystoria</title> (exactly one occurrence expected)
const titleTag = '<title>Dystoria</title>';
const nTitle = html.split(titleTag).length - 1;
if (nTitle !== 1) { console.error('expected exactly one <title>Dystoria</title>, found ' + nTitle); process.exit(1); }
html = html.replace(titleTag, titleTag + '\n' + head.trim());

// 2. layer: before the FINAL </body></html>
const tail = '</body></html>';
const at = html.lastIndexOf(tail);
if (at < 0) { console.error('no closing </body></html>'); process.exit(1); }
if (layer.includes('</script' + '>') && /<\/script(?!>)/.test(layer)) { console.error('layer contains a stray </script literal'); process.exit(1); }
html = html.slice(0, at) + '\n' + layer.trim() + '\n' + html.slice(at);

fs.writeFileSync(outFile, html);
console.log('wrote', outFile, (fs.statSync(outFile).size / 1048576).toFixed(2) + ' MB');
