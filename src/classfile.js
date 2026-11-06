import { canonicalEntryName } from './jar.js';

const CLASS_ACCESS = [
  [0x0001, 'public'], [0x0010, 'final'], [0x0020, 'super'], [0x0200, 'interface'],
  [0x0400, 'abstract'], [0x1000, 'synthetic'], [0x2000, 'annotation'], [0x4000, 'enum'], [0x8000, 'module']
];
const FIELD_ACCESS = [
  [0x0001, 'public'], [0x0002, 'private'], [0x0004, 'protected'], [0x0008, 'static'],
  [0x0010, 'final'], [0x0040, 'volatile'], [0x0080, 'transient'], [0x1000, 'synthetic'], [0x4000, 'enum']
];
const METHOD_ACCESS = [
  [0x0001, 'public'], [0x0002, 'private'], [0x0004, 'protected'], [0x0008, 'static'],
  [0x0010, 'final'], [0x0020, 'synchronized'], [0x0040, 'bridge'], [0x0080, 'varargs'],
  [0x0100, 'native'], [0x0400, 'abstract'], [0x0800, 'strict'], [0x1000, 'synthetic']
];
const JAVA_VERSIONS = new Map([
  [45, '1.1'], [46, '1.2'], [47, '1.3'], [48, '1.4'], [49, '5'], [50, '6'], [51, '7'],
  [52, '8'], [53, '9'], [54, '10'], [55, '11'], [56, '12'], [57, '13'], [58, '14'],
  [59, '15'], [60, '16'], [61, '17'], [62, '18'], [63, '19'], [64, '20'], [65, '21'],
  [66, '22'], [67, '23']
]);

function accessNames(value, table) {
  return table.filter(([bit]) => (value & bit) !== 0).map(([, name]) => name);
}

class Reader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }
  need(count) {
    if (this.offset + count > this.buffer.length) throw new Error('truncated class file');
  }
  u1() { this.need(1); return this.buffer.readUInt8(this.offset++); }
  u2() { this.need(2); const value = this.buffer.readUInt16BE(this.offset); this.offset += 2; return value; }
  u4() { this.need(4); const value = this.buffer.readUInt32BE(this.offset); this.offset += 4; return value; }
  bytes(length) {
    this.need(length);
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  skip(length) {
    this.need(length);
    this.offset += length;
  }
}

function parseConstantPool(reader) {
  const count = reader.u2();
  if (count < 1) throw new Error('invalid constant pool size');
  const pool = new Array(count).fill(undefined);
  for (let index = 1; index < count; index += 1) {
    const tag = reader.u1();
    switch (tag) {
      case 1: pool[index] = { tag, value: reader.bytes(reader.u2()).toString('utf8') }; break;
      case 3: pool[index] = { tag, value: reader.u4() }; break;
      case 4: pool[index] = { tag, value: reader.u4() }; break;
      case 5:
        pool[index] = { tag, value: reader.u4(), high: reader.u4() };
        index += 1;
        break;
      case 6:
        pool[index] = { tag, value: reader.u4(), high: reader.u4() };
        index += 1;
        break;
      case 7: pool[index] = { tag, nameIndex: reader.u2() }; break;
      case 8: pool[index] = { tag, stringIndex: reader.u2() }; break;
      case 9:
      case 10:
      case 11:
        pool[index] = { tag, classIndex: reader.u2(), nameTypeIndex: reader.u2() };
        break;
      case 12: pool[index] = { tag, nameIndex: reader.u2(), descriptorIndex: reader.u2() }; break;
      case 15: pool[index] = { tag, referenceKind: reader.u1(), referenceIndex: reader.u2() }; break;
      case 16: pool[index] = { tag, descriptorIndex: reader.u2() }; break;
      case 17:
      case 18:
        pool[index] = { tag, bootstrapMethodIndex: reader.u2(), nameTypeIndex: reader.u2() };
        break;
      case 19:
      case 20:
        pool[index] = { tag, nameIndex: reader.u2() };
        break;
      default:
        throw new Error('unsupported class constant pool tag ' + tag);
    }
  }
  return pool;
}

function utf8(pool, index) {
  const entry = pool[index];
  if (entry === undefined || entry.tag !== 1) throw new Error('invalid constant pool UTF-8 reference ' + index);
  return entry.value;
}

function className(pool, index) {
  if (index === 0) return null;
  const entry = pool[index];
  if (entry === undefined || entry.tag !== 7) throw new Error('invalid constant pool class reference ' + index);
  return utf8(pool, entry.nameIndex);
}

function nameAndType(pool, index) {
  const entry = pool[index];
  if (entry === undefined || entry.tag !== 12) throw new Error('invalid constant pool NameAndType reference ' + index);
  return { name: utf8(pool, entry.nameIndex), descriptor: utf8(pool, entry.descriptorIndex) };
}

function readAttributes(reader, pool) {
  const count = reader.u2();
  const attributes = [];
  let signature;
  let sourceFile;
  for (let index = 0; index < count; index += 1) {
    const name = utf8(pool, reader.u2());
    const length = reader.u4();
    const start = reader.offset;
    if (name === 'Signature' && length === 2) signature = utf8(pool, reader.u2());
    else if (name === 'SourceFile' && length === 2) sourceFile = utf8(pool, reader.u2());
    else reader.skip(length);
    if (reader.offset !== start + length) throw new Error('attribute length mismatch for ' + name);
    attributes.push(name);
  }
  return { attributes, signature, sourceFile };
}

function readMembers(reader, pool, kind) {
  const count = reader.u2();
  const members = [];
  for (let index = 0; index < count; index += 1) {
    const access = reader.u2();
    const name = utf8(pool, reader.u2());
    const descriptor = utf8(pool, reader.u2());
    const details = readAttributes(reader, pool);
    members.push({
      access: accessNames(access, kind === 'field' ? FIELD_ACCESS : METHOD_ACCESS),
      name,
      descriptor,
      ...(details.signature === undefined ? {} : { signature: details.signature }),
      ...(details.attributes.length === 0 ? {} : { attributes: details.attributes })
    });
  }
  return members;
}

function stringConstants(pool) {
  const values = [];
  const seen = new Set();
  for (const entry of pool) {
    if (entry === undefined || entry.tag !== 8) continue;
    const value = utf8(pool, entry.stringIndex);
    if (seen.has(value)) continue;
    seen.add(value);
    values.push(value);
    if (values.length >= 100) break;
  }
  return values;
}

function memberReferences(pool) {
  const references = [];
  const seen = new Set();
  for (const entry of pool) {
    if (entry === undefined || (entry.tag !== 9 && entry.tag !== 10 && entry.tag !== 11)) continue;
    const owner = className(pool, entry.classIndex);
    const member = nameAndType(pool, entry.nameTypeIndex);
    const kind = entry.tag === 9 ? 'field' : entry.tag === 10 ? 'method' : 'interface-method';
    const key = [kind, owner, member.name, member.descriptor].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({ kind, owner, name: member.name, descriptor: member.descriptor });
    if (references.length >= 200) break;
  }
  return references;
}

/** Parse a JVM class file into a bounded structural summary. */
export function parseClass(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('class parser requires a Buffer');
  const reader = new Reader(buffer);
  if (reader.u4() !== 0xcafebabe) throw new Error('not a JVM class file: bad magic');
  const minorVersion = reader.u2();
  const majorVersion = reader.u2();
  const pool = parseConstantPool(reader);
  const accessValue = reader.u2();
  const thisClass = className(pool, reader.u2());
  const superClass = className(pool, reader.u2());
  const interfaceCount = reader.u2();
  const interfaces = [];
  for (let index = 0; index < interfaceCount; index += 1) interfaces.push(className(pool, reader.u2()));
  const fields = readMembers(reader, pool, 'field');
  const methods = readMembers(reader, pool, 'method');
  const classAttributes = readAttributes(reader, pool);
  return {
    minorVersion,
    majorVersion,
    javaVersion: JAVA_VERSIONS.get(majorVersion) ?? null,
    access: accessNames(accessValue, CLASS_ACCESS),
    thisClass,
    superClass,
    interfaces,
    fields,
    methods,
    sourceFile: classAttributes.sourceFile ?? null,
    signature: classAttributes.signature ?? null,
    stringConstants: stringConstants(pool),
    references: memberReferences(pool)
  };
}

/** Turn a dotted, slashed, or descriptor class name into a JAR entry path. */
export function classEntryName(value) {
  let name = String(value ?? '').trim();
  if (name === '') throw new Error('class name is required');
  if (name.startsWith('L') && name.endsWith(';')) name = name.slice(1, -1);
  if (name.endsWith('.class')) {
    const base = name.slice(0, -'.class'.length);
    return canonicalEntryName((base.includes('/') ? base : base.replace(/\./g, '/')) + '.class');
  }
  return canonicalEntryName(name.replace(/\./g, '/') + '.class');
}
