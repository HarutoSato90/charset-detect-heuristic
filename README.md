# charset-detect-heuristic

A small, dependency-free TypeScript library that detects the text encoding of a byte buffer by combining three signals: a byte order mark, a declared charset in HTML/XML, and statistical byte-structure heuristics for the common 8-bit legacy encodings.

## Usage

```js
import { detectCharset, detectBOM, normalizeCharset } from 'charset-detect-heuristic';

const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0xc3, 0xa9, 0x6c, 0x6c, 0x6f]);
const result = detectCharset(bytes);
// { charset: 'utf-8', source: 'bom' }

const bomOnly = detectBOM(bytes); // 'utf-8'
const canon = normalizeCharset('Shift_JIS'); // 'shift-jis'
```

`detectCharset` returns `{ charset: string|null, source: 'bom'|'declared'|'heuristic'|'none', declared?: string }`. Resolution order is: BOM first (strongest), then a declared charset only if the bytes look plausible for it, then the statistical heuristic, then `null`.

## Why this exists

The specific problem: real-world text files and scraped HTML often carry a wrong or missing charset declaration, and the byte order mark is frequently stripped by intermediate tools. A detector that trusts the declaration blindly produces mojibake; one that ignores it misses the obvious cases. This library takes a measured position: the BOM always wins, a declaration is trusted only when the bytes don't contradict it, and a structural heuristic catches the rest.

The trade-off: the heuristic recognises only UTF-8, UTF-16LE/BE, Shift-JIS, EUC-JP, GBK, and EUC-KR. Anything else (ISO-2022-JP, Big5, single-byte European encodings beyond ISO-8859-1 and Windows-1252) falls through to `null`. This is deliberate — a detector that guesses confidently about encodings it cannot structurally distinguish does more harm than good.

## Awkward edge

A declared `iso-8859-1` or `windows-1252` is always trusted, because there is no reliable structural test for a single-byte encoding — any byte distribution is valid. If the file is actually Shift-JIS with an ISO-8859-1 declaration, the declaration wins and the bytes decode as garbage. The BOM check runs first precisely to catch the common case where UTF-8 files are mislabelled; if you have no BOM and a lying declaration for a single-byte encoding, this library will not save you.

## Exports

- `detectBOM(bytes: Uint8Array): string | null`
- `extractDeclaredCharset(bytes: Uint8Array): string | null`
- `normalizeCharset(name: string): string`
- `detectByHeuristic(bytes: Uint8Array): string | null`
- `detectCharset(bytes: Uint8Array): { charset: string | null, source: 'bom' | 'declared' | 'heuristic' | 'none', declared?: string }`
