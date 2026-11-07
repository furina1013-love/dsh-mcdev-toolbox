import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { inspectJar, listJar, readJarEntry, classInfo, disassembleJar } from '../src/jar-tool.js';

function u1(value) { return Buffer.from([value & 0xff]); }
function u2(value) { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(value & 0xffff, 0); return buffer; }
function u4(value) { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value >>> 0, 0); return buffer; }

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const item of entries) {
    const name = Buffer.from(item.name, 'utf8');
    const data = Buffer.from(item.data);
    const method = item.method ?? 8;
    const compressed = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localRecord = Buffer.concat([local, name, compressed]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(localRecord);
    centrals.push(Buffer.concat([central, name]));
    offset += localRecord.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, eocd]);
}

function classBytes() {
  const be2 = (value) => { const buffer = Buffer.alloc(2); buffer.writeUInt16BE(value & 0xffff, 0); return buffer; };
  const be4 = (value) => { const buffer = Buffer.alloc(4); buffer.writeUInt32BE(value >>> 0, 0); return buffer; };
  const pool = [];
  const add = (buffer) => { pool.push(buffer); return pool.length; };
  const utf8 = (value) => add(Buffer.concat([u1(1), be2(Buffer.byteLength(value)), Buffer.from(value, 'utf8')]));
  const classRef = (index) => add(Buffer.concat([u1(7), be2(index)]));
  const objectName = utf8('java/lang/Object');
  const objectClass = classRef(objectName);
  const thisName = utf8('example/Hello');
  const thisClass = classRef(thisName);
  const fieldName = utf8('name');
  const fieldDesc = utf8('Ljava/lang/String;');
  const initName = utf8('<init>');
  const initDesc = utf8('()V');
  const sourceName = utf8('SourceFile');
  const sourceFile = utf8('Hello.java');
  const stringValue = utf8('hello from jar');
  add(Buffer.concat([u1(8), be2(stringValue)]));
  const nameType = add(Buffer.concat([u1(12), be2(fieldName), be2(fieldDesc)]));
  add(Buffer.concat([u1(9), be2(thisClass), be2(nameType)]));
  return Buffer.concat([
    be4(0xcafebabe), be2(0), be2(61), be2(pool.length + 1), ...pool,
    be2(0x0021), be2(thisClass), be2(objectClass), be2(0),
    be2(1), be2(0x0002), be2(fieldName), be2(fieldDesc), be2(0),
    be2(1), be2(0x0001), be2(initName), be2(initDesc), be2(0),
    be2(1), be2(sourceName), be4(2), be2(sourceFile)
  ]);
}

async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-jar-'));
  await fs.mkdir(path.join(root, 'build/libs'), { recursive: true });
  await fs.mkdir(path.join(root, 'src/main/resources'), { recursive: true });
  await fs.writeFile(path.join(root, 'settings.gradle'), "rootProject.name = 'testmod'\n");
  await fs.writeFile(path.join(root, 'build.gradle'), "plugins { id 'fabric-loom' version '1.9.2' }\n");
  await fs.writeFile(path.join(root, 'gradle.properties'), 'minecraft_version=1.21.1\n');
  await fs.writeFile(path.join(root, 'src/main/resources/fabric.mod.json'), JSON.stringify({ schemaVersion: 1, id: 'testmod', version: '1.0.0' }));
  const jar = path.join(root, 'build/libs/demo.jar');
  await fs.writeFile(jar, zip([
    { name: 'META-INF/MANIFEST.MF', method: 0, data: 'Manifest-Version: 1.0\r\nMain-Class: example.Hello\r\n\r\n' },
    { name: 'fabric.mod.json', data: JSON.stringify({ schemaVersion: 1, id: 'examplemod', version: '1.2.3', entrypoints: { main: ['example.Hello'] }, depends: { minecraft: '1.21.x' } }) },
    { name: 'example/Hello.class', data: classBytes() },
    { name: 'assets/example/lang/en_us.json', data: JSON.stringify({ 'item.example.hello': 'Hello' }) },
    { name: 'META-INF/jars/embedded.jar', data: Buffer.from('not really a jar') },
    { name: 'README.md', method: 0, data: 'Useful archive notes.\n' }
  ]));
  return { root, jar };
}

test('inspects archive metadata and reads compressed entries', async () => {
  const { root } = await project();
  const info = await inspectJar({ cwd: root });
  assert.equal(info.ok, true);
  assert.equal(info.classes, 1);
  assert.equal(info.manifest['Main-Class'], 'example.Hello');
  assert.equal(info.metadata.find((entry) => entry.path === 'fabric.mod.json').data.id, 'examplemod');
  assert.ok(info.nestedJars.includes('META-INF/jars/embedded.jar'));
  assert.ok(info.classSamples.includes('example/Hello.class'));
  assert.equal(info.unsafeEntries, 0);

  const listed = await listJar({ cwd: root, prefix: 'example' });
  assert.equal(listed.matched, 1);
  assert.equal(listed.entries[0].path, 'example/Hello.class');
  assert.equal(listed.entries[0].method, 'deflated');

  const read = await readJarEntry({ cwd: root, entry: 'README.md' });
  assert.match(read.text, /Useful archive notes/);
});

test('parses a class file into fields, methods, strings and references', async () => {
  const { root } = await project();
  const info = await classInfo({ cwd: root, className: 'example.Hello' });
  assert.equal(info.thisClass, 'example/Hello');
  assert.equal(info.superClass, 'java/lang/Object');
  assert.equal(info.javaVersion, '17');
  assert.deepEqual(info.fields.map((field) => field.name), ['name']);
  assert.ok(info.methods.some((method) => method.name === '<init>'));
  assert.ok(info.stringConstants.includes('hello from jar'));
  assert.ok(info.references.some((reference) => reference.kind === 'field' && reference.name === 'name'));
  assert.equal(info.sourceFile, 'Hello.java');
  const renamed = await classInfo({ cwd: root, className: 'example.Hello.class' });
  assert.equal(renamed.entry, 'example/Hello.class');
});

test('rejects traversal and binary entries', async () => {
  const { root } = await project();
  await assert.rejects(() => listJar({ cwd: root, prefix: '../' }), /escapes|relative/);
  await assert.rejects(() => classInfo({ cwd: root, className: '../evil' }), /escapes|relative/);
  await assert.rejects(() => readJarEntry({ cwd: root, entry: 'example/Hello.class' }), /binary/);
});

test('requires an explicit path when multiple jars are present', async () => {
  const { root, jar } = await project();
  await fs.writeFile(path.join(root, 'build/libs/other.jar'), zip([{ name: 'a.txt', method: 0, data: 'a' }]));
  await assert.rejects(() => inspectJar({ cwd: root }), /multiple jars/);
  const info = await inspectJar({ cwd: root, jar: path.relative(root, jar) });
  assert.equal(info.ok, true);
});

test('runs javap when a JDK is available', { skip: process.platform === 'win32' }, async () => {
  const { root } = await project();
  const jdk = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-jdk-'));
  await fs.mkdir(path.join(jdk, 'bin'), { recursive: true });
  const javap = path.join(jdk, 'bin', 'javap');
  await fs.writeFile(javap, '#!/bin/sh\necho "Compiled from Hello.java"\necho "public class example.Hello"\n');
  await fs.chmod(javap, 0o755);
  const previous = process.env.JAVA_HOME;
  process.env.JAVA_HOME = jdk;
  try {
    const info = await disassembleJar({ cwd: root, className: 'example.Hello' });
    assert.equal(info.ok, true);
    assert.equal(info.tool, 'javap');
    assert.match(info.output, /public class example\.Hello/);
  } finally {
    if (previous === undefined) delete process.env.JAVA_HOME;
    else process.env.JAVA_HOME = previous;
  }
});
