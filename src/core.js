/**
 * Byte-order-mark and declared-charset detection plus a lightweight
 * statistical heuristic for distinguishing the common 8-bit legacy
 * encodings that still appear in real-world text. No third-party code.
 *
 * The heuristic is deliberately conservative: it never claims an
 * encoding unless the byte distribution makes that claim credible.
 * When nothing fits, it returns `null` and lets the caller decide
 * (usually defaulting to UTF-8 or the declared charset).
 */

/**
 * Check a byte sequence for a Byte Order Mark.
 *
 * The BOM is the strongest single signal: it is unambiguous and was
 * placed there for exactly this purpose. We check it first, before any
 * weaker heuristic, and before a declared charset — because a declared
 * charset is often wrong in practice (HTML pages that claim Shift-JIS
 * but are actually UTF-8 with a BOM are common enough to matter).
 *
 * Returns a canonical encoding label (IANA-style, lowercase) or `null`
 * if no recognised BOM is present. We return `null` rather than a
 * fallback so the caller can distinguish "no signal" from "default".
 *
 * @param {Uint8Array} bytes
 * @returns {string|null}
 */
export function detectBOM(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('detectBOM expects a Uint8Array');
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    if (bytes.length >= 4 && bytes[2] === 0x00 && bytes[3] === 0x00) {
      return 'utf-32le';
    }
    return 'utf-16le';
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    if (bytes.length >= 4 && bytes[2] === 0x00 && bytes[3] === 0x00) {
      return 'utf-32be';
    }
    return 'utf-16be';
  }
  return null;
}

/**
 * Strip an ASCII case-insensitive attribute value of surrounding
 * whitespace and quotes, matching the way HTML parsers extract
 * charset declarations. Quotes are common in practice and must be
 * trimmed, or a `charset="utf-8"` attribute will never match.
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizeAttributeValue(raw) {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length >= 2) {
    const first = trimmed.charCodeAt(0);
    const last = trimmed.charCodeAt(trimmed.length - 1);
    if ((first === 0x22 || first === 0x27) && first === last) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * Extract a charset declaration from the first few KB of an HTML/XML
 * document. We scan only the preamble because the charset is always
 * near the top by spec, and scanning the whole document risks picking
 * up a charset mentioned in body text.
 *
 * Two patterns:
 *  - `<meta charset="...">` (HTML5)
 *  - `<meta http-equiv="content-type" content="text/html; charset=...">` (HTML4)
 *  - `<?xml ... encoding="..."?>` (XML declaration)
 *
 * Case-insensitive on tag and attribute names; the value is returned
 * as-written (only whitespace/quote-normalised) so the caller can map
 * it through an alias table if needed.
 *
 * Returns the raw attribute value or `null` if not found.
 *
 * @param {Uint8Array} bytes
 * @returns {string|null}
 */
export function extractDeclaredCharset(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('extractDeclaredCharset expects a Uint8Array');
  }
  const limit = Math.min(bytes.length, 4096);
  let ascii = '';
  for (let i = 0; i < limit; i++) {
    const b = bytes[i];
    if (b === 0) break; // NUL — almost certainly binary, not markup
    if (b < 0x80) {
      ascii += String.fromCharCode(b);
    } else {
      ascii += '?';
    }
  }
  const lower = ascii.toLowerCase();
  // XML declaration: <?xml ... encoding="..." ?>
  const xmlIdx = lower.indexOf('<?xml');
  if (xmlIdx !== -1) {
    const end = ascii.indexOf('?>', xmlIdx);
    const decl = end === -1 ? ascii.slice(xmlIdx) : ascii.slice(xmlIdx, end + 2);
    const enc = /encoding\s*=\s*(["'])([^"']*)\1/.exec(decl);
    if (enc) return normalizeAttributeValue(enc[2]);
  }
  // <meta charset="..."> (HTML5)
  const metaCharset = /<meta\s+charset\s*=\s*(["']?)([^"'\s>]*)\1\s*\/?>/i.exec(ascii);
  if (metaCharset && metaCharset[2]) {
    return normalizeAttributeValue(metaCharset[2]);
  }
  // <meta http-equiv content="...; charset=..."> (HTML4)
  const metaHttpRe = /<meta\s+[^>]*http-equiv\s*=\s*["']?content-type["']?[^>]*>/i;
  const m = metaHttpRe.exec(ascii);
  if (m) {
    const contentRe = /content\s*=\s*(["'])([^"']*)\1/i;
    const c = contentRe.exec(m[0]);
    if (c) {
      const cs = /charset\s*=\s*([^"'\s;]+)/i.exec(c[2]);
      if (cs) return normalizeAttributeValue(cs[1]);
    }
  }
  return null;
}

/**
 * Map a few common charset aliases to canonical labels. Only a small
 * set is normalised — enough to collapse the obvious duplicates
 * (e.g. `ascii` → `utf-8`) without pretending to be a full alias table.
 * Anything unrecognised is returned lowercased as-is, so callers can
 * still see what was declared.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeCharset(name) {
  if (typeof name !== 'string') {
    throw new TypeError('normalizeCharset expects a string');
  }
  const n = name.trim().toLowerCase().replace(/_/g, '-');
  switch (n) {
    case '':
    case 'ascii':
    case 'us-ascii':
    case 'latin1':
    case 'iso-8859-1':
    case 'iso8859-1':
      return 'iso-8859-1';
    case 'utf8':
      return 'utf-8';
    case 'utf16':
    case 'utf16le':
      return 'utf-16le';
    case 'utf16be':
      return 'utf-16be';
    case 'shift-jis':
    case 'shift_jis':
    case 'sjis':
      return 'shift-jis';
    case 'euc-jp':
      return 'euc-jp';
    case 'gb2312':
    case 'gbk':
    case 'csgb2312':
      return 'gbk';
    case 'euc-kr':
    case 'ks-c-5601-1987':
      return 'euc-kr';
    case 'windows-1252':
    case 'cp1252':
      return 'windows-1252';
    default:
      return n;
  }
}

/**
 * Classify a buffer of text bytes by statistical shape, ignoring BOM
 * and declared charset. This is the fallback when the strong signals
 * are absent or contradict each other.
 *
 * The detectors below are byte-structural: they don't decode, they
 * look at byte patterns. Each one returns a confidence in [0,1] that
 * represents how strongly the bytes match the structural rules of
 * that encoding. We deliberately do NOT sum probabilities or rank by
 * tiny margins — the rule is: take the first detector that returns a
 * confidence above its threshold, in the order written. This avoids
 * the classic failure mode where two near-tied detectors flip-flop
 * on small changes to the input.
 *
 * UTF-8 is tested first only when the buffer contains at least one
 * high byte — pure ASCII is structurally ambiguous, so UTF-16 is
 * tried first to catch no-BOM UTF-16 text that is mostly ASCII.
 *
 * Returns a canonical label or `null`.
 *
 * @param {Uint8Array} bytes
 * @returns {string|null}
 */
export function detectByHeuristic(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('detectByHeuristic expects a Uint8Array');
  }
  if (bytes.length === 0) return null;

  let hasHigh = false;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] >= 0x80) { hasHigh = true; break; }
  }

  if (hasHigh && looksLikeUtf8(bytes)) return 'utf-8';
  if (looksLikeUtf16le(bytes)) return 'utf-16le';
  if (looksLikeUtf16be(bytes)) return 'utf-16be';
  if (!hasHigh) return 'utf-8';
  if (looksLikeShiftJis(bytes)) return 'shift-jis';
  if (looksLikeEucJp(bytes)) return 'euc-jp';
  if (looksLikeGbk(bytes)) return 'gbk';
  if (looksLikeEucKr(bytes)) return 'euc-kr';
  return null;
}

/**
 * UTF-8 multi-byte sequences have a strict lead/trail structure.
 * We allow a small fraction of invalid bytes for two reasons: (1) real
 * text occasionally contains a few bytes that aren't valid UTF-8
 * (mojibake, smart quotes pasted from elsewhere), and (2) a too-strict
 * check causes UTF-8 to be misdetected as a legacy single-byte encoding.
 * The 1% threshold is empirical — high enough to tolerate minor
 * corruption, low enough to reject a typical ISO-8859-1 sample where
 * roughly half of high bytes are invalid UTF-8 leads.
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function looksLikeUtf8(bytes) {
  let i = 0;
  let invalid = 0;
  let total = 0;
  // Skip a leading BOM so it doesn't bias the count.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    i = 3;
  }
  while (i < bytes.length) {
    const b = bytes[i];
    total++;
    if (b < 0x80) {
      i++;
      continue;
    }
    let needed;
    let minLead;
    if (b >= 0xf0) {
      needed = 3;
      minLead = 0xf0; // to reject 0xf5..0xff as 4-byte leads
    } else if (b >= 0xe0) {
      needed = 2;
      minLead = 0xe0;
    } else if (b >= 0xc2) {
      // 0xc0/0xc1 are never valid UTF-8 leads (they'd encode < 0x80).
      needed = 1;
      minLead = 0xc2;
    } else {
      // 0x80-0x8f, 0xc0, 0xc1, 0xf5-0xff: stray trail byte or illegal lead
      invalid++;
      i++;
      continue;
    }
    if (b < minLead) {
      invalid++;
      i++;
      continue;
    }
    let ok = true;
    for (let j = 1; j <= needed; j++) {
      if (i + j >= bytes.length || (bytes[i + j] & 0xc0) !== 0x80) {
        ok = false;
        break;
      }
    }
    if (!ok) {
      invalid++;
      i++;
      continue;
    }
    i += 1 + needed;
  }
  if (total === 0) return false;
  return invalid / total <= 0.01;
}

/**
 * UTF-16 LE: most odd-position bytes are low (lead bytes of CJK or
 * ASCII characters), most even-position bytes are high or zero.
 * We require a clear majority — not a coin flip — because random
 * bytes can match by accident roughly half the time.
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function looksLikeUtf16le(bytes) {
  if (bytes.length < 4 || bytes.length % 2 !== 0) return false;
  const pairs = bytes.length / 2;
  let goodLead = 0;
  let zeroHigh = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    const hi = bytes[i + 1];
    const lo = bytes[i];
    if (hi === 0 && lo < 0x80) {
      zeroHigh++;
      goodLead++;
    } else if (hi >= 0xd8 && hi <= 0xdf) {
      // surrogate pair half — fine for the heuristic
      goodLead++;
    } else if (hi >= 0x20 && hi < 0xff) {
      goodLead++;
    }
  }
  return goodLead / pairs >= 0.9 && zeroHigh / pairs >= 0.05;
}

/**
 * UTF-16 BE: mirror of LE.
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function looksLikeUtf16be(bytes) {
  if (bytes.length < 4 || bytes.length % 2 !== 0) return false;
  const pairs = bytes.length / 2;
  let goodLead = 0;
  let zeroLow = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    const hi = bytes[i];
    const lo = bytes[i + 1];
    if (hi === 0 && lo < 0x80) {
      zeroLow++;
      goodLead++;
    } else if (hi >= 0xd8 && hi <= 0xdf) {
      goodLead++;
    } else if (hi >= 0x20 && hi < 0xff) {
      goodLead++;
    }
  }
  return goodLead / pairs >= 0.9 && zeroLow / pairs >= 0.05;
}

/**
 * Shift-JIS structure:
 *  - ASCII range 0x00-0x7f as-is
 *  - Half-width katakana 0xa1-0xdf (single byte)
 *  - Lead bytes 0x81-0x9f or 0xe0-0xef, followed by trail 0x40-0x7e or 0x80-0xfc
 *  - 0xa0 is never a valid byte in Shift-JIS
 *
 * The 0xa0-never rule is what distinguishes Shift-JIS from EUC-JP and
 * GBK on similar-looking CJK input.
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function looksLikeShiftJis(bytes) {
  let leads = 0;
  let badTrail = 0;
  let sawA0 = 0;
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0xa0) sawA0++;
    if (b <= 0x7f) { i++; continue; }
    if (b >= 0xa1 && b <= 0xdf) { i++; continue; }
    if ((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xef)) {
      leads++;
      if (i + 1 >= bytes.length) { badTrail++; i++; continue; }
      const t = bytes[i + 1];
      if (!((t >= 0x40 && t <= 0x7e) || (t >= 0x80 && t <= 0xfc))) {
        badTrail++;
      }
      i += 2;
      continue;
    }
    // Any other high byte is invalid in Shift-JIS
    badTrail++;
    i++;
  }
  if (leads === 0) return false;
  if (sawA0 > 0) return false;
  return badTrail === 0 || badTrail / leads < 0.02;
}

/**
 * EUC-JP structure:
 *  - 0x00-0x7f ASCII
 *  - 0x8e followed by 0xa1-0xdf (half-width katakana, two bytes)
 *  - 0x8f followed by 0xa1-0xfe 0xa1-0xfe (three bytes)
 *  - 0xa1-0xfe followed by 0xa1-0xfe (two bytes)
 *  - 0xa0 and 0xff never appear
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function looksLikeEucJp(bytes) {
  let i = 0;
  let twobyte = 0;
  let bad = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b <= 0x7f) { i++; continue; }
    if (b === 0x8e) {
      if (i + 1 >= bytes.length) { bad++; i++; continue; }
      const t = bytes[i + 1];
      if (t >= 0xa1 && t <= 0xdf) { i += 2; continue; }
      bad++; i += 2; continue;
    }
    if (b === 0x8f) {
      if (i + 2 >= bytes.length) { bad++; i++; continue; }
      const t1 = bytes[i + 1];
      const t2 = bytes[i + 2];
      if (t1 >= 0xa1 && t1 <= 0xfe && t2 >= 0xa1 && t2 <= 0xfe) { i += 3; continue; }
      bad++; i += 3; continue;
    }
    if (b >= 0xa1 && b <= 0xfe) {
      twobyte++;
      if (i + 1 >= bytes.length) { bad++; i++; continue; }
      const t = bytes[i + 1];
      if (t >= 0xa1 && t <= 0xfe) { i += 2; continue; }
      bad++; i += 2; continue;
    }
    bad++;
    i++;
  }
  if (twobyte === 0) return false;
  return bad === 0 || bad / twobyte < 0.02;
}

/**
 * GBK structure (a superset of GB2312):
 *  - 0x00-0x7f ASCII
 *  - Lead 0x81-0xfe, trail 0x40-0x7e or 0x80-0xfe
 *  - 0x7f, 0x80, 0xff never appear
 *
 * The crucial difference from Shift-JIS is that GBK allows trail bytes
 * in 0x80-0xfe while Shift-JIS forbids 0x7f as a trail and forbids
 * lead bytes 0xa1-0xdf as standalone half-width kana. In practice
 * the distinguishing test is "does 0x80 appear?" — it never does in
 * GBK-encoded text but is a valid (rare) trail in Shift-JIS.
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function looksLikeGbk(bytes) {
  let leads = 0;
  let bad = 0;
  let saw80 = 0;
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0x80) saw80++;
    if (b <= 0x7f) { i++; continue; }
    if (b >= 0x81 && b <= 0xfe) {
      leads++;
      if (i + 1 >= bytes.length) { bad++; i++; continue; }
      const t = bytes[i + 1];
      if ((t >= 0x40 && t <= 0x7e) || (t >= 0x80 && t <= 0xfe)) { i += 2; continue; }
      bad++; i += 2; continue;
    }
    bad++;
    i++;
  }
  if (leads === 0) return false;
  if (saw80 > 0) return false;
  return bad === 0 || bad / leads < 0.02;
}

/**
 * EUC-KR structure:
 *  - 0x00-0x7f ASCII
 *  - Lead 0xa1-0xfe, trail 0xa1-0xfe (both bytes in the high half)
 *  - 0x80, 0xff, 0xa0 never appear
 *
 * Distinct from EUC-JP because EUC-JP uses 0x8e and 0x8f as lead bytes;
 * EUC-KR does not.
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function looksLikeEucKr(bytes) {
  let pairs = 0;
  let bad = 0;
  let saw8e = 0;
  let saw8f = 0;
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0x8e) saw8e++;
    if (b === 0x8f) saw8f++;
    if (b <= 0x7f) { i++; continue; }
    if (b >= 0xa1 && b <= 0xfe) {
      pairs++;
      if (i + 1 >= bytes.length) { bad++; i++; continue; }
      const t = bytes[i + 1];
      if (t >= 0xa1 && t <= 0xfe) { i += 2; continue; }
      bad++; i += 2; continue;
    }
    bad++;
    i++;
  }
  if (pairs === 0) return false;
  if (saw8e > 0 || saw8f > 0) return false;
  return bad === 0 || bad / pairs < 0.02;
}

/**
 * Top-level detector. Tries the strong signals in order of reliability,
 * then falls back to the statistical heuristic. Returns a result
 * object so the caller can see *why* a detection was made — useful
 * when debugging misclassifications.
 *
 * Resolution order:
 *  1. BOM — strongest, beats everything.
 *  2. Declared charset — but only if the bytes look plausibly like
 *     that charset. A declared charset that the bytes contradict is
 *     ignored. This is the single most common failure mode in charset
 *     detection; respecting it here avoids the worst misclassifications.
 *     For single-byte encodings (ISO-8859-1, Windows-1252) the
 *     declaration is trusted unless it is contradicted by a stronger
 *     structural signal — i.e. the bytes match a different encoding
 *     with high confidence.
 *  3. Statistical heuristic.
 *  4. `null` — caller should apply its own default.
 *
 * @param {Uint8Array} bytes
 * @returns {{charset: string|null, source: 'bom'|'declared'|'heuristic'|'none', declared?: string}}
 */
export function detectCharset(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('detectCharset expects a Uint8Array');
  }
  const bom = detectBOM(bytes);
  if (bom) {
    return { charset: bom, source: 'bom' };
  }
  const declared = extractDeclaredCharset(bytes);
  if (declared) {
    const norm = normalizeCharset(declared);
    if (declaredLooksPlausible(bytes, norm)) {
      // A declared single-byte encoding is only trusted when no
      // stronger structural detector claims the bytes — otherwise
      // the structural signal is more reliable than the label.
      if (norm === 'iso-8859-1' || norm === 'windows-1252') {
        const heuristic = detectByHeuristic(bytes);
        if (heuristic) {
          return { charset: heuristic, source: 'heuristic' };
        }
      }
      return { charset: norm, source: 'declared', declared };
    }
  }
  const heuristic = detectByHeuristic(bytes);
  if (heuristic) {
    return { charset: heuristic, source: 'heuristic' };
  }
  return { charset: null, source: 'none' };
}

/**
 * Decide whether the bytes look plausible for a declared charset.
 *
 * For UTF-8 we re-use the structural UTF-8 check. For the legacy
 * CJK encodings we re-use their detectors. For ISO-8859-1 and
 * Windows-1252 we accept any byte distribution — there's no good
 * structural test for a single-byte encoding, so a declared
 * ISO-8859-1 is trusted unless a stronger signal overrides it
 * (and a stronger signal would have produced a BOM result already).
 *
 * The point of this gate is not to second-guess every declaration,
 * only to catch the cases where the declaration is obviously wrong —
 * for example, an HTML page that declares ISO-8859-1 but is actually
 * Shift-JIS, which would otherwise produce garbage when decoded.
 *
 * @param {Uint8Array} bytes
 * @param {string} charset
 * @returns {boolean}
 */
function declaredLooksPlausible(bytes, charset) {
  switch (charset) {
    case 'utf-8':
      // Empty or all-ASCII is trivially valid UTF-8.
      if (bytes.length === 0) return true;
      return looksLikeUtf8(bytes);
    case 'utf-16le':
      return looksLikeUtf16le(bytes);
    case 'utf-16be':
      return looksLikeUtf16be(bytes);
    case 'shift-jis':
      return looksLikeShiftJis(bytes);
    case 'euc-jp':
      return looksLikeEucJp(bytes);
    case 'gbk':
      return looksLikeGbk(bytes);
    case 'euc-kr':
      return looksLikeEucKr(bytes);
    case 'iso-8859-1':
    case 'windows-1252':
      // Single-byte encodings: anything goes structurally. The
      // declared charset is the only signal we have, so trust it.
      return true;
    default:
      // Unknown declaration: don't trust, don't reject — let the
      // statistical heuristic have a turn.
      return false;
  }
}
