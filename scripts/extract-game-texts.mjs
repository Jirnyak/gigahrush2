import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');
const ARCHIVE_ROOT = path.resolve(ROOT, '..', 'gatbage');
const OUT_FILE = path.join(ARCHIVE_ROOT, 'reference/scenario_writers/game_text_inventory.md');
const EXTRA_TEXT_FILES = ['index.html', 'public/manifest.webmanifest'];

const PLAYER_KEYS = new Set([
  'action',
  'after',
  'announce',
  'answer',
  'bark',
  'barks',
  'body',
  'brief',
  'caption',
  'choice',
  'choices',
  'complete',
  'completed',
  'condition',
  'consequence',
  'counterplay',
  'desc',
  'description',
  'details',
  'dialogue',
  'display',
  'displayName',
  'effect',
  'effectText',
  'end',
  'fail',
  'failed',
  'failure',
  'flavor',
  'hint',
  'info',
  'intro',
  'label',
  'line',
  'lines',
  'log',
  'message',
  'messages',
  'name',
  'note',
  'notes',
  'objective',
  'option',
  'options',
  'outcome',
  'phase',
  'placeholder',
  'post',
  'prompt',
  'reaction',
  'reason',
  'reply',
  'response',
  'reward',
  'short',
  'sign',
  'subtitle',
  'success',
  'summary',
  'talkLine',
  'talkLines',
  'talkLinesPost',
  'talkQuestResponse',
  'target',
  'text',
  'texts',
  'title',
  'toast',
  'tooltip',
  'warning',
]);

const TECH_KEYS = new Set([
  'api',
  'baseId',
  'bucket',
  'className',
  'code',
  'color',
  'defId',
  'event',
  'eventId',
  'eventType',
  'faction',
  'file',
  'font',
  'format',
  'group',
  'hash',
  'icon',
  'id',
  'itemId',
  'key',
  'kind',
  'mode',
  'path',
  'phaseId',
  'ref',
  'roomId',
  'routeId',
  'sound',
  'source',
  'sprite',
  'status',
  'tag',
  'tags',
  'targetId',
  'texture',
  'type',
  'variant',
  'variantId',
  'weaponId',
  'zoneId',
]);

const VISIBLE_CALLS = new Set([
  'addLog',
  'addMessage',
  'controlHint',
  'drawCenteredWrappedText',
  'drawGlitchLine',
  'drawGlitchText',
  'drawText',
  'drawWrappedText',
  'fillText',
  'format',
  'log',
  'makeNote',
  'push',
  'pushLine',
  'pushLog',
  'setGameMessage',
  'showMessage',
  'warn',
]);

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

function listTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out.sort((a, b) => rel(a).localeCompare(rel(b)));
}

function textOfName(name) {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return name.getText();
}

function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return expr.getText();
}

function hasCyrillic(text) {
  return /[А-Яа-яЁё]/.test(text);
}

function looksTechnicalAscii(text) {
  if (text.length <= 1) return true;
  if (/^#(?:[0-9a-f]{3}){1,2}$/i.test(text)) return true;
  if (/^(?:rgba?|hsla?)\(/i.test(text)) return true;
  if (/^[a-z0-9_./:-]+$/.test(text) && !/[A-Z]/.test(text)) return true;
  if (/^[A-Z0-9_./:-]+$/.test(text) && text.length > 24) return true;
  return false;
}

function literalText(node, sourceFile) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    const raw = node.getText(sourceFile);
    return raw.slice(1, -1);
  }
  return '';
}

function literalKind(node) {
  if (ts.isTemplateExpression(node)) return 'template';
  if (ts.isNoSubstitutionTemplateLiteral(node)) return 'template-literal';
  return 'string';
}

function nearestPlayerKey(node) {
  let cur = node.parent;
  while (cur) {
    if (ts.isPropertyAssignment(cur)) {
      const key = textOfName(cur.name);
      if (key) return key;
    }
    if (
      ts.isVariableDeclaration(cur)
      || ts.isFunctionDeclaration(cur)
      || ts.isSourceFile(cur)
      || ts.isCallExpression(cur)
    ) {
      return undefined;
    }
    cur = cur.parent;
  }
  return undefined;
}

function isModuleSpecifier(node) {
  return ts.isStringLiteral(node)
    && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent));
}

function isObjectPropertyName(node) {
  const parent = node.parent;
  return parent
    && (
      (ts.isPropertyAssignment(parent) && parent.name === node)
      || (ts.isPropertyDeclaration(parent) && parent.name === node)
      || (ts.isMethodDeclaration(parent) && parent.name === node)
    );
}

function visibleCallContext(node) {
  let cur = node.parent;
  while (cur && !ts.isSourceFile(cur)) {
    if (ts.isCallExpression(cur)) {
      const name = calleeName(cur.expression);
      if (VISIBLE_CALLS.has(name)) return name;
      return undefined;
    }
    if (ts.isPropertyAssignment(cur) || ts.isVariableDeclaration(cur)) return undefined;
    cur = cur.parent;
  }
  return undefined;
}

function isLikelyPlayerText(node, text) {
  if (!text.trim()) return false;
  if (isModuleSpecifier(node) || isObjectPropertyName(node)) return false;
  if (hasCyrillic(text)) return true;
  const key = nearestPlayerKey(node);
  if (key && PLAYER_KEYS.has(key) && !TECH_KEYS.has(key) && !looksTechnicalAscii(text)) return true;
  const call = visibleCallContext(node);
  if (call && !looksTechnicalAscii(text)) return true;
  return false;
}

function ancestorContext(node, sourceFile) {
  const parts = [];
  let cur = node.parent;
  while (cur && !ts.isSourceFile(cur)) {
    if (ts.isPropertyAssignment(cur)) {
      const key = textOfName(cur.name);
      if (key) parts.push(`.${key}`);
    } else if (ts.isArrayLiteralExpression(cur)) {
      const index = cur.elements.findIndex((el) => el === node || el.pos <= node.pos && node.end <= el.end);
      if (index >= 0) parts.push(`[${index}]`);
    } else if (ts.isCallExpression(cur)) {
      const index = cur.arguments.findIndex((arg) => arg === node || arg.pos <= node.pos && node.end <= arg.end);
      parts.push(`${calleeName(cur.expression)}(${index >= 0 ? `arg${index}` : 'arg?'})`);
    } else if (ts.isVariableDeclaration(cur)) {
      if (ts.isIdentifier(cur.name)) parts.push(cur.name.text);
    } else if (ts.isFunctionDeclaration(cur) && cur.name) {
      parts.push(`${cur.name.text}()`);
    } else if (ts.isReturnStatement(cur)) {
      parts.push('return');
    }
    node = cur;
    cur = cur.parent;
  }
  return parts.reverse().join(' ') || sourceFile.fileName;
}

function lineCol(sourceFile, pos) {
  const lc = sourceFile.getLineAndCharacterOfPosition(pos);
  return { line: lc.line + 1, col: lc.character + 1 };
}

function escapeFence(text) {
  return text.replaceAll('```', '`\\`\\`');
}

function sectionFor(file) {
  const parts = rel(file).split('/');
  return parts.length >= 3 ? `${parts[0]}/${parts[1]}` : parts[0];
}

function collect() {
  const entries = [];
  for (const file of listTsFiles(SRC_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    function visit(node) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
        const text = literalText(node, sourceFile);
        if (isLikelyPlayerText(node, text)) {
          const { line, col } = lineCol(sourceFile, node.getStart(sourceFile));
          const key = nearestPlayerKey(node);
          entries.push({
            file: rel(file),
            line,
            col,
            kind: literalKind(node),
            key: key ?? '',
            context: ancestorContext(node, sourceFile),
            text,
          });
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }
  entries.push(...collectExtraTextFiles());
  return entries;
}

function lineColInText(source, index) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: index - lineStart + 1 };
}

function collectExtraTextFiles() {
  const entries = [];
  for (const relFile of EXTRA_TEXT_FILES) {
    const file = path.join(ROOT, relFile);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const matches = [];
    if (relFile.endsWith('.html')) {
      for (const match of source.matchAll(/<title>([^<]+)<\/title>/g)) {
        matches.push({ key: 'title', text: match[1], offset: match.index + match[0].indexOf(match[1]) });
      }
      for (const match of source.matchAll(/<meta\s+[^>]*name="([^"]+)"[^>]*content="([^"]+)"[^>]*\/?>/g)) {
        matches.push({ key: match[1], text: match[2], offset: match.index + match[0].indexOf(match[2]) });
      }
    } else if (relFile.endsWith('.webmanifest')) {
      for (const match of source.matchAll(/"(name|short_name|description)"\s*:\s*"([^"]+)"/g)) {
        matches.push({ key: match[1], text: match[2], offset: match.index + match[0].lastIndexOf(match[2]) });
      }
    }

    for (const match of matches) {
      if (!hasCyrillic(match.text)) continue;
      const { line, col } = lineColInText(source, match.offset);
      entries.push({
        file: relFile,
        line,
        col,
        kind: relFile.endsWith('.html') ? 'html' : 'json',
        key: match.key,
        context: match.key,
        text: match.text,
      });
    }
  }
  return entries;
}

function writeMarkdown(entries) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  let lastSection = '';
  const fileCounts = new Map();
  for (const entry of entries) fileCounts.set(entry.file, (fileCounts.get(entry.file) ?? 0) + 1);
  const topFiles = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  const lines = [];
  lines.push('# Game Text Inventory');
  lines.push('');
  lines.push('Рабочая выгрузка player-facing строк из `src/**/*.ts`, `index.html` и `public/manifest.webmanifest` для сценарной правки.');
  lines.push('');
  lines.push('Сгенерировано командой: `node scripts/extract-game-texts.mjs`.');
  lines.push('');
  lines.push('- `current` не менять: это исходник для сверки.');
  lines.push('- Новую версию писать в `revised`; если поле пустое, строка остается как есть.');
  lines.push('- Комментарии, сомнения и требования писать в `notes`.');
  lines.push('- Формат блоков рассчитан на вторую итерацию замены текста обратно в исходниках.');
  lines.push('');
  lines.push(`Всего строк: ${entries.length}.`);
  lines.push('');
  lines.push('Крупнейшие источники:');
  lines.push('');
  for (const [file, count] of topFiles) lines.push(`- \`${file}\`: ${count}`);
  lines.push('');

  entries.forEach((entry, index) => {
    const section = sectionFor(entry.file);
    if (section !== lastSection) {
      lines.push(`## ${section}`);
      lines.push('');
      lastSection = section;
    }
    const id = `GT-${String(index + 1).padStart(5, '0')}`;
    lines.push(`### ${id}`);
    lines.push(`source: \`${entry.file}:${entry.line}:${entry.col}\``);
    lines.push(`kind: \`${entry.kind}\``);
    if (entry.key) lines.push(`field: \`${entry.key}\``);
    lines.push(`context: \`${entry.context.replaceAll('`', '\\`')}\``);
    lines.push('current:');
    lines.push('```text');
    lines.push(escapeFence(entry.text));
    lines.push('```');
    lines.push('revised:');
    lines.push('```text');
    lines.push('');
    lines.push('```');
    lines.push('notes:');
    lines.push('```text');
    lines.push('');
    lines.push('```');
    lines.push('');
  });

  fs.writeFileSync(OUT_FILE, `${lines.join('\n')}\n`, 'utf8');
}

export function collectGameTextEntries() {
  return collect();
}

export function writeGameTextInventory(entries = collectGameTextEntries()) {
  writeMarkdown(entries);
  return OUT_FILE;
}

function main() {
  const entries = collectGameTextEntries();
  writeGameTextInventory(entries);
  console.log(`Wrote ${rel(OUT_FILE)} with ${entries.length} text entries.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
