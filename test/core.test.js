import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectBOM,
  extractDeclaredCharset,
  normalizeCharset,
  detectByHeuristic,
  detectCharset,
} from '../src/core.js';

function ascii(s) {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// UTF-8 BOM + ASCII body
function utf8(s) {
  const u8 = new TextEncoder().encode(s);
  const out = new Uint8Array(u8.length + 3);
  out[0] = 0xef; out[1] = 0xbb; out[2] = 0xbf;
  out.set(u8, 3);
  return out;
}

function utf16le(s) {
  const u16 = new Uint16Array(s.length);
  for (let i = 0; i < s.length; i++) u16[i] = s.charCodeAt(i);
  const out = new Uint8Array(u16.byteLength + 2);
  out[0] = 0xff; out[1] = 0xfe;
  new Uint8Array(u16.buffer).forEach((b, i) => { out[i + 2] = b; });
  return out;
}

function utf16be(s) {
  const u16 = new Uint16Array(s.length);
  for (let i = 0; i < s.length; i++) u16[i] = s.charCodeAt(i);
  const bytes = new Uint8Array(u16.buffer);
  const out = new Uint8Array(bytes.length + 2);
  out[0] = 0xfe; out[1] = 0xff;
  for (let i = 0; i < bytes.length; i += 2) {
    out[i + 2] = bytes[i + 1];
    out[i + 3] = bytes[i];
  }
  return out;
}

test('detectBOM recognises UTF-8 BOM', () => {
  assert.equal(detectBOM(utf8('hello')), 'utf-8');
});

test('detectBOM recognises UTF-16LE BOM', () => {
  assert.equal(detectBOM(utf16le('hi')), 'utf-16le');
});

test('detectBOM recognises UTF-16BE BOM', () => {
  assert.equal(detectBOM(utf16be('hi')), 'utf-16be');
});

test('detectBOM returns null without a BOM', () => {
  assert.equal(detectBOM(ascii('plain text')), null);
});

test('detectBOM distinguishes UTF-32LE from UTF-16LE', () => {
  const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00]);
  assert.equal(detectBOM(bytes), 'utf-32le');
});

test('detectBOM rejects non-Uint8Array input', () => {
  assert.throws(() => detectBOM([]), TypeError);
});

test('extractDeclaredCharset finds HTML5 <meta charset>', () => {
  const html = ascii('<html><head><meta charset="Shift-JIS"><title>x</title>');
  assert.equal(extractDeclaredCharset(html), 'shift-jis');
});

test('extractDeclaredCharset unquotes the value', () => {
  const html = ascii("<meta charset='utf-8'>");
  assert.equal(extractDeclaredCharset(html), 'utf-8');
});

test('extractDeclaredCharset finds HTML4 http-equiv content-type', () => {
  const html = ascii('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">');
  assert.equal(extractDeclaredCharset(html), 'iso-8859-1');
});

test('extractDeclaredCharset finds XML encoding declaration', () => {
  const xml = ascii('<?xml version="1.0" encoding="UTF-8"?><root/>');
  assert.equal(extractDeclaredCharset(xml), 'utf-8');
});

test('extractDeclaredCharset ignores charset mentioned in body text', () => {
  // The body mentions charset= but there is no real declaration in the head.
  const html = ascii('<html><body>see charset=utf-8 here</body></html>');
  assert.equal(extractDeclaredCharset(html), null);
});

test('normalizeCharset collapses common aliases', () => {
  assert.equal(normalizeCharset('UTF8'), 'utf-8');
  assert.equal(normalizeCharset('Shift_JIS'), 'shift-jis');
  assert.equal(normalizeCharset('cp1252'), 'windows-1252');
  assert.equal(normalizeCharset('latin1'), 'iso-8859-1');
});

test('normalizeCharset passes through unknown names lowercased', () => {
  assert.equal(normalizeCharset('X-FOO'), 'x-foo');
});

test('detectByHeuristic identifies UTF-8 text with multibyte chars', () => {
  // "héllo wörld" contains real two-byte UTF-8 sequences
  const bytes = new TextEncoder().encode('héllo wörld — café');
  assert.equal(detectByHeuristic(bytes), 'utf-8');
});

test('detectByHeuristic identifies pure ASCII as UTF-8', () => {
  assert.equal(detectByHeuristic(ascii('just plain ascii text')), 'utf-8');
});

test('detectByHeuristic identifies UTF-16LE without BOM', () => {
  const bytes = utf16le('hello world');
  // strip the BOM to test the heuristic
  const noBom = bytes.slice(2);
  assert.equal(detectByHeuristic(noBom), 'utf-16le');
});

test('detectByHeuristic identifies UTF-16BE without BOM', () => {
  const bytes = utf16be('hello world');
  const noBom = bytes.slice(2);
  assert.equal(detectByHeuristic(noBom), 'utf-16be');
});

test('detectByHeuristic rejects odd-length buffers for UTF-16', () => {
  // 5 bytes can't be UTF-16 — should not match either LE or BE
  const bytes = new Uint8Array([0x68, 0x00, 0x65, 0x00, 0x6c]);
  assert.equal(detectByHeuristic(bytes), 'utf-8'); // pure-ascii-looking → utf-8
});

test('detectByHeuristic returns null for empty input', () => {
  assert.equal(detectByHeuristic(new Uint8Array(0)), null);
});

test('detectByHeuristic returns null for high-noise bytes', () => {
  // Random-ish high bytes with no consistent structure
  const bytes = new Uint8Array([0x80, 0x81, 0xc2, 0xff, 0xa0, 0xa1, 0xfe, 0x7f, 0x80, 0x9f]);
  assert.equal(detectByHeuristic(bytes), null);
});

test('detectCharset prefers BOM over a contradicting declared charset', () => {
  // Declare Shift-JIS but actually be UTF-8 with BOM
  const html = ascii('<meta charset="Shift-JIS">');
  const body = new TextEncoder().encode('héllo');
  const combined = new Uint8Array(3 + html.length + body.length);
  combined[0] = 0xef; combined[1] = 0xbb; combined[2] = 0xbf;
  combined.set(html, 3);
  combined.set(body, 3 + html.length);
  const r = detectCharset(combined);
  assert.equal(r.charset, 'utf-8');
  assert.equal(r.source, 'bom');
});

test('detectCharset trusts a plausible declared charset', () => {
  const html = ascii('<meta charset="iso-8859-1">café résumé');
  const r = detectCharset(html);
  assert.equal(r.charset, 'iso-8859-1');
  assert.equal(r.source, 'declared');
  assert.equal(r.declared, 'iso-8859-1');
});

test('detectCharset falls back to heuristic when declared is implausible', () => {
  // Declare ISO-8859-1 but include bytes that look like valid UTF-8 multibyte
  const declared = ascii('<meta charset="iso-8859-1">');
  const real = new TextEncoder().encode('héllo wörld');
  const combined = new Uint8Array(declared.length + real.length);
  combined.set(declared, 0);
  combined.set(real, declared.length);
  const r = detectCharset(combined);
  assert.equal(r.source, 'heuristic');
  assert.equal(r.charset, 'utf-8');
});

test('detectCharset returns null when nothing fits', () => {
  const bytes = new Uint8Array([0x80, 0x81, 0xc2, 0xff, 0xa0, 0xa1, 0xfe, 0x7f, 0x80, 0x9f]);
  const r = detectCharset(bytes);
  assert.equal(r.charset, null);
  assert.equal(r.source, 'none');
});

test('detectCharset rejects non-Uint8Array input', () => {
  assert.throws(() => detectCharset('not bytes'), TypeError);
});
