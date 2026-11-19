// ترميز وقراءة ASN.1 DER بالحد الأدنى اللازم لطلب الشهادة واستخراج بيانات شهادة الهيئة.

function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export const tlv = (tag: number, body: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
export const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
export const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
export const int = (n: number) => tlv(0x02, Buffer.from([n]));
export const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));
export const printable = (s: string) => tlv(0x13, Buffer.from(s, 'ascii'));
export const octet = (b: Buffer) => tlv(0x04, b);
export const bitString = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
export const ctx = (n: number, body: Buffer, constructed = true) => tlv((constructed ? 0xa0 : 0x80) | n, body);

export function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const out: number[] = [parts[0] * 40 + parts[1]];
  for (const p of parts.slice(2)) {
    const stack = [p & 0x7f];
    let v = p >>> 7;
    while (v > 0) { stack.unshift((v & 0x7f) | 0x80); v >>>= 7; }
    out.push(...stack);
  }
  return tlv(0x06, Buffer.from(out));
}

export interface Node { tag: number; start: number; header: number; length: number; body: Buffer }

export function read(buf: Buffer, at = 0): Node {
  const tag = buf[at];
  let l = buf[at + 1];
  let header = 2;
  if (l & 0x80) {
    const n = l & 0x7f;
    l = 0;
    for (let i = 0; i < n; i++) l = (l << 8) | buf[at + 2 + i];
    header += n;
  }
  return { tag, start: at, header, length: l, body: buf.subarray(at + header, at + header + l) };
}

export function children(node: Node): Node[] {
  const out: Node[] = [];
  let at = 0;
  while (at < node.body.length) {
    const c = read(node.body, at);
    out.push(c);
    at += c.header + c.length;
  }
  return out;
}
