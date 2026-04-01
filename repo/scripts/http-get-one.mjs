/**
 * GET url, write response body to outPath, print HTTP status to stdout only.
 * On failure prints "0" and writes empty file. Uses global fetch (Node 18+).
 */
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const outPath = process.argv[3];
const timeoutMs = Number.parseInt(process.env.HTTP_GET_TIMEOUT_MS || '15000', 10);

if (!url || !outPath) {
  process.stderr.write('usage: node http-get-one.mjs <url> <bodyOutPath>\n');
  process.exit(2);
}

const ac = new AbortController();
const t = setTimeout(() => ac.abort(), timeoutMs);

try {
  const res = await fetch(url, { signal: ac.signal });
  const text = await res.text();
  writeFileSync(outPath, text, 'utf8');
  process.stdout.write(String(res.status));
} catch {
  writeFileSync(outPath, '', 'utf8');
  process.stdout.write('0');
} finally {
  clearTimeout(t);
}
