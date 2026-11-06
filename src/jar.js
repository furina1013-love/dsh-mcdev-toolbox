import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_JAR_BYTES = 128 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

export const JAR_EXTENSION = /\.(?:jar|zip)$/i;

function readU16(buffer, offset) {
  if (offset < 0 || offset + 2 > buffer.length) throw new Error('truncated ZIP header');
  return buffer.readUInt16LE(offset);
}

function readU32(buffer, offset) {
  if (offset < 0 || offset + 4 > buffer.length) throw new Error('truncated ZIP header');
  return buffer.readUInt32LE(offset);
}

function findEndOfCentralDirectory(buffer) {
  if (buffer.length < 22) throw new Error('not a ZIP/JAR file: file is too short');
  const lowest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= lowest; offset -= 1) {
    if (readU32(buffer, offset) !== EOCD_SIGNATURE) continue;
    const commentLength = readU16(buffer, offset + 20);
    if (offset + 22 + commentLength !== buffer.length) continue;
    return {
      diskNumber: readU16(buffer, offset + 4),
      centralDisk: readU16(buffer, offset + 6),
      entriesThisDisk: readU16(buffer, offset + 8),
      totalEntries: readU16(buffer, offset + 10),
      centralSize: readU32(buffer, offset + 12),
      centralOffset: readU32(buffer, offset + 16)
    };
  }
  throw new Error('not a ZIP/JAR file: end-of-central-directory record not found');
}

/** Normalize an entry path and reject absolute or parent-traversing names. */
export function canonicalEntryName(name) {
  const raw = String(name ?? '').replace(/\\/g, '/');
  if (raw === '' || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw new Error('entry path must be relative to the archive root');
  const parts = raw.split('/');
  const clean = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') throw new Error('entry path escapes the archive root');
    clean.push(part);
  }
  if (clean.length === 0) throw new Error('entry path is empty');
  return clean.join('/');
}

/**
 * Read the ZIP central directory without extracting the archive.
 * The returned index keeps the source buffer so selected entries can be read
 * without writing anything to disk.
 */
export async function openJar(file, options = {}) {
  const maxBytes = Number(options.maxBytes) || MAX_JAR_BYTES;
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('not a file: ' + file);
  if (stat.size > maxBytes) throw new Error('archive is too large: ' + stat.size + ' bytes (limit ' + maxBytes + ')');
  const buffer = await fs.readFile(file);
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd.diskNumber !== 0 || eocd.centralDisk !== 0 || eocd.entriesThisDisk !== eocd.totalEntries) {
    throw new Error('multi-disk ZIP archives are not supported');
  }
  if (eocd.totalEntries === 0xffff || eocd.centralSize === 0xffffffff || eocd.centralOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported');
  }
  const centralEnd = eocd.centralOffset + eocd.centralSize;
  if (centralEnd > buffer.length) throw new Error('ZIP central directory is outside the file');

  const entries = new Map();
  const duplicates = [];
  const unsafe = [];
  const unsafeNames = new Set();
  let offset = eocd.centralOffset;
  for (let index = 0; index < eocd.totalEntries; index += 1) {
    if (offset + 46 > centralEnd) throw new Error('truncated ZIP central directory');
    if (readU32(buffer, offset) !== CENTRAL_SIGNATURE) throw new Error('invalid ZIP central directory entry');
    const flags = readU16(buffer, offset + 8);
    const method = readU16(buffer, offset + 10);
    const crc32 = readU32(buffer, offset + 16);
    const compressedSize = readU32(buffer, offset + 20);
    const uncompressedSize = readU32(buffer, offset + 24);
    const nameLength = readU16(buffer, offset + 28);
    const extraLength = readU16(buffer, offset + 30);
    const commentLength = readU16(buffer, offset + 32);
    const localOffset = readU32(buffer, offset + 42);
    const nameStart = offset + 46;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > centralEnd) throw new Error('truncated ZIP central directory entry name');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('ZIP64 entries are not supported');
    }
    const rawName = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    let path;
    try { path = canonicalEntryName(rawName); }
    catch (error) {
      unsafe.push(rawName);
      unsafeNames.add(rawName);
      path = rawName;
    }
    const entry = {
      name: rawName,
      path,
      directory: rawName.endsWith('/'),
      method,
      flags,
      encrypted: (flags & 0x0001) !== 0,
      crc32,
      compressedSize,
      uncompressedSize,
      localOffset,
      unsafe: unsafeNames.has(rawName)
    };
    if (entries.has(path)) duplicates.push(path);
    entries.set(path, entry);
    offset = next;
  }
  return {
    file,
    bytes: stat.size,
    buffer,
    entries,
    duplicates,
    unsafe,
    totalEntries: eocd.totalEntries
  };
}

/** Read and decompress one entry, with an uncompressed-size cap. */
export function readEntry(index, name, options = {}) {
  const path = canonicalEntryName(name);
  const entry = index.entries.get(path);
  if (entry === undefined) throw new Error('entry not found in archive: ' + name);
  if (entry.unsafe) throw new Error('entry has an unsafe path: ' + name);
  if (entry.directory) throw new Error('entry is a directory: ' + name);
  if (entry.encrypted) throw new Error('encrypted ZIP entries are not supported');
  const maxBytes = Number(options.maxBytes) || MAX_ENTRY_BYTES;
  if (entry.uncompressedSize > maxBytes) {
    throw new Error('entry is too large: ' + entry.uncompressedSize + ' bytes (limit ' + maxBytes + ')');
  }
  const localOffset = entry.localOffset;
  if (localOffset < 0 || localOffset + 30 > index.buffer.length) throw new Error('entry local header is outside the archive');
  if (readU32(index.buffer, localOffset) !== LOCAL_SIGNATURE) throw new Error('invalid ZIP local header for ' + name);
  const nameLength = readU16(index.buffer, localOffset + 26);
  const extraLength = readU16(index.buffer, localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > index.buffer.length) throw new Error('entry data is outside the archive');
  const compressed = index.buffer.subarray(dataStart, dataEnd);
  let data;
  if (entry.method === 0) {
    data = Buffer.from(compressed);
  } else if (entry.method === 8) {
    try {
      data = zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(1, maxBytes) });
    } catch (error) {
      throw new Error('cannot inflate entry ' + name + ': ' + (error instanceof Error ? error.message : String(error)));
    }
  } else {
    throw new Error('unsupported ZIP compression method ' + entry.method + ' for ' + name);
  }
  if (data.length !== entry.uncompressedSize) {
    throw new Error('entry size mismatch for ' + name + ': expected ' + entry.uncompressedSize + ', got ' + data.length);
  }
  return { entry, data };
}

/** Read a UTF-8 text entry and reject binary content. */
export function readEntryText(index, name, options = {}) {
  const { entry, data } = readEntry(index, name, options);
  const text = data.toString('utf8').replace(/^\uFEFF/, '');
  if (text.includes('\u0000') || /[\u0001-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) throw new Error('entry is binary: ' + name);
  return { entry, bytes: data.length, text };
}

/** Parse the main section of a JAR manifest; continuation lines are unfolded. */
export function parseManifest(text) {
  const map = new Map();
  let current = '';
  const flush = () => {
    if (current === '') return;
    const match = /^([^:]+):\s*(.*)$/.exec(current);
    if (match) map.set(match[1].trim(), match[2].trim());
    current = '';
  };
  for (const raw of String(text).split(/\r?\n/)) {
    if (raw.startsWith(' ')) { current += raw.slice(1); continue; }
    flush();
    if (raw.trim() !== '') current = raw;
  }
  flush();
  return Object.fromEntries(map);
}

/** List likely build-output jars from the usual project directories. */
export async function findJarCandidates(root) {
  const directories = ['build/libs', 'build/devlibs', 'run/mods', 'libs'];
  const found = [];
  for (const relative of directories) {
    const dir = path.join(root, relative);
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !JAR_EXTENSION.test(entry.name)) continue;
      if (/-sources|-javadoc/i.test(entry.name)) continue;
      const file = path.join(dir, entry.name);
      try {
        const stat = await fs.stat(file);
        found.push({ file, bytes: stat.size, mtimeMs: stat.mtimeMs });
      } catch { /* raced with build output cleanup */ }
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}
