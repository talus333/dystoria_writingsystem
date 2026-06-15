/* Tests for the canonical section/frame logic in index.html.
 * Extracts the REAL editorNodeFrames / nodeFrameMap / sectionTextsLC from the file and runs
 * them against constructed editor layouts with a minimal DOM mock — no browser, no deps.
 *   run:  node tests/sections.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = (html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';

// pull a function's source out of the script by brace-matching (these fns contain no { in strings)
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let depth = 0, started = false;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    const c = src[j];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}
const fnSrc = ['editorNodeFrames', 'nodeFrameMap', 'sectionTextsLC'].map(n => extractFn(script, n)).join('\n');

// minimal DOM mock — only the bits these functions touch
function el(tag, opts) {
  opts = opts || {};
  const classes = (opts.cls || '').split(/\s+/).filter(Boolean);
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    dataset: (opts.frame != null) ? { frame: String(opts.frame) } : {},
    classList: { contains: c => classes.indexOf(c) >= 0 },
    textContent: opts.text || ''
  };
}
function txt(s) { return { nodeType: 3, textContent: s }; }
function editor(nodes) { return { childNodes: nodes, children: nodes.filter(n => n.nodeType === 1) }; }
const secmark = () => el('div', { cls: 'sec-mark', text: '2' });

let ED = null;
const $ = id => (id === 'editor' ? ED : null);
const F = new Function('$', fnSrc + '; return { editorNodeFrames, nodeFrameMap, sectionTextsLC };')($);

let pass = 0, fail = 0;
function eq(a, b, msg) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { pass++; }
  else { fail++; console.log('  ✗ ' + msg + '\n      got: ' + JSON.stringify(a) + '\n      exp: ' + JSON.stringify(b)); }
}
const frames = () => F.editorNodeFrames().map(x => x.frame);
const texts = () => { const o = F.sectionTextsLC(); const out = {}; Object.keys(o).forEach(k => out[k] = o[k].replace(/\s+/g, ' ').trim()); return out; };

// 1) single frame
ED = editor([el('div', { text: 'Hello' }), el('div', { text: 'World' })]);
eq(frames(), [0, 0], 'single frame: all nodes are frame 0');
eq(texts(), { 0: 'hello world' }, 'single frame: text lowercased & joined');

// 2) two frames with a divider (sec-mark belongs to the following h3's frame)
ED = editor([
  el('div', { text: 'Intro line' }),
  secmark(),
  el('h3', { frame: 1, text: 'Chapter Two' }),
  el('div', { text: 'Second section' })
]);
eq(frames(), [0, 1, 1, 1], 'two frames: sec-mark joins its h3 frame');
eq(texts(), { 0: 'intro line', 1: 'second section' }, 'two frames: dividers + titles excluded from prose');

// 3) non-contiguous data-frame value is read literally
ED = editor([el('div', { text: 'a' }), secmark(), el('h3', { frame: 2, text: 'T' }), el('div', { text: 'b' })]);
eq(frames(), [0, 2, 2, 2], 'data-frame read literally (frame 2)');
eq(texts(), { 0: 'a', 2: 'b' }, 'text keyed by literal frame');

// 4) a bare text node at the top level still counts toward the current frame
ED = editor([txt('loose '), el('div', { text: 'x' })]);
eq(texts(), { 0: 'loose x' }, 'top-level text node counted');

// 5) sec-mark with no following h3 stays in the current frame
ED = editor([el('div', { text: 'a' }), secmark()]);
eq(frames(), [0, 0], 'dangling sec-mark stays in current frame');

// 6) nodeFrameMap agrees with editorNodeFrames for element nodes
ED = editor([el('div', { text: 'a' }), secmark(), el('h3', { frame: 1, text: 'T' }), el('div', { text: 'b' })]);
(() => {
  const m = F.nodeFrameMap();
  const viaMap = ED.children.map(c => m.get(c));
  const viaList = F.editorNodeFrames().filter(x => x.node.nodeType === 1).map(x => x.frame);
  eq(viaMap, viaList, 'nodeFrameMap matches editorNodeFrames for elements');
})();

console.log('\nsections: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
