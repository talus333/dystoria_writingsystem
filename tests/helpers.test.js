/* Unit tests for small pure helpers in index.html — extracted and run with no DOM, no deps.
 *   run:  node tests/helpers.test.js
 * These guard formatting/identity helpers that several features lean on.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

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
const charColorsLine = (script.match(/const CHAR_COLORS = \[[^\]]*\];/) || [])[0];
if (!charColorsLine) throw new Error('CHAR_COLORS palette not found');

const built = [
  extractFn(script, 'hashStr'),
  charColorsLine,
  extractFn(script, 'charColor'),
  extractFn(script, 'elDisplayName')
].join('\n');
const F = new Function(built + '; return { hashStr, CHAR_COLORS, charColor, elDisplayName };')();

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ', exp ' + JSON.stringify(b) + ')'); }

// hashStr: deterministic, non-negative
ok(F.hashStr('Eloise') === F.hashStr('Eloise'), 'hashStr is deterministic');
ok(F.hashStr('Eloise') !== F.hashStr('Caleb'), 'hashStr differs for different names');
ok(F.hashStr('') >= 0 && Number.isFinite(F.hashStr('x')), 'hashStr is a finite non-negative number');

// charColor: stable, always a palette colour
ok(F.charColor('Eloise') === F.charColor('Eloise'), 'charColor stable for a name');
ok(F.CHAR_COLORS.indexOf(F.charColor('Eloise')) >= 0, 'charColor returns a palette colour');
ok(F.CHAR_COLORS.indexOf(F.charColor('')) >= 0, 'charColor handles empty name');
ok(F.CHAR_COLORS.indexOf(F.charColor(null)) >= 0, 'charColor handles null name');

// elDisplayName: "Name, the Word" / "Word" / ''
eq(F.elDisplayName({ name: 'Eloise', word: 'Follower' }), 'Eloise, the Follower', 'named element renders "Name, the Word"');
eq(F.elDisplayName({ word: 'Follower' }), 'Follower', 'unnamed element renders just the word');
eq(F.elDisplayName(null), '', 'null element renders empty string');

console.log('\nhelpers: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
