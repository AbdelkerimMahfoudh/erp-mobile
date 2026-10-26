/**
 * A source map as the bundle audits read it: one `sources` list and one `mappings` string.
 *
 * Since Expo SDK 58, Metro writes an *indexed* source map (`{ version: 3, sections: [{ offset, map }] }`, one
 * section per module) instead of a single map. Read as before, it has no `sources` at all, and an audit that reads
 * it would check nothing. This turns an indexed map into the equivalent plain map — every section's sources and
 * contents, and its mappings moved by the section's offset — and returns a plain map unchanged (D222).
 */
'use strict';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64 = new Int8Array(128).fill(-1);
[...CHARS].forEach((c, i) => (B64[c.charCodeAt(0)] = i));

/** One generated line's segments, each `[column, source, sourceLine, sourceColumn, name?]`, absolute. */
function decode(mappings) {
  const lines = [];
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let name = 0;
  for (const line of mappings.split(';')) {
    const segments = [];
    let column = 0;
    for (const text of line ? line.split(',') : []) {
      const values = [];
      for (let i = 0, value = 0, shift = 0; i < text.length; i++) {
        const digit = B64[text.charCodeAt(i)];
        if (digit < 0) throw new Error(`not a source map mapping: ${JSON.stringify(text)}`);
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          values.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      column += values[0];
      if (values.length >= 4) {
        source += values[1];
        sourceLine += values[2];
        sourceColumn += values[3];
        if (values.length >= 5) {
          name += values[4];
          segments.push([column, source, sourceLine, sourceColumn, name]);
        } else segments.push([column, source, sourceLine, sourceColumn]);
      } else segments.push([column]);
    }
    lines.push(segments);
  }
  return lines;
}

function vlq(value) {
  let n = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = n & 31;
    n >>>= 5;
    if (n > 0) digit |= 32;
    out += CHARS[digit];
  } while (n > 0);
  return out;
}

function encode(lines) {
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let name = 0;
  return lines
    .map((segments) => {
      let column = 0;
      return segments
        .map((s) => {
          let text = vlq(s[0] - column);
          column = s[0];
          if (s.length >= 4) {
            text += vlq(s[1] - source) + vlq(s[2] - sourceLine) + vlq(s[3] - sourceColumn);
            source = s[1];
            sourceLine = s[2];
            sourceColumn = s[3];
            if (s.length >= 5) {
              text += vlq(s[4] - name);
              name = s[4];
            }
          }
          return text;
        })
        .join(',');
    })
    .join(';');
}

/** The plain map an indexed one stands for; a plain map as it is. */
function flatten(map) {
  if (!map || !Array.isArray(map.sections)) return map;
  const sources = [];
  const sourcesContent = [];
  const names = [];
  const lines = [];
  for (const { offset, map: inner } of map.sections) {
    if (!inner || inner.sections) throw new Error('a nested or remote section map cannot be read here');
    const sourceBase = sources.length;
    const nameBase = names.length;
    sources.push(...(inner.sources ?? []));
    (inner.sources ?? []).forEach((_, i) => sourcesContent.push(inner.sourcesContent?.[i] ?? null));
    names.push(...(inner.names ?? []));
    decode(inner.mappings ?? '').forEach((segments, k) => {
      const at = offset.line + k;
      while (lines.length <= at) lines.push([]);
      for (const s of segments) {
        const moved = [s[0] + (k === 0 ? offset.column : 0)];
        if (s.length >= 4) moved.push(s[1] + sourceBase, s[2], s[3]);
        if (s.length >= 5) moved.push(s[4] + nameBase);
        lines[at].push(moved);
      }
    });
  }
  for (const segments of lines) segments.sort((a, b) => a[0] - b[0]);
  return { version: 3, file: map.file, sources, sourcesContent, names, mappings: encode(lines) };
}

module.exports = { flatten, decode, encode };
