import { inspectJar, listJar, readJarEntry, classInfo, disassembleJar } from '../jar-tool.js';

export async function runJar(args, options) {
  const action = args.action ?? 'inspect';
  if (action === 'inspect') return inspectJar({ cwd: options.cwd, jar: args.path });
  if (action === 'list') return listJar({ cwd: options.cwd, jar: args.path, prefix: args.prefix, limit: args.limit });
  if (action === 'read') return readJarEntry({ cwd: options.cwd, jar: args.path, entry: args.entry, maxOutputChars: options.maxOutputChars });
  if (action === 'class') return classInfo({ cwd: options.cwd, jar: args.path, className: args.class });
  if (action === 'disassemble') return disassembleJar({ cwd: options.cwd, jar: args.path, className: args.class, maxOutputChars: options.maxOutputChars });
  throw new Error('action must be inspect, list, read, class, or disassemble');
}
