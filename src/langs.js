// 代码块语法高亮：按需动态加载的语言集合（精简版，覆盖常用语言）
import { LanguageDescription, StreamLanguage } from '@codemirror/language';

const legacy = (name, key) => LanguageDescription.of({
  name,
  alias: [name.toLowerCase()],
  load: () => import('@codemirror/legacy-modes/mode/' + key.file).then((m) => StreamLanguage.define(m[key.mode]))
});

export const codeLanguages = [
  LanguageDescription.of({
    name: 'JavaScript', alias: ['js', 'node', 'jsx', 'javascript'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true }))
  }),
  LanguageDescription.of({
    name: 'TypeScript', alias: ['ts', 'tsx', 'typescript'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true, typescript: true }))
  }),
  LanguageDescription.of({
    name: 'Python', alias: ['py', 'python', 'python3'],
    load: () => import('@codemirror/lang-python').then((m) => m.python())
  }),
  LanguageDescription.of({
    name: 'HTML', alias: ['html', 'htm'],
    load: () => import('@codemirror/lang-html').then((m) => m.html())
  }),
  LanguageDescription.of({
    name: 'CSS', alias: ['css'],
    load: () => import('@codemirror/lang-css').then((m) => m.css())
  }),
  LanguageDescription.of({
    name: 'JSON', alias: ['json', 'jsonc'],
    load: () => import('@codemirror/lang-json').then((m) => m.json())
  }),
  LanguageDescription.of({
    name: 'Java', alias: ['java'],
    load: () => import('@codemirror/lang-java').then((m) => m.java())
  }),
  LanguageDescription.of({
    name: 'C++', alias: ['cpp', 'c', 'c++', 'cc', 'h', 'hpp'],
    load: () => import('@codemirror/lang-cpp').then((m) => m.cpp())
  }),
  LanguageDescription.of({
    name: 'Rust', alias: ['rust', 'rs'],
    load: () => import('@codemirror/lang-rust').then((m) => m.rust())
  }),
  LanguageDescription.of({
    name: 'Go', alias: ['go', 'golang'],
    load: () => import('@codemirror/lang-go').then((m) => m.go())
  }),
  LanguageDescription.of({
    name: 'PHP', alias: ['php'],
    load: () => import('@codemirror/lang-php').then((m) => m.php())
  }),
  LanguageDescription.of({
    name: 'SQL', alias: ['sql', 'mysql', 'postgresql'],
    load: () => import('@codemirror/lang-sql').then((m) => m.sql())
  }),
  LanguageDescription.of({
    name: 'XML', alias: ['xml', 'svg', 'plist'],
    load: () => import('@codemirror/lang-xml').then((m) => m.xml())
  }),
  LanguageDescription.of({
    name: 'YAML', alias: ['yaml', 'yml'],
    load: () => import('@codemirror/lang-yaml').then((m) => m.yaml())
  }),
  legacy('Shell', { file: 'shell', mode: 'shell' }),
  legacy('Ruby', { file: 'ruby', mode: 'ruby' }),
  legacy('Lua', { file: 'lua', mode: 'lua' }),
  legacy('TOML', { file: 'toml', mode: 'toml' }),
  legacy('Dockerfile', { file: 'dockerfile', mode: 'dockerFile' }),
  legacy('PowerShell', { file: 'powershell', mode: 'powerShell' }),
  legacy('Swift', { file: 'swift', mode: 'swift' }),
  LanguageDescription.of({
    name: 'C#', alias: ['csharp', 'cs', 'c#'],
    load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => StreamLanguage.define(m.csharp))
  }),
  LanguageDescription.of({
    name: 'Kotlin', alias: ['kotlin', 'kt'],
    load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => StreamLanguage.define(m.kotlin))
  }),
  LanguageDescription.of({
    name: 'Diff', alias: ['diff', 'patch'],
    load: () => import('@codemirror/legacy-modes/mode/diff').then((m) => StreamLanguage.define(m.diff))
  }),
  LanguageDescription.of({
    name: 'INI', alias: ['ini', 'conf', 'properties'],
    load: () => import('@codemirror/legacy-modes/mode/properties').then((m) => StreamLanguage.define(m.properties))
  })
];

export const languageNames = codeLanguages
  .map((l) => (l.alias && l.alias[0]) || l.name.toLowerCase())
  .sort();
