#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const archiveRoot = path.resolve(root, '..', 'gatbage');

function toRel(abs) {
  return path.relative(root, abs).replaceAll(path.sep, '/');
}

function archiveRel(...parts) {
  return toRel(path.join(archiveRoot, ...parts));
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk(srcRoot);
const sourceCache = new Map();
const variableInitializerCache = new Map();
const stringConstantsCache = new Map();
const stringArrayConstantsCache = new Map();
const numberConstantsCache = new Map();
const exportedFunctionEntriesCache = new Map();

function sourceFile(relPath) {
  const abs = path.join(root, relPath);
  let sf = sourceCache.get(abs);
  if (!sf) {
    sf = ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true);
    sourceCache.set(abs, sf);
  }
  return sf;
}

function relExists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function propName(name, constants = new Map()) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    if (ts.isIdentifier(name.expression)) return constants.get(name.expression.text);
    if (ts.isPropertyAccessExpression(name.expression)) return name.expression.name.text;
  }
  return undefined;
}

function stringValue(expr, constants = new Map()) {
  expr = unwrapConstExpression(expr);
  if (!expr) return undefined;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  if (ts.isIdentifier(expr)) return constants.get(expr.text);
  return undefined;
}

function numberValue(expr, constants = new Map()) {
  expr = unwrapConstExpression(expr);
  if (!expr) return undefined;
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  if (ts.isIdentifier(expr)) return constants.get(expr.text);
  return undefined;
}

function unwrapConstExpression(expr) {
  while (
    expr
    && (ts.isAsExpression(expr)
      || ts.isSatisfiesExpression(expr)
      || ts.isParenthesizedExpression(expr)
      || ts.isTypeAssertionExpression(expr))
  ) {
    expr = expr.expression;
  }
  return expr;
}

function forEachNode(sf, cb) {
  function visit(node) {
    cb(node);
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

function variableInitializers(relPath) {
  const sf = sourceFile(relPath);
  const cached = variableInitializerCache.get(sf.fileName);
  if (cached) return cached;
  const initializers = new Map();
  forEachNode(sf, node => {
    if (!ts.isVariableDeclaration(node)) return;
    if (!ts.isIdentifier(node.name)) return;
    initializers.set(node.name.text, node.initializer);
  });
  variableInitializerCache.set(sf.fileName, initializers);
  return initializers;
}

function varInitializer(relPath, name) {
  return variableInitializers(relPath).get(name);
}

function stringConstants(relPath) {
  const sf = sourceFile(relPath);
  const cached = stringConstantsCache.get(sf.fileName);
  if (cached) return cached;
  const constants = new Map();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const text = stringValue(decl.initializer);
      if (text !== undefined) constants.set(decl.name.text, text);
    }
  }
  stringConstantsCache.set(sf.fileName, constants);
  return constants;
}

function stringArrayValues(expr, constants = new Map(), arrayConstants = new Map()) {
  expr = unwrapConstExpression(expr);
  if (!expr) return [];
  const sf = expr.getSourceFile();
  if (ts.isIdentifier(expr)) {
    const values = arrayConstants.get(expr.text);
    return values ? values.map(id => ({ id, line: lineOf(sf, expr) })) : [];
  }
  if (
    ts.isCallExpression(expr)
    && ts.isPropertyAccessExpression(expr.expression)
    && expr.expression.name.text === 'slice'
  ) {
    return stringArrayValues(expr.expression.expression, constants, arrayConstants);
  }
  if (ts.isConditionalExpression(expr)) {
    return [
      ...stringArrayValues(expr.whenTrue, constants, arrayConstants),
      ...stringArrayValues(expr.whenFalse, constants, arrayConstants),
    ];
  }
  if (!ts.isArrayLiteralExpression(expr)) return [];
  const out = [];
  for (const element of expr.elements) {
    if (ts.isSpreadElement(element)) {
      out.push(...stringArrayValues(element.expression, constants, arrayConstants));
      continue;
    }
    const id = stringValue(element, constants);
    if (id) out.push({ id, line: lineOf(sf, element) });
  }
  return out;
}

function stringArrayConstants(relPath) {
  const sf = sourceFile(relPath);
  const cached = stringArrayConstantsCache.get(sf.fileName);
  if (cached) return cached;
  const constants = stringConstants(relPath);
  const arrays = new Map();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const values = stringArrayValues(decl.initializer, constants, arrays).map(v => v.id);
      if (values.length > 0) arrays.set(decl.name.text, values);
    }
  }
  stringArrayConstantsCache.set(sf.fileName, arrays);
  return arrays;
}

function numberConstants(relPath) {
  const sf = sourceFile(relPath);
  const cached = numberConstantsCache.get(sf.fileName);
  if (cached) return cached;
  const constants = new Map();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const value = numberValue(decl.initializer);
      if (value !== undefined) constants.set(decl.name.text, value);
    }
  }
  numberConstantsCache.set(sf.fileName, constants);
  return constants;
}

function objectKeys(relPath, name) {
  const init = varInitializer(relPath, name);
  if (!init || !ts.isObjectLiteralExpression(init)) return [];
  const constants = stringConstants(relPath);
  return init.properties
    .filter(ts.isPropertyAssignment)
    .map(p => ({ id: propName(p.name, constants), file: relPath, line: lineOf(sourceFile(relPath), p) }))
    .filter(v => v.id);
}

function objectKeysInFiles(name) {
  const out = [];
  for (const abs of files) {
    const relPath = toRel(abs);
    const sf = sourceFile(relPath);
    forEachNode(sf, node => {
      if (!ts.isVariableDeclaration(node)) return;
      if (!ts.isIdentifier(node.name) || node.name.text !== name) return;
      if (!node.initializer || !ts.isObjectLiteralExpression(node.initializer)) return;
      const constants = stringConstants(relPath);
      for (const p of node.initializer.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const id = propName(p.name, constants);
        if (id) out.push({ id, file: relPath, line: lineOf(sf, p) });
      }
    });
  }
  return out;
}

function arrayObjects(relPath, name) {
  const init = arrayInitializer(relPath, varInitializer(relPath, name));
  if (!init || !ts.isArrayLiteralExpression(init)) return [];
  const sf = sourceFile(relPath);
  return init.elements
    .filter(ts.isObjectLiteralExpression)
    .map(node => ({ node, line: lineOf(sf, node), file: relPath }));
}

function arrayInitializer(relPath, expr) {
  expr = unwrapConstExpression(expr);
  if (!expr) return undefined;
  if (ts.isArrayLiteralExpression(expr)) return expr;
  if (
    ts.isCallExpression(expr)
    && ts.isPropertyAccessExpression(expr.expression)
    && expr.expression.name.text === 'map'
    && ts.isIdentifier(expr.expression.expression)
  ) {
    return arrayInitializer(relPath, varInitializer(relPath, expr.expression.expression.text));
  }
  return undefined;
}

function getObjectString(obj, key, constants = new Map()) {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) || propName(p.name) !== key) continue;
    return stringValue(p.initializer, constants);
  }
  return undefined;
}

function getObjectNumber(obj, key, constants = new Map()) {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) || propName(p.name) !== key) continue;
    return numberValue(p.initializer, constants);
  }
  return undefined;
}

function getObjectStringArray(obj, key, constants = new Map()) {
  const arrays = stringArrayConstants(toRel(obj.getSourceFile().fileName));
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) || propName(p.name) !== key) continue;
    return stringArrayValues(p.initializer, constants, arrays);
  }
  return [];
}

function getObjectArrayObjects(obj, key) {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) || propName(p.name) !== key) continue;
    const init = unwrapConstExpression(p.initializer);
    if (!init || !ts.isArrayLiteralExpression(init)) return [];
    const sf = p.getSourceFile();
    const out = [];
    for (const element of init.elements) {
      const node = unwrapConstExpression(element);
      if (node && ts.isObjectLiteralExpression(node)) out.push({ node, line: lineOf(sf, node) });
    }
    return out;
  }
  return [];
}

function getObjectProp(obj, key) {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) || propName(p.name) !== key) continue;
    return p.initializer;
  }
  return undefined;
}

function callName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}

function objectArgumentCallName(obj) {
  let node = obj;
  while (
    node.parent
    && (ts.isAsExpression(node.parent)
      || ts.isSatisfiesExpression(node.parent)
      || ts.isParenthesizedExpression(node.parent)
      || ts.isTypeAssertionExpression(node.parent))
  ) {
    node = node.parent;
  }
  if (!node.parent || !ts.isCallExpression(node.parent)) return undefined;
  if (!node.parent.arguments.some(arg => unwrapConstExpression(arg) === obj)) return undefined;
  return callName(node.parent.expression);
}

function constObject(relPath, name) {
  const init = unwrapConstExpression(varInitializer(relPath, name));
  return init && ts.isObjectLiteralExpression(init) ? init : undefined;
}

function arrayIds(relPath, name) {
  const constants = stringConstants(relPath);
  return arrayObjects(relPath, name)
    .map(({ node, line, file }) => ({ id: getObjectString(node, 'id', constants), line, file }))
    .filter(v => v.id);
}

function exportedConstObjectIds(relPath, namePattern) {
  const sf = sourceFile(relPath);
  const constants = stringConstants(relPath);
  const out = [];
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt) || !hasExportModifier(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !namePattern.test(decl.name.text)) continue;
      const init = unwrapConstExpression(decl.initializer);
      if (!init || !ts.isObjectLiteralExpression(init)) continue;
      const id = getObjectString(init, 'id', constants);
      if (id) out.push({ id, name: decl.name.text, file: relPath, line: lineOf(sf, decl) });
    }
  }
  return out;
}

function arrayPropIds(relPath, name, prop) {
  const constants = stringConstants(relPath);
  return arrayObjects(relPath, name)
    .map(({ node, line, file }) => ({ id: getObjectString(node, prop, constants), line, file }))
    .filter(v => v.id);
}

function arrayPropStringRefs(relPath, name, prop) {
  const constants = stringConstants(relPath);
  const out = [];
  for (const entry of arrayObjects(relPath, name)) {
    for (const value of getObjectStringArray(entry.node, prop, constants)) {
      out.push({ id: value.id, file: entry.file, line: value.line });
    }
  }
  return out;
}

function documentedProfileIds(relPath) {
  const abs = path.resolve(root, relPath);
  if (!fs.existsSync(abs)) return null;
  const text = fs.readFileSync(abs, 'utf8');
  const heading = /^## Existing Profiles\s*$/m.exec(text);
  if (!heading) return [];
  const sectionStart = heading.index + heading[0].length;
  const rest = text.slice(sectionStart);
  const nextHeading = /^## /m.exec(rest);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  const out = [];
  const bulletRe = /^-\s+`([^`]+)`/gm;
  let bullet;
  while ((bullet = bulletRe.exec(section)) !== null) {
    const line = text.slice(0, sectionStart + bullet.index).split('\n').length;
    out.push({ id: bullet[1], file: relPath, line });
  }
  return out;
}

function objectStringArrayRefs(relPath, name) {
  const init = varInitializer(relPath, name);
  if (!init || !ts.isObjectLiteralExpression(init)) return [];
  const constants = stringConstants(relPath);
  const arrays = stringArrayConstants(relPath);
  const sf = sourceFile(relPath);
  const out = [];
  for (const p of init.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const key = propName(p.name) ?? '<computed>';
    for (const value of stringArrayValues(p.initializer, constants, arrays)) {
      out.push({ id: value.id, key, file: relPath, line: value.line });
    }
  }
  return out;
}

function topLevelStringArrayEntries(relPath, name) {
  if (!relExists(relPath)) return [];
  const constants = stringConstants(relPath);
  const arrays = stringArrayConstants(relPath);
  return stringArrayValues(varInitializer(relPath, name), constants, arrays)
    .map(value => ({ id: value.id, file: relPath, line: value.line }));
}

function objectRegistryPropertyEntries(relPath, name) {
  if (!relExists(relPath)) return [];
  const init = unwrapConstExpression(varInitializer(relPath, name));
  if (!init || !ts.isObjectLiteralExpression(init)) return [];
  const constants = stringConstants(relPath);
  const sf = sourceFile(relPath);
  const entries = [];
  for (const prop of init.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const id = propName(prop.name, constants);
    if (!id) continue;
    entries.push({
      id,
      file: relPath,
      line: lineOf(sf, prop),
      value: unwrapConstExpression(prop.initializer),
    });
  }
  return entries;
}

function staticCraftVector(expr) {
  expr = unwrapConstExpression(expr);
  if (!expr) return undefined;
  if (ts.isArrayLiteralExpression(expr)) {
    return {
      kind: 'array',
      line: lineOf(expr.getSourceFile(), expr),
      length: expr.elements.length,
      values: expr.elements.map(element => numberValue(element)),
    };
  }
  if (ts.isCallExpression(expr)) {
    const name = callName(expr.expression);
    if (name !== 'cv' && name !== 'craftVector' && name !== 'makeCraftVector') return undefined;
    return {
      kind: 'call',
      line: lineOf(expr.getSourceFile(), expr),
      length: expr.arguments.length,
      values: expr.arguments.map(argument => numberValue(argument)),
    };
  }
  return undefined;
}

function addCraftVectorLiteralErrors(errors, label, file, line, expr) {
  const vector = staticCraftVector(expr);
  if (!vector) return;
  if (vector.kind === 'array' && vector.length !== 9) {
    errors.push(`${file}:${vector.line || line} ${label} material vector must have 9 entries, found ${vector.length}`);
  }
  if (vector.kind === 'call' && vector.length > 9) {
    errors.push(`${file}:${vector.line || line} ${label} material vector call has ${vector.length} args, expected at most 9`);
  }
  let total = 0;
  let hasOnlyStaticNumbers = true;
  vector.values.forEach((value, index) => {
    if (value === undefined) {
      hasOnlyStaticNumbers = false;
      return;
    }
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      errors.push(`${file}:${vector.line || line} ${label}[${index}] must be a finite integer >= 0, found ${value}`);
      hasOnlyStaticNumbers = false;
      return;
    }
    total += value;
  });
  if (hasOnlyStaticNumbers && vector.length <= 9 && total < 1) {
    errors.push(`${file}:${vector.line || line} ${label} material vector total must be at least 1`);
  }
}

function craftRecipeEntries(relPath) {
  if (!relExists(relPath)) return [];
  const constants = stringConstants(relPath);
  const entries = [];
  for (const entry of objectRegistryPropertyEntries(relPath, 'CRAFT_RECIPES')) {
    const value = entry.value;
    const id = value && ts.isObjectLiteralExpression(value)
      ? (getObjectString(value, 'id', constants) ?? entry.id)
      : entry.id;
    entries.push({
      id,
      itemId: value && ts.isObjectLiteralExpression(value) ? getObjectString(value, 'itemId', constants) : undefined,
      station: value && ts.isObjectLiteralExpression(value) ? getObjectString(value, 'station', constants) : undefined,
      components: value && ts.isObjectLiteralExpression(value) ? getObjectProp(value, 'components') : undefined,
      file: entry.file,
      line: entry.line,
    });
  }
  if (entries.length > 0) return entries;
  for (const entry of arrayObjects(relPath, 'CRAFT_RECIPES')) {
    entries.push({
      id: getObjectString(entry.node, 'id', constants),
      itemId: getObjectString(entry.node, 'itemId', constants),
      station: getObjectString(entry.node, 'station', constants),
      components: getObjectProp(entry.node, 'components'),
      file: entry.file,
      line: entry.line,
    });
  }
  return entries.filter(entry => entry.id);
}

function craftRecipeSourceEntries(relPath) {
  if (!relExists(relPath)) return [];
  const constants = stringConstants(relPath);
  const out = [];
  function recipeIdValues(expr) {
    expr = unwrapConstExpression(expr);
    if (!expr) return [];
    const sf = expr.getSourceFile();
    if (!ts.isArrayLiteralExpression(expr)) return stringArrayValues(expr, constants, stringArrayConstants(relPath));
    const refs = [];
    for (const element of expr.elements) {
      const node = unwrapConstExpression(element);
      if (!node) continue;
      if (ts.isSpreadElement(node)) {
        refs.push(...recipeIdValues(node.expression));
        continue;
      }
      const raw = stringValue(node, constants);
      if (raw) {
        refs.push({ id: raw, file: relPath, line: lineOf(sf, node) });
        continue;
      }
      if (ts.isCallExpression(node)) {
        const name = callName(node.expression);
        const itemId = stringValue(node.arguments[0], constants);
        if (itemId && (name === 'r' || name === 'craftItemRecipeId')) {
          refs.push({ id: `craft_item_${itemId}`, file: relPath, line: lineOf(sf, node) });
        }
      }
    }
    return refs;
  }
  for (const entry of arrayObjects(relPath, 'CRAFT_RECIPE_SOURCES')) {
    out.push({
      id: getObjectString(entry.node, 'id', constants),
      kind: getObjectString(entry.node, 'kind', constants),
      recipeIds: recipeIdValues(getObjectProp(entry.node, 'recipeIds')),
      file: entry.file,
      line: entry.line,
    });
  }
  return out.filter(entry => entry.id);
}

function craftInteractiveStationRefs(relPath) {
  if (!relExists(relPath)) return [];
  const constants = stringConstants(relPath);
  const props = new Set(['stationId', 'interactiveId', 'interactiveDefId', 'stationInteractiveId']);
  const refs = [];
  const sf = sourceFile(relPath);
  forEachNode(sf, node => {
    if (!ts.isPropertyAssignment(node)) return;
    const name = propName(node.name);
    if (!name || !props.has(name)) return;
    const id = stringValue(node.initializer, constants);
    if (id) refs.push({ id, prop: name, file: relPath, line: lineOf(sf, node) });
  });
  return refs;
}

function propertyStringArrayRefs(relPath, arrayName, prop) {
  const constants = stringConstants(relPath);
  const arrays = stringArrayConstants(relPath);
  const out = [];
  for (const entry of arrayObjects(relPath, arrayName)) {
    const initializer = getObjectProp(entry.node, prop);
    if (!initializer) continue;
    for (const value of stringArrayValues(initializer, constants, arrays)) {
      out.push({ id: value.id, owner: getObjectString(entry.node, 'id', constants), prop, file: entry.file, line: value.line });
    }
  }
  return out;
}

function nestedRumorIdRefs(relPath) {
  const constants = stringConstants(relPath);
  const arrays = stringArrayConstants(relPath);
  const out = [];
  const sf = sourceFile(relPath);
  forEachNode(sf, node => {
    if (!ts.isPropertyAssignment(node) || propName(node.name) !== 'rumorIds') return;
    for (const value of stringArrayValues(node.initializer, constants, arrays)) {
      out.push({ id: value.id, file: relPath, line: value.line });
    }
  });
  return out;
}

const NPC_PACKAGE_ID_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const NPC_PACKAGE_ENTITY_ID_RE = /\b(?:entity\.id|entityId|liveEntityId|persistentNpcId|alifeId)\b/;
const NPC_PACKAGE_GEOMETRY_LEAK_RE = /\b(1024\s*x\s*1024|1024x1024|toroid(?:al)?|W\s*=|world\.idx|world\.wrap|FloorLevel|route\s*z\s*=|z\s*=\s*[-+]?\d+)\b|тороид|1024 на 1024/i;
const NPC_COMMUNITY_PACKAGE_FILES = new Set(['npc.json', 'sprite.rle.json', 'README.md', 'consent.json']);

function stringLiteralsIn(node) {
  const out = [];
  function visit(child) {
    if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) {
      out.push({ text: child.text, file: toRel(child.getSourceFile().fileName), line: lineOf(child.getSourceFile(), child) });
    }
    ts.forEachChild(child, visit);
  }
  visit(node);
  return out;
}

function getObjectLiteralProp(obj, key) {
  const value = unwrapConstExpression(getObjectProp(obj, key));
  return value && ts.isObjectLiteralExpression(value) ? value : undefined;
}

function getObjectArrayProp(obj, key) {
  const value = unwrapConstExpression(getObjectProp(obj, key));
  return value && ts.isArrayLiteralExpression(value) ? value : undefined;
}

function nestedPackageSocialRefs(obj, constants) {
  const out = [];
  const social = getObjectLiteralProp(obj, 'social');
  const links = social ? getObjectArrayProp(social, 'links') : undefined;
  if (!links) return out;
  for (const element of links.elements) {
    const link = unwrapConstExpression(element);
    if (!link || !ts.isObjectLiteralExpression(link)) continue;
    const id = getObjectString(link, 'targetNpcId', constants);
    if (id) out.push({ id, file: toRel(link.getSourceFile().fileName), line: lineOf(link.getSourceFile(), link) });
  }
  return out;
}

function npcPackageSourceEntries() {
  const packageCallNames = new Set([
    'registerNpcPackage',
    'plotNpcPackage',
  ]);
  const entries = [];
  const refs = [];
  const textRefs = [];
  for (const abs of files) {
    const rel = toRel(abs);
    const sf = sourceFile(rel);
    const constants = stringConstants(rel);
    forEachNode(sf, node => {
      if (!ts.isCallExpression(node)) return;
      const name = callName(node.expression);
      if (!packageCallNames.has(name)) return;
      const arg = unwrapConstExpression(node.arguments[0]);
      if (!arg || !ts.isObjectLiteralExpression(arg)) return;
      const id = getObjectString(arg, 'id', constants);
      entries.push({ id, file: rel, line: lineOf(sf, arg), call: name });
      refs.push(...nestedPackageSocialRefs(arg, constants).map(ref => ({ ...ref, owner: id })));
      for (const literal of stringLiteralsIn(arg)) {
        textRefs.push({ ...literal, owner: id, packageFile: rel, packageLine: lineOf(sf, arg) });
      }
      const raw = arg.getText(sf);
      if (NPC_PACKAGE_ENTITY_ID_RE.test(raw)) {
        entries.push({ id: `__entity_id_leak__:${rel}:${lineOf(sf, arg)}`, file: rel, line: lineOf(sf, arg), entityIdLeak: true, owner: id });
      }
    });
  }
  return { entries, refs, textRefs };
}

function npcCommunityFolderEntries() {
  if (!relExists('src/data/npc_packages/community/index.ts')) return [];
  const constants = stringConstants('src/data/npc_packages/community/index.ts');
  return arrayObjects('src/data/npc_packages/community/index.ts', 'COMMUNITY_NPC_PACKAGE_FOLDERS')
    .map(entry => {
      const npc = getObjectLiteralProp(entry.node, 'npc');
      return {
        ...entry,
        folderName: getObjectString(entry.node, 'folderName', constants),
        npcId: npc ? getObjectString(npc, 'id', constants) : undefined,
        hasNpc: !!npc,
        hasSprite: !!getObjectProp(entry.node, 'spriteRle'),
        hasReadme: !!getObjectProp(entry.node, 'readme'),
        hasConsent: !!getObjectProp(entry.node, 'consent'),
        files: getObjectStringArray(entry.node, 'files', constants),
      };
    });
}

function functionCallsFunction(relPath, functionName, call) {
  if (!relExists(relPath)) return false;
  const sf = sourceFile(relPath);
  let found = false;
  forEachNode(sf, node => {
    if (found) return;
    if (!ts.isFunctionDeclaration(node) || node.name?.text !== functionName) return;
    found = callsIdentifier(node.body ?? node, call);
  });
  return found;
}

function nestedWarningTagRefs(relPath, arrayName) {
  const constants = stringConstants(relPath);
  const out = [];
  function visitReveal(expr, owner, file) {
    expr = unwrapConstExpression(expr);
    if (!expr) return;
    if (ts.isArrayLiteralExpression(expr)) {
      for (const element of expr.elements) visitReveal(element, owner, file);
      return;
    }
    if (!ts.isObjectLiteralExpression(expr)) return;
    const kind = getObjectString(expr, 'kind', constants);
    const tag = getObjectString(expr, 'tag', constants);
    if (kind === 'warning' && tag) out.push({ id: tag, owner, prop: 'reveals.tag', file, line: lineOf(expr.getSourceFile(), expr) });
  }
  for (const entry of arrayObjects(relPath, arrayName)) {
    const owner = getObjectString(entry.node, 'id', constants);
    visitReveal(getObjectProp(entry.node, 'reveals'), owner, entry.file);
  }
  return out;
}

function arrayObjectNestedArrayCount(relPath, arrayName, prop) {
  let total = 0;
  for (const entry of arrayObjects(relPath, arrayName)) {
    const value = unwrapConstExpression(getObjectProp(entry.node, prop));
    if (!value || !ts.isArrayLiteralExpression(value)) continue;
    total += value.elements.filter(ts.isObjectLiteralExpression).length;
  }
  return total;
}

function readmeCountTable() {
  const text = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/.exec(line);
    if (!match) continue;
    const label = match[1].trim();
    const value = match[2].trim();
    if (!label || label === 'Domain' || label === '---') continue;
    out.set(label, value);
  }
  return out;
}

function enumMembers(relPath, name) {
  const sf = sourceFile(relPath);
  const out = [];
  forEachNode(sf, node => {
    if (!ts.isEnumDeclaration(node) || node.name.text !== name) return;
    for (const member of node.members) out.push({ id: propName(member.name), line: lineOf(sf, member) });
  });
  return out;
}

function numberConst(relPath, name) {
  return numberValue(varInitializer(relPath, name));
}

function duplicateIds(entries) {
  const seen = new Map();
  const dupes = [];
  for (const entry of entries) {
    if (!entry.id) continue;
    const previous = seen.get(entry.id);
    if (previous) dupes.push({ id: entry.id, first: previous, second: entry });
    else seen.set(entry.id, entry);
  }
  return dupes;
}

function hasExportModifier(node) {
  return !!node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
}

function identifierName(expr) {
  expr = unwrapConstExpression(expr);
  return expr && ts.isIdentifier(expr) ? expr.text : undefined;
}

function importSpecifierRefs(stmt) {
  const refs = [];
  const clause = stmt.importClause;
  if (!clause || clause.isTypeOnly) return refs;
  if (clause.name) refs.push({ importedName: 'default', localName: clause.name.text, node: clause.name });
  const namedBindings = clause.namedBindings;
  if (!namedBindings || !ts.isNamedImports(namedBindings)) return refs;
  for (const specifier of namedBindings.elements) {
    if (specifier.isTypeOnly) continue;
    refs.push({
      importedName: specifier.propertyName ? specifier.propertyName.text : specifier.name.text,
      localName: specifier.name.text,
      node: specifier,
    });
  }
  return refs;
}

function runnerName(name) {
  return /^(?:generate|spawn|run)[A-Z]/.test(name);
}

function manifestExportRunnerName(name) {
  return /^generate[A-Z]/.test(name)
    || /^run[A-Z].*Content/.test(name)
    || /^spawn[A-Z].*(?:Content|Npcs|Npc)/.test(name);
}

function exportedFunctionEntries(relPath) {
  const sf = sourceFile(relPath);
  const cached = exportedFunctionEntriesCache.get(sf.fileName);
  if (cached) return cached;
  const out = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && hasExportModifier(stmt)) {
      out.push({ name: stmt.name.text, file: relPath, line: lineOf(sf, stmt) });
      continue;
    }
    if (!ts.isVariableStatement(stmt) || !hasExportModifier(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const init = unwrapConstExpression(decl.initializer);
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        out.push({ name: decl.name.text, file: relPath, line: lineOf(sf, decl) });
      }
    }
  }
  exportedFunctionEntriesCache.set(sf.fileName, out);
  return out;
}

function topLevelContentRegistrations(relPath) {
  const sf = sourceFile(relPath);
  const registrations = [];
  const zoneGenerators = [];
  for (const stmt of sf.statements) {
    if (!ts.isExpressionStatement(stmt)) continue;
    const expr = unwrapConstExpression(stmt.expression);
    if (!expr || !ts.isCallExpression(expr) || !ts.isIdentifier(expr.expression)) continue;
    const call = expr.expression.text;
    if (!['registerSideQuest', 'registerFloorSideQuest', 'registerAuthoredNpc', 'registerSideQuestSteps', 'registerZoneContent'].includes(call)) continue;
    registrations.push({ call, file: relPath, line: lineOf(sf, expr) });
    if (call === 'registerZoneContent') {
      const generator = identifierName(expr.arguments[2]);
      if (generator) zoneGenerators.push({ id: generator, file: relPath, line: lineOf(sf, expr.arguments[2]) });
    }
  }
  return { registrations, zoneGenerators };
}

function callsIdentifier(node, name) {
  let found = false;
  function visit(child) {
    if (found) return;
    if (ts.isCallExpression(child) && identifierName(child.expression) === name) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  }
  visit(node);
  return found;
}

function forOfVariableName(node) {
  const init = node.initializer;
  if (ts.isIdentifier(init)) return init.text;
  if (!ts.isVariableDeclarationList(init)) return undefined;
  const decl = init.declarations[0];
  return decl && ts.isIdentifier(decl.name) ? decl.name.text : undefined;
}

function forOfRunnerArray(relPath, expr) {
  expr = unwrapConstExpression(expr);
  if (!expr) return undefined;
  if (ts.isArrayLiteralExpression(expr)) return expr;
  if (ts.isIdentifier(expr)) return arrayInitializer(relPath, varInitializer(relPath, expr.text));
  return undefined;
}

const directCallCache = new Map();
function directCallRefs(relPath, name) {
  const key = `${relPath}\0${name}`;
  const cached = directCallCache.get(key);
  if (cached) return cached;
  const sf = sourceFile(relPath);
  const refs = [];
  forEachNode(sf, node => {
    if (!ts.isCallExpression(node) || identifierName(node.expression) !== name) return;
    refs.push({ file: relPath, line: lineOf(sf, node), kind: 'call' });
  });
  directCallCache.set(key, refs);
  return refs;
}

const manifestInvocationCache = new Map();
function manifestInvocationRefs(relPath, name) {
  const key = `${relPath}\0${name}`;
  const cached = manifestInvocationCache.get(key);
  if (cached) return cached;
  const sf = sourceFile(relPath);
  const refs = [...directCallRefs(relPath, name)];
  if (relPath === 'src/gen/design_floors/manifest.ts') {
    const generatorMap = constObject(relPath, 'DESIGN_FLOOR_GENERATORS');
    if (generatorMap) {
      for (const p of generatorMap.properties) {
        if (!ts.isPropertyAssignment(p) || identifierName(p.initializer) !== name) continue;
        refs.push({ file: relPath, line: lineOf(sf, p.initializer), kind: 'generator map' });
      }
    }
  }
  forEachNode(sf, node => {
    if (!ts.isForOfStatement(node)) return;
    const loopVar = forOfVariableName(node);
    if (!loopVar || !callsIdentifier(node.statement, loopVar)) return;
    const arr = forOfRunnerArray(relPath, node.expression);
    if (!arr) return;
    for (const element of arr.elements) {
      if (identifierName(element) !== name) continue;
      refs.push({ file: relPath, line: lineOf(sf, element), kind: 'ordered runner list' });
    }
  });
  refs.sort((a, b) => a.line - b.line);
  manifestInvocationCache.set(key, refs);
  return refs;
}

function resolveImport(fromAbs, spec) {
  if (!spec.startsWith('.')) return undefined;
  const base = path.resolve(path.dirname(fromAbs), spec);
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const importIncoming = new Map();
const importIncomingDeclRefs = new Map();
const importIncomingNamedRefs = new Map();
const manifestEntries = new Map();
const manifestImportRefs = [];
const manifestImportBindings = [];
const manifestRunnerImportRefs = [];
for (const abs of files) {
  const relPath = toRel(abs);
  const sf = sourceFile(relPath);
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const spec = stringValue(stmt.moduleSpecifier);
    if (!spec) continue;
    const target = resolveImport(abs, spec);
    if (target) {
      const relTarget = toRel(target);
      if (!importIncoming.has(relTarget)) importIncoming.set(relTarget, new Set());
      importIncoming.get(relTarget).add(relPath);
      if (!importIncomingDeclRefs.has(relTarget)) importIncomingDeclRefs.set(relTarget, []);
      importIncomingDeclRefs.get(relTarget).push({
        file: relPath,
        line: lineOf(sf, stmt),
        spec,
        sideEffect: !stmt.importClause,
      });
      for (const named of importSpecifierRefs(stmt)) {
        if (!importIncomingNamedRefs.has(relTarget)) importIncomingNamedRefs.set(relTarget, []);
        importIncomingNamedRefs.get(relTarget).push({
          importedName: named.importedName,
          localName: named.localName,
          file: relPath,
          line: lineOf(sf, named.node),
          spec,
        });
      }
    }
    if (abs.endsWith('/content_manifest.ts') && target) {
      const targetRel = toRel(target);
      for (const named of importSpecifierRefs(stmt)) {
        if (!runnerName(named.localName) && !runnerName(named.importedName)) continue;
        manifestRunnerImportRefs.push({
          target: targetRel,
          importedName: named.importedName,
          localName: named.localName,
          file: relPath,
          line: lineOf(sf, named.node),
          spec,
        });
        manifestImportBindings.push({
          target: targetRel,
          imported: named.importedName,
          local: named.localName,
          file: relPath,
          line: lineOf(sf, named.node),
        });
      }
    }
    if (abs.endsWith('/content_manifest.ts') && spec.startsWith('./')) {
      const floor = path.basename(path.dirname(abs));
      const rel = target ? toRel(target) : `${toRel(path.dirname(abs))}/${spec}`;
      if (!manifestEntries.has(floor)) manifestEntries.set(floor, []);
      manifestEntries.get(floor).push(rel);
      manifestImportRefs.push({
        floor,
        spec,
        target: target ? toRel(target) : undefined,
        file: relPath,
        line: lineOf(sf, stmt),
        sideEffect: !stmt.importClause,
      });
    } else if (relPath === 'src/gen/design_floors/manifest.ts' && target && spec.startsWith('./')) {
      for (const named of importSpecifierRefs(stmt)) {
        manifestImportBindings.push({
          target: toRel(target),
          imported: named.importedName,
          local: named.localName,
          file: relPath,
          line: lineOf(sf, named.node),
        });
      }
    }
  }
}

const sideQuestNpcEntries = [];
const sideQuestEntries = [];
const zoneEntries = [];
const itemRefs = [];
const interactiveRefs = [];
const npcRefs = [];
const rewardTableRefs = [];
const directItemCallRefs = [];
const directInteractiveCallRefs = [];

const knownItemProps = new Set(['targetItem', 'rewardItem', 'itemId', 'sampleId']);
const knownNpcProps = new Set(['giverNpcId', 'targetNpcId', 'targetPlotNpcId']);
const directItemCallNames = new Set(['addItem', 'addItemDrop', 'dropItem']);
const directInteractiveCallNames = new Set(['placeInteractiveAt', 'placeInteractiveInRoom']);

for (const abs of files) {
  const rel = toRel(abs);
  const sf = sourceFile(rel);
  const numberConstants = new Map();
  const stringConstants = new Map();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        const value = numberValue(decl.initializer);
        if (value !== undefined) numberConstants.set(decl.name.text, value);
        const text = stringValue(decl.initializer);
        if (text !== undefined) stringConstants.set(decl.name.text, text);
      }
    }
  }
  forEachNode(sf, node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'registerSideQuest' || node.expression.text === 'registerFloorSideQuest') {
        const npcArgIndex = node.expression.text === 'registerFloorSideQuest' ? 1 : 0;
        const questArgIndex = node.expression.text === 'registerFloorSideQuest' ? 3 : 2;
        const npcId = stringValue(node.arguments[npcArgIndex], stringConstants);
        if (npcId) sideQuestNpcEntries.push({ id: npcId, file: rel, line: lineOf(sf, node) });
        const questArg = node.arguments[questArgIndex];
        if (questArg && ts.isArrayLiteralExpression(questArg)) {
          for (const element of questArg.elements) {
            if (!ts.isObjectLiteralExpression(element)) continue;
            sideQuestEntries.push({
              id: getObjectString(element, 'id', stringConstants),
              file: rel,
              line: lineOf(sf, element),
            });
          }
        }
      }
      if (node.expression.text === 'registerAuthoredNpc') {
        const packArg = unwrapConstExpression(node.arguments[0]);
        if (packArg && ts.isObjectLiteralExpression(packArg)) {
          const npcId = getObjectString(packArg, 'id', stringConstants);
          if (npcId) sideQuestNpcEntries.push({ id: npcId, file: rel, line: lineOf(sf, node) });
          const questArg = unwrapConstExpression(getObjectProp(packArg, 'quests'));
          if (questArg && ts.isArrayLiteralExpression(questArg)) {
            for (const element of questArg.elements) {
              if (!ts.isObjectLiteralExpression(element)) continue;
              sideQuestEntries.push({
                id: getObjectString(element, 'id', stringConstants),
                file: rel,
                line: lineOf(sf, element),
              });
            }
          }
        }
      }
      if (node.expression.text === 'registerZoneContent') {
        const zoneId = numberValue(node.arguments[0], numberConstants);
        const labelArg = node.arguments[1];
        const label = stringValue(labelArg)
          ?? (labelArg && ts.isIdentifier(labelArg) ? stringConstants.get(labelArg.text) : undefined);
        zoneEntries.push({ id: zoneId === undefined ? undefined : String(zoneId), label, file: rel, line: lineOf(sf, node) });
      }
      if (directItemCallNames.has(node.expression.text) && (rel.startsWith('src/gen/') || rel.startsWith('src/systems/'))) {
        for (const arg of node.arguments) {
          const id = stringValue(arg, stringConstants);
          if (id === undefined) continue;
          directItemCallRefs.push({ id, call: node.expression.text, file: rel, line: lineOf(sf, arg) });
          break;
        }
      }
      if (directInteractiveCallNames.has(node.expression.text) && (rel.startsWith('src/gen/') || rel.startsWith('src/systems/'))) {
        const argIndex = node.expression.text === 'placeInteractiveInRoom' ? 2 : 3;
        const id = stringValue(node.arguments[argIndex], stringConstants);
        if (id !== undefined) {
          directInteractiveCallRefs.push({ id, call: node.expression.text, file: rel, line: lineOf(sf, node.arguments[argIndex]) });
        }
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const name = propName(node.name);
      const value = stringValue(node.initializer, stringConstants);
      if (value && name === 'defId') {
        const owner = node.parent;
        if (
          (owner && ts.isObjectLiteralExpression(owner) && objectArgumentCallName(owner) === 'placeInteractive')
          || rel === 'src/data/interactive.ts'
          || rel === 'src/gen/craft_stations.ts'
        ) {
          interactiveRefs.push({ id: value, prop: name, file: rel, line: lineOf(sf, node) });
        } else {
          itemRefs.push({ id: value, prop: name, file: rel, line: lineOf(sf, node) });
        }
      }
      if (value && knownItemProps.has(name)) itemRefs.push({ id: value, prop: name, file: rel, line: lineOf(sf, node) });
      if (value && knownNpcProps.has(name)) npcRefs.push({ id: value, prop: name, file: rel, line: lineOf(sf, node) });
      if (name === 'rewardTable' && ts.isArrayLiteralExpression(node.initializer)) {
        for (const item of node.initializer.elements) {
          const id = stringValue(item, stringConstants);
          if (id) rewardTableRefs.push({ id, prop: 'rewardTable', file: rel, line: lineOf(sf, item) });
        }
      }
      if (name === 'plotNpcs' && ts.isArrayLiteralExpression(node.initializer)) {
        for (const item of node.initializer.elements) {
          const id = stringValue(item, stringConstants);
          if (id) npcRefs.push({ id, prop: 'plotNpcs', file: rel, line: lineOf(sf, item) });
        }
      }
    }
  });
}

const itemEntries = [
  ...objectKeys('src/data/items.ts', 'ITEMS'),
  ...objectKeys('src/data/chernobog_docket.ts', 'CHERNOBOG_DOCKET_ITEMS'),
  ...objectKeys('src/data/documents_access.ts', 'DOCUMENT_ACCESS_ITEMS'),
];
const localNpcDefEntries = objectKeysInFiles('NPC_DEFS');
const plotNpcEntries = sideQuestNpcEntries;
const contractEntries = arrayIds('src/data/contracts.ts', 'CONTRACTS');
const rumorEntries = arrayIds('src/data/rumors.ts', 'RUMORS');
const slimeEntries = arrayIds('src/data/slime_defs.ts', 'SLIME_DEFS');
const slimeSampleEntries = arrayPropIds('src/data/slime_defs.ts', 'SLIME_DEFS', 'sampleId');
const slimeTextHandleRefs = arrayPropStringRefs('src/data/slime_defs.ts', 'SLIME_DEFS', 'textHandles');
const zhelemishEntries = arrayPropIds('src/data/zhelemish_defs.ts', 'ZHELEMISH_DEFS', 'itemId');
const interactiveEntries = arrayIds('src/data/interactive.ts', 'INTERACTIVE_DEFS');
const floorGeometryEntries = arrayIds('src/data/procedural_floors.ts', 'FLOOR_GEOMETRIES');
const floorMajorityEntries = arrayIds('src/data/procedural_floors.ts', 'FLOOR_MAJORITY_FACTIONS');
const floorAnomalyEntries = arrayIds('src/data/procedural_floors.ts', 'FLOOR_ANOMALIES');
const floorGeometryDocPath = archiveRel('reference/procedural_floors/geometry.md');
const floorAnomalyDocPath = archiveRel('reference/procedural_floors/anomaly.md');
const floorGeometryDocEntries = documentedProfileIds(floorGeometryDocPath);
const floorAnomalyDocEntries = documentedProfileIds(floorAnomalyDocPath);
const proceduralLootRefs = objectStringArrayRefs('src/data/procedural_floors.ts', 'LOOT_BY_TAG');
const monsterKindEntries = enumMembers('src/core/types.ts', 'MonsterKind');
const worldEventTypeEntries = arrayInitializer('src/core/types.ts', varInitializer('src/core/types.ts', 'WORLD_EVENT_TYPES'))?.elements
  .map(node => ({ id: stringValue(node), file: 'src/core/types.ts', line: lineOf(sourceFile('src/core/types.ts'), node) }))
  .filter(v => v.id) ?? [];
const monsterRegistryEntries = objectKeys('src/entities/monster.ts', 'MONSTERS');
const monsterEcologyEntries = arrayObjects('src/data/monster_ecology.ts', 'MONSTER_ECOLOGY');
const plotChainEntries = arrayObjects('src/data/plot.ts', 'PLOT_CHAIN');
const designFloorRouteEntries = arrayIds('src/data/design_floors.ts', 'DESIGN_FLOOR_ROUTES');
const designFloorGeneratorEntries = objectKeys('src/gen/design_floors/manifest.ts', 'DESIGN_FLOOR_GENERATORS');
const populationProfileEntries = exportedConstObjectIds('src/data/population_profiles.ts', /_POPULATION_PROFILE$/);
const screenSignalEntries = arrayIds('src/data/screen_signals.ts', 'SCREEN_SIGNAL_DEFS');
const screenSignalEventTypeRefs = propertyStringArrayRefs('src/data/screen_signals.ts', 'SCREEN_SIGNAL_DEFS', 'eventTypes');
const screenSignalTagRefs = propertyStringArrayRefs('src/data/screen_signals.ts', 'SCREEN_SIGNAL_DEFS', 'tags');
const permitEntries = arrayIds('src/data/permits.ts', 'PERMIT_DEFS');
const permitItemRefs = arrayPropIds('src/data/permits.ts', 'PERMIT_DEFS', 'itemId');
const permitForgeryEntries = arrayIds('src/data/permits.ts', 'PERMIT_FORGERY_RECIPES');
const permitForgeryOutputRefs = arrayPropIds('src/data/permits.ts', 'PERMIT_FORGERY_RECIPES', 'outputItemId');
const permitForgeryInputRefs = propertyStringArrayRefs('src/data/permits.ts', 'PERMIT_FORGERY_RECIPES', 'inputItemIds');
const permitForgeryEventTagRefs = propertyStringArrayRefs('src/data/permits.ts', 'PERMIT_FORGERY_RECIPES', 'eventTags');
const computerEntries = objectKeys('src/data/computers.ts', 'COMPUTER_DEFS');
const netHackTerminalEntries = objectKeys('src/data/net_hack.ts', 'NET_HACK_TERMINALS');
const emergencyPanelEntries = arrayIds('src/data/emergency_panels.ts', 'EMERGENCY_PANEL_DEFS');
const contractTagRefs = propertyStringArrayRefs('src/data/contracts.ts', 'CONTRACTS', 'tags');
const contractRewardResourceRefs = arrayPropIds('src/data/contracts.ts', 'CONTRACTS', 'rewardResourceId');
const sideQuestTagRefs = propertyStringArrayRefs('src/data/plot.ts', 'SIDE_QUESTS', 'eventTags');
const rumorWarningTagRefs = nestedWarningTagRefs('src/data/rumors.ts', 'RUMORS');
const nestedRumorRefs = [];
for (const abs of files) {
  const rel = toRel(abs);
  if (!/^src\/(data|gen|systems)\//.test(rel)) continue;
  nestedRumorRefs.push(...nestedRumorIdRefs(rel));
}
const npcPackageScan = npcPackageSourceEntries();
const npcPackageEntries = npcPackageScan.entries.filter(entry => !entry.entityIdLeak);
const npcPackageEntityIdLeaks = npcPackageScan.entries.filter(entry => entry.entityIdLeak);
const mainPlotNpcPackageEntries = npcPackageEntries.filter(entry => entry.call === 'plotNpcPackage');
const npcCommunityFolderEntriesList = npcCommunityFolderEntries();
const resourceEntries = arrayIds('src/data/resources.ts', 'RESOURCES');
const caravanEntries = arrayIds('src/data/caravans.ts', 'CARAVAN_LANES');
const factoryEntries = arrayIds('src/data/factories.ts', 'FACTORIES');
const factoryRecipeCount = arrayObjectNestedArrayCount('src/data/factories.ts', 'FACTORIES', 'recipes');
const physWeaponEntries = objectKeys('src/data/weapons.ts', 'PHYS_WEAPON_STATS');
const psiWeaponEntries = objectKeys('src/data/psi.ts', 'PSI_WEAPON_STATS');
const samosborVariantEntries = arrayIds('src/data/samosbor_variants.ts', 'SAMOSBOR_VARIANTS');
const samosborModifierEntries = objectKeys('src/data/samosbor_variants.ts', 'SAMOSBOR_MODIFIERS');
const samosborAftermathEntries = arrayIds('src/data/samosbor_variants.ts', 'SAMOSBOR_AFTERMATH_BEATS');
const samosborDirectorEntries = arrayIds('src/data/samosbor_director.ts', 'BASELINE_BEATS');
const craftRequiredPaths = [
  'src/data/craft_materials.ts',
  'src/data/item_composition.ts',
  'src/data/craft_recipes.ts',
  'src/data/craft_recipe_sources.ts',
];
const craftMaterialEntries = topLevelStringArrayEntries('src/data/craft_materials.ts', 'CRAFT_MATERIAL_IDS');
const itemCompositionEntries = objectRegistryPropertyEntries('src/data/item_composition.ts', 'ITEM_COMPOSITIONS');
const craftRecipeEntriesList = craftRecipeEntries('src/data/craft_recipes.ts');
const craftRecipeSourceEntriesList = craftRecipeSourceEntries('src/data/craft_recipe_sources.ts');
const craftInteractiveRefs = [
  ...craftInteractiveStationRefs('src/data/craft_recipes.ts'),
  ...craftInteractiveStationRefs('src/data/craft_recipe_sources.ts'),
];
const itemCompositionText = relExists('src/data/item_composition.ts')
  ? fs.readFileSync(path.join(root, 'src/data/item_composition.ts'), 'utf8')
  : '';
const craftRecipeText = relExists('src/data/craft_recipes.ts')
  ? fs.readFileSync(path.join(root, 'src/data/craft_recipes.ts'), 'utf8')
  : '';
const itemCompositionRegistryCoversAllItems = /Object\.values\(ITEMS\)\.map\(def\s*=>\s*\[def\.id,\s*compositionForItemDef\(def\)\]\)/s.test(itemCompositionText);
const craftRecipeRegistryCoversAllItems = /Object\.values\(ITEMS\)\.map\(def\s*=>/s.test(craftRecipeText) && /recipeForItem\(def\)/.test(craftRecipeText);
const itemCompositionCount = itemCompositionRegistryCoversAllItems ? itemEntries.length : itemCompositionEntries.length;
const craftRecipeCount = craftRecipeRegistryCoversAllItems ? itemEntries.length : craftRecipeEntriesList.length;

const itemIds = new Set(itemEntries.map(v => v.id));
const interactiveIds = new Set(interactiveEntries.map(v => v.id));
const questTargetItemIds = new Set([...itemIds, 'money']);
const itemOrMoneyIds = new Set([...itemIds, 'money']);
const plotNpcIds = new Set([...mainPlotNpcPackageEntries, ...plotNpcEntries, ...localNpcDefEntries].map(v => v.id));
const rumorIds = new Set(rumorEntries.map(v => v.id));
const resourceIds = new Set(resourceEntries.map(v => v.id));
const worldEventTypes = new Set(worldEventTypeEntries.map(v => v.id));
const craftRecipeIds = new Set([
  ...craftRecipeEntriesList.map(v => v.id),
  ...(craftRecipeRegistryCoversAllItems ? itemEntries.map(v => `craft_item_${v.id}`) : []),
]);

const errors = [];
function addDuplicateErrors(label, entries) {
  for (const d of duplicateIds(entries)) {
    errors.push(`${label} duplicate "${d.id}" at ${d.second.file ?? ''}:${d.second.line}; first at ${d.first.file ?? ''}:${d.first.line}`);
  }
}

function addTerritoryArchitectureErrors() {
  const zoneFactionRuntimeAllowlist = new Set([
    'src/systems/territory.ts',
  ]);
  const factionControlWriteAllowlist = new Set([
    'src/systems/territory.ts',
  ]);
  for (const abs of files) {
    const rel = toRel(abs);
    if (!rel.startsWith('src/systems/')) continue;
    const text = fs.readFileSync(abs, 'utf8');
    if (!zoneFactionRuntimeAllowlist.has(rel)) {
      const zoneFactionRe = /\bzone(?:\?\.|\.)faction\b/g;
      let match;
      while ((match = zoneFactionRe.exec(text)) !== null) {
        errors.push(`${rel}:${lineNumberAt(text, match.index)} runtime system reads zone.faction; use territoryOwnerAt/territoryRoomOwner/currentTerritoryZoneId unless this file is metadata sync`);
      }
    }
    if (!factionControlWriteAllowlist.has(rel)) {
      const factionControlWriteRe = /\bfactionControl\s*\[[^\]]+\]\s*=(?!=)/g;
      let match;
      while ((match = factionControlWriteRe.exec(text)) !== null) {
        errors.push(`${rel}:${lineNumberAt(text, match.index)} writes factionControl directly; use territory.ts helpers so ownership and zone metadata stay synchronized`);
      }
    }
  }
}

function addDocProfileSyncErrors(label, sourceEntries, docEntries, docPath) {
  if (docEntries === null) return;
  if (docEntries.length === 0) {
    errors.push(`${docPath} missing Existing Profiles ${label} list`);
    return;
  }
  const sourceIds = sourceEntries.map(v => v.id);
  const docIds = docEntries.map(v => v.id);
  const sourceSet = new Set(sourceIds);
  const docSet = new Set(docIds);
  for (const source of sourceEntries) {
    if (!docSet.has(source.id)) errors.push(`${docPath} missing ${label} "${source.id}" from ${source.file}:${source.line}`);
  }
  for (const doc of docEntries) {
    if (!sourceSet.has(doc.id)) errors.push(`${doc.file}:${doc.line} documents unknown ${label} "${doc.id}"`);
  }
  if (
    sourceIds.length === docIds.length &&
    sourceIds.every(id => docSet.has(id)) &&
    docIds.some((id, i) => id !== sourceIds[i])
  ) {
    errors.push(`${docPath} ${label} order differs from source: expected ${sourceIds.join(', ')}`);
  }
}

addDuplicateErrors('ITEMS', itemEntries);
addDuplicateErrors('NPC_PACKAGES/registerSideQuest', [...mainPlotNpcPackageEntries, ...plotNpcEntries]);
addDuplicateErrors('SIDE_QUESTS', sideQuestEntries);
addDuplicateErrors('CONTRACTS', contractEntries);
addDuplicateErrors('RUMORS', rumorEntries);
addDuplicateErrors('SLIME_DEFS', slimeEntries);
addDuplicateErrors('SLIME sample ids', slimeSampleEntries);
addDuplicateErrors('ZHELEMISH_DEFS', zhelemishEntries);
addDuplicateErrors('FLOOR_GEOMETRIES', floorGeometryEntries);
addDuplicateErrors('FLOOR_MAJORITY_FACTIONS', floorMajorityEntries);
addDuplicateErrors('FLOOR_ANOMALIES', floorAnomalyEntries);
if (floorGeometryDocEntries) addDuplicateErrors('Docs procedural geometry profiles', floorGeometryDocEntries);
if (floorAnomalyDocEntries) addDuplicateErrors('Docs procedural anomaly profiles', floorAnomalyDocEntries);
addDuplicateErrors('DESIGN_FLOOR_ROUTES', designFloorRouteEntries);
addDuplicateErrors('DESIGN_FLOOR_GENERATORS', designFloorGeneratorEntries);
addDuplicateErrors('POPULATION_PROFILES', populationProfileEntries);
addDuplicateErrors('WORLD_EVENT_TYPES', worldEventTypeEntries);
addDuplicateErrors('SCREEN_SIGNAL_DEFS', screenSignalEntries);
addDuplicateErrors('PERMIT_DEFS', permitEntries);
addDuplicateErrors('PERMIT_FORGERY_RECIPES', permitForgeryEntries);
addDuplicateErrors('COMPUTER_DEFS', computerEntries);
addDuplicateErrors('NET_HACK_TERMINALS', netHackTerminalEntries);
addDuplicateErrors('EMERGENCY_PANEL_DEFS', emergencyPanelEntries);
addDuplicateErrors('RESOURCES', resourceEntries);
addDuplicateErrors('CARAVAN_LANES', caravanEntries);
addDuplicateErrors('FACTORIES', factoryEntries);
addDuplicateErrors('SAMOSBOR_VARIANTS', samosborVariantEntries);
addDuplicateErrors('SAMOSBOR_MODIFIERS', samosborModifierEntries);
addDuplicateErrors('SAMOSBOR_AFTERMATH_BEATS', samosborAftermathEntries);
addDuplicateErrors('SAMOSBOR_DIRECTOR_BEATS', samosborDirectorEntries);
addDuplicateErrors('LIVING zone content', zoneEntries.filter(v => v.file.includes('/living/')));
addDuplicateErrors('CRAFT_MATERIAL_IDS', craftMaterialEntries);
addDuplicateErrors('ITEM_COMPOSITIONS', itemCompositionEntries);
addDuplicateErrors('CRAFT_RECIPES', craftRecipeEntriesList);
addDuplicateErrors('CRAFT_RECIPE_SOURCES', craftRecipeSourceEntriesList);
addDuplicateErrors('NPC_PACKAGES', npcPackageEntries);

const npcPackageIds = new Set(npcPackageEntries.map(entry => entry.id).filter(Boolean));
for (const pack of npcPackageEntries) {
  if (!pack.id) {
    errors.push(`${pack.file}:${pack.line} NPC package source through ${pack.call} must use a static id`);
    continue;
  }
  if (!NPC_PACKAGE_ID_RE.test(pack.id)) {
    errors.push(`${pack.file}:${pack.line} NPC package id "${pack.id}" is not lowercase snake_case`);
  }
}
for (const leak of npcPackageEntityIdLeaks) {
  errors.push(`${leak.file}:${leak.line} NPC package "${leak.owner ?? '<unknown>'}" mentions live entity id state`);
}
for (const ref of npcPackageScan.refs) {
  if (!npcPackageIds.has(ref.id)) {
    errors.push(`${ref.file}:${ref.line} NPC package "${ref.owner ?? '<unknown>'}" social link references missing package "${ref.id}"`);
  }
}
for (const text of npcPackageScan.textRefs) {
  if (text.text.length > 520) {
    errors.push(`${text.file}:${text.line} NPC package "${text.owner ?? '<unknown>'}" authored text exceeds 520 chars`);
  }
  if (NPC_PACKAGE_GEOMETRY_LEAK_RE.test(text.text)) {
    errors.push(`${text.file}:${text.line} NPC package "${text.owner ?? '<unknown>'}" public/community text leaks implementation geometry`);
  }
}
if (!functionCallsFunction('src/data/plot.ts', 'registerSideQuest', 'registerNpcPackageFromPlotNpc')) {
  errors.push('src/data/plot.ts:1 registerSideQuest must register an NPC package for authored NPC data');
}
for (const folder of npcCommunityFolderEntriesList) {
  if (!folder.folderName) errors.push(`${folder.file}:${folder.line} community NPC folder must use static folderName`);
  if (!folder.hasNpc) errors.push(`${folder.file}:${folder.line} community NPC folder "${folder.folderName ?? '<unknown>'}" missing npc package object`);
  if (!folder.hasSprite) errors.push(`${folder.file}:${folder.line} community NPC folder "${folder.folderName ?? '<unknown>'}" missing spriteRle`);
  if (!folder.hasReadme) errors.push(`${folder.file}:${folder.line} community NPC folder "${folder.folderName ?? '<unknown>'}" missing readme`);
  if (!folder.hasConsent) errors.push(`${folder.file}:${folder.line} community NPC folder "${folder.folderName ?? '<unknown>'}" missing consent`);
  if (folder.folderName && folder.npcId && folder.folderName !== folder.npcId) {
    errors.push(`${folder.file}:${folder.line} community NPC folder "${folder.folderName}" must equal npc package id "${folder.npcId}"`);
  }
  for (const file of folder.files) {
    if (!NPC_COMMUNITY_PACKAGE_FILES.has(file.id)) {
      errors.push(`${file.file}:${file.line} community NPC folder "${folder.folderName ?? '<unknown>'}" includes non-runtime file "${file.id}"`);
    }
  }
}

addTerritoryArchitectureErrors();

addDocProfileSyncErrors('procedural geometry profile', floorGeometryEntries, floorGeometryDocEntries, floorGeometryDocPath);
addDocProfileSyncErrors('procedural anomaly profile', floorAnomalyEntries, floorAnomalyDocEntries, floorAnomalyDocPath);

for (const relPath of craftRequiredPaths) {
  if (!relExists(relPath)) errors.push(`${relPath}:1 missing required crafting data module`);
}

if (relExists('src/data/craft_materials.ts') && craftMaterialEntries.length !== 9) {
  errors.push(`src/data/craft_materials.ts:1 CRAFT_MATERIAL_IDS must contain exactly 9 ids, found ${craftMaterialEntries.length}`);
}
const expectedCraftMaterialIds = [
  'mechanics',
  'electronics',
  'consumables',
  'bio',
  'chemical',
  'metal',
  'cybernetics',
  'psimatter',
  'metamatter',
];
const craftMaterialIds = craftMaterialEntries.map(entry => entry.id);
if (
  relExists('src/data/craft_materials.ts')
  && craftMaterialIds.length === expectedCraftMaterialIds.length
  && craftMaterialIds.some((id, index) => id !== expectedCraftMaterialIds[index])
) {
  errors.push(`src/data/craft_materials.ts:1 CRAFT_MATERIAL_IDS order must be ${expectedCraftMaterialIds.join(', ')}`);
}

if (relExists('src/data/item_composition.ts')) {
  const compositionIds = new Set(itemCompositionEntries.map(entry => entry.id));
  if (!itemCompositionRegistryCoversAllItems) {
    for (const item of itemEntries) {
      if (!compositionIds.has(item.id)) errors.push(`src/data/item_composition.ts:1 ITEM_COMPOSITIONS missing item "${item.id}"`);
    }
  }
  for (const entry of itemCompositionEntries) {
    if (!itemIds.has(entry.id)) errors.push(`${entry.file}:${entry.line} ITEM_COMPOSITIONS references missing item "${entry.id}"`);
    addCraftVectorLiteralErrors(errors, `ITEM_COMPOSITIONS.${entry.id}`, entry.file, entry.line, entry.value);
  }
  const sf = sourceFile('src/data/item_composition.ts');
  forEachNode(sf, node => {
    if (!ts.isCallExpression(node) || !staticCraftVector(node)) return;
    addCraftVectorLiteralErrors(errors, 'item composition craft vector literal', 'src/data/item_composition.ts', lineOf(sf, node), node);
  });
}

if (relExists('src/data/craft_recipes.ts')) {
  for (const recipe of craftRecipeEntriesList) {
    if (!recipe.itemId) {
      errors.push(`${recipe.file}:${recipe.line} CRAFT_RECIPES.${recipe.id} missing itemId`);
    } else if (!itemIds.has(recipe.itemId)) {
      errors.push(`${recipe.file}:${recipe.line} CRAFT_RECIPES.${recipe.id}.itemId references missing item "${recipe.itemId}"`);
    }
    if (recipe.components) {
      addCraftVectorLiteralErrors(errors, `CRAFT_RECIPES.${recipe.id}.components`, recipe.file, recipe.line, recipe.components);
    }
  }
}

if (relExists('src/data/craft_recipe_sources.ts')) {
  for (const source of craftRecipeSourceEntriesList) {
    if (source.recipeIds.length === 0) {
      errors.push(`${source.file}:${source.line} CRAFT_RECIPE_SOURCES.${source.id} must reference at least one recipe id`);
    }
    for (const ref of source.recipeIds) {
      if (!craftRecipeIds.has(ref.id)) {
        errors.push(`${ref.file}:${ref.line} CRAFT_RECIPE_SOURCES.${source.id}.recipeIds references missing recipe "${ref.id}"`);
      }
    }
  }
}

for (const ref of craftInteractiveRefs) {
  if (!interactiveIds.has(ref.id)) errors.push(`${ref.file}:${ref.line} ${ref.prop} references missing interactive "${ref.id}"`);
}

const designFloorGeneratorIds = new Set(designFloorGeneratorEntries.map(v => v.id));
for (const route of designFloorRouteEntries) {
  if (!designFloorGeneratorIds.has(route.id)) errors.push(`${route.file}:${route.line} design floor route "${route.id}" has no generator`);
}
const designFloorRouteIds = new Set(designFloorRouteEntries.map(v => v.id));
for (const generator of designFloorGeneratorEntries) {
  if (!designFloorRouteIds.has(generator.id)) errors.push(`${generator.file}:${generator.line} design floor generator "${generator.id}" has no route`);
}

const contentManifestPaths = files
  .map(toRel)
  .filter(rel => /^src\/gen\/[^/]+\/content_manifest\.ts$/.test(rel))
  .sort();
const manifestRunnerExports = contentManifestPaths.flatMap(rel => (
  exportedFunctionEntries(rel).filter(entry => manifestExportRunnerName(entry.name))
));

function location(ref) {
  return `${ref.file}:${ref.line}`;
}

function ownerLocation(ref) {
  const owner = exportedFunctionEntries(ref.target).find(entry => entry.name === ref.importedName);
  return owner ? `${owner.file}:${owner.line}` : `${ref.target}:?`;
}

const manifestImportTargets = new Map();
for (const ref of manifestImportRefs) {
  if (!ref.target) continue;
  const sameManifestKey = `${ref.file}\0${ref.target}`;
  const previousInManifest = manifestImportTargets.get(sameManifestKey);
  if (previousInManifest) {
    errors.push(`${ref.file}:${ref.line} duplicate manifest import "${ref.spec}" resolves to ${ref.target}; first at ${previousInManifest.file}:${previousInManifest.line}`);
  } else {
    manifestImportTargets.set(sameManifestKey, ref);
  }
}

const manifestImportTargetOwners = new Map();
for (const ref of manifestImportRefs) {
  if (!ref.target) continue;
  const previous = manifestImportTargetOwners.get(ref.target);
  if (previous && previous.file !== ref.file) {
    errors.push(`${ref.file}:${ref.line} manifest import "${ref.spec}" duplicates ${ref.target}; first manifest owner ${previous.file}:${previous.line}`);
  } else if (!previous) {
    manifestImportTargetOwners.set(ref.target, ref);
  }
}

const manifestRunnerImports = new Map();
for (const ref of manifestRunnerImportRefs) {
  const key = `${ref.file}\0${ref.target}\0${ref.importedName}`;
  const previous = manifestRunnerImports.get(key);
  if (previous) {
    errors.push(`${ref.file}:${ref.line} duplicate manifest runner import "${ref.importedName}" from "${ref.spec}"; first at ${previous.file}:${previous.line}; owner ${ownerLocation(ref)}`);
  } else {
    manifestRunnerImports.set(key, ref);
  }
}

for (const rel of contentManifestPaths) {
  const incoming = importIncomingDeclRefs.get(rel) ?? [];
  if (incoming.length === 0) {
    errors.push(`${rel}:1 content manifest is not imported by production source`);
  } else if (incoming.length > 1) {
    const first = incoming[0];
    for (const duplicate of incoming.slice(1)) {
      errors.push(`${duplicate.file}:${duplicate.line} duplicate production import of ${rel}; first at ${first.file}:${first.line}`);
    }
  }
}

for (const ref of manifestRunnerImportRefs) {
  const calls = manifestInvocationRefs(ref.file, ref.localName);
  if (calls.length === 0) {
    errors.push(`${ref.file}:${ref.line} manifest runner "${ref.localName}" from "${ref.spec}" is imported but never invoked; owner ${ownerLocation(ref)}`);
  } else if (calls.length > 1) {
    errors.push(`${ref.file}:${ref.line} manifest runner "${ref.localName}" from "${ref.spec}" is invoked ${calls.length} times (${calls.map(location).join(', ')}); owner ${ownerLocation(ref)}`);
  }
}

for (const runner of manifestRunnerExports) {
  const incoming = (importIncomingNamedRefs.get(runner.file) ?? []).filter(ref => ref.importedName === runner.name);
  if (incoming.length === 0) {
    errors.push(`${runner.file}:${runner.line} exported manifest runner "${runner.name}" is not imported by production source`);
    continue;
  }
  const calls = [];
  for (const ref of incoming) {
    const refs = directCallRefs(ref.file, ref.localName);
    if (refs.length === 0) {
      errors.push(`${ref.file}:${ref.line} imports manifest runner "${runner.name}" from ${runner.file}:${runner.line} but never calls it`);
    }
    calls.push(...refs);
  }
  if (calls.length > 1) {
    errors.push(`${runner.file}:${runner.line} exported manifest runner "${runner.name}" is called ${calls.length} times (${calls.map(location).join(', ')})`);
  }
}

const tagIdRe = /^[a-z][a-z0-9_]*$/;
for (const ref of screenSignalEventTypeRefs) {
  if (!worldEventTypes.has(ref.id)) errors.push(`${ref.file}:${ref.line} SCREEN_SIGNAL_DEFS.${ref.owner ?? '<unknown>'}.eventTypes references missing WorldEventType "${ref.id}"`);
}
for (const ref of [...screenSignalTagRefs, ...permitForgeryEventTagRefs, ...contractTagRefs, ...sideQuestTagRefs, ...rumorWarningTagRefs]) {
  if (!tagIdRe.test(ref.id)) errors.push(`${ref.file}:${ref.line} ${ref.prop} uses non-static or invalid event tag id "${ref.id}"`);
}
for (const ref of contractRewardResourceRefs) {
  if (!resourceIds.has(ref.id)) errors.push(`${ref.file}:${ref.line} CONTRACTS.rewardResourceId references missing resource "${ref.id}"`);
}
for (const ref of nestedRumorRefs) {
  if (!rumorIds.has(ref.id)) errors.push(`${ref.file}:${ref.line} rumorIds references missing rumor "${ref.id}"`);
}

for (const ref of manifestImportRefs) {
  if (!ref.target) {
    errors.push(`${ref.file}:${ref.line} ${ref.floor} manifest import "${ref.spec}" does not resolve to a .ts file`);
    continue;
  }
  if (ref.sideEffect) {
    const text = fs.readFileSync(path.join(root, ref.target), 'utf8');
    if (!/register(?:SideQuest|ZoneContent)\s*\(/.test(text)) {
      errors.push(`${ref.file}:${ref.line} side-effect manifest import "${ref.spec}" resolves to ${ref.target} but does not register zone content or a side quest`);
    }
  }
}

const livingZoneHudMax = numberConst('src/core/types.ts', 'WORLD_EVENT_ZONE_COUNT') ?? 64;
for (const zone of zoneEntries) {
  if (zone.id === undefined) {
    errors.push(`${zone.file}:${zone.line} registerZoneContent must use a static numeric zone HUD id`);
    continue;
  }
  const zoneId = Number(zone.id);
  if (!Number.isInteger(zoneId) || zoneId < 1 || zoneId > livingZoneHudMax) {
    errors.push(`${zone.file}:${zone.line} registerZoneContent zone ${zone.id} is outside HUD zone range 1..${livingZoneHudMax}`);
  }
  if (zone.label === undefined || zone.label.trim().length === 0) {
    errors.push(`${zone.file}:${zone.line} registerZoneContent zone ${zone.id} must use a static non-empty title`);
  }
}

for (const ref of itemRefs) {
  const allowed = ref.prop === 'targetItem' ? questTargetItemIds : itemIds;
  if (!allowed.has(ref.id)) errors.push(`${ref.file}:${ref.line} ${ref.prop} references missing item "${ref.id}"`);
}
for (const ref of interactiveRefs) {
  if (!interactiveIds.has(ref.id)) errors.push(`${ref.file}:${ref.line} ${ref.prop} references missing interactive "${ref.id}"`);
}
for (const ref of [...permitItemRefs, ...permitForgeryOutputRefs, ...permitForgeryInputRefs]) {
  if (!itemIds.has(ref.id)) errors.push(`${ref.file}:${ref.line} permit registry references missing item "${ref.id}"`);
}
for (const ref of rewardTableRefs) {
  if (!itemOrMoneyIds.has(ref.id)) errors.push(`${ref.file}:${ref.line} ${ref.prop} references missing item or money "${ref.id}"`);
}
for (const ref of directItemCallRefs) {
  if (!itemIds.has(ref.id)) errors.push(`${ref.file}:${ref.line} ${ref.call} references missing item "${ref.id}"`);
}
for (const ref of directInteractiveCallRefs) {
  if (!interactiveIds.has(ref.id)) errors.push(`${ref.file}:${ref.line} ${ref.call} references missing interactive "${ref.id}"`);
}
for (const ref of npcRefs) {
  if (!plotNpcIds.has(ref.id)) errors.push(`${ref.file}:${ref.line} ${ref.prop} references missing plot NPC "${ref.id}"`);
}
for (const ref of slimeTextHandleRefs) {
  if (!rumorIds.has(ref.id)) errors.push(`${ref.file}:${ref.line} slime textHandle references missing rumor "${ref.id}"`);
}
for (const ref of proceduralLootRefs) {
  if (!itemIds.has(ref.id)) errors.push(`${ref.file}:${ref.line} LOOT_BY_TAG.${ref.key} references missing item "${ref.id}"`);
}

const ostovMetaPath = 'src/gen/living/samosbornyy_ostov.ts';
const ostovMetaObject = constObject(ostovMetaPath, 'SAMOSBORNYY_OSTOV_METADATA');
if (!ostovMetaObject) {
  errors.push(`${ostovMetaPath} missing SAMOSBORNYY_OSTOV_METADATA`);
} else {
  const stringConsts = stringConstants(ostovMetaPath);
  const numberConsts = numberConstants(ostovMetaPath);
  const metadata = {
    id: getObjectString(ostovMetaObject, 'id', stringConsts),
    floor: getObjectString(ostovMetaObject, 'floor', stringConsts),
    zoneHudId: getObjectNumber(ostovMetaObject, 'zoneHudId', numberConsts),
    zoneTitle: getObjectString(ostovMetaObject, 'zoneTitle', stringConsts),
    reachability: getObjectString(ostovMetaObject, 'reachability', stringConsts),
    samosbor: getObjectString(ostovMetaObject, 'samosbor', stringConsts),
    performance: getObjectString(ostovMetaObject, 'performance', stringConsts),
  };
  if (metadata.id !== 'samosbornyy_ostov') errors.push(`${ostovMetaPath}:${lineOf(sourceFile(ostovMetaPath), ostovMetaObject)} SAMOSBORNYY_OSTOV_METADATA.id must be "samosbornyy_ostov"`);
  if (metadata.floor !== 'living') errors.push(`${ostovMetaPath}:${lineOf(sourceFile(ostovMetaPath), ostovMetaObject)} SAMOSBORNYY_OSTOV_METADATA.floor must be "living"`);
  if (metadata.zoneHudId !== 64) errors.push(`${ostovMetaPath}:${lineOf(sourceFile(ostovMetaPath), ostovMetaObject)} SAMOSBORNYY_OSTOV_METADATA.zoneHudId must be 64`);
  for (const key of ['zoneTitle', 'reachability', 'samosbor', 'performance']) {
    if (!metadata[key]) errors.push(`${ostovMetaPath}:${lineOf(sourceFile(ostovMetaPath), ostovMetaObject)} SAMOSBORNYY_OSTOV_METADATA.${key} is required`);
  }
  const zoneEntry = zoneEntries.find(v => v.file === ostovMetaPath && v.id === String(metadata.zoneHudId));
  if (!zoneEntry) {
    errors.push(`${ostovMetaPath}:${lineOf(sourceFile(ostovMetaPath), ostovMetaObject)} SAMOSBORNYY_OSTOV_METADATA.zoneHudId is not registered`);
  } else if (metadata.zoneTitle !== zoneEntry.label) {
    errors.push(`${ostovMetaPath}:${lineOf(sourceFile(ostovMetaPath), ostovMetaObject)} SAMOSBORNYY_OSTOV_METADATA.zoneTitle differs from registered zone label`);
  }
}

const helperModules = new Set([
  'admin_common.ts',
  'apartments.ts',
  'bad_apple_world.ts',
  'common.ts',
  'content_helpers.ts',
  'content_manifest.ts',
  'index.ts',
  'full_floor.ts',
  'manifest.ts',
  'npcs.ts',
  'posters.ts',
  'side_quests.ts',
  'slides.ts',
  'social_helpers.ts',
  'social_pressure.ts',
  'tutor_room.ts',
  'volatile.ts',
  'zone_content.ts',
]);

const unimportedContent = [];
for (const abs of files) {
  const rel = toRel(abs);
  if (!/^src\/gen\/(living|ministry|maintenance|kvartiry|hell|void|design_floors|procedural_anomalies)\//.test(rel)) continue;
  if (helperModules.has(path.basename(abs))) continue;
  const text = fs.readFileSync(abs, 'utf8');
  const looksLikeContent = /registerSideQuest|registerZoneContent|export function (generate|spawn|apply)/.test(text);
  if (looksLikeContent && !importIncoming.has(rel)) unimportedContent.push(rel);
}

console.log('Content QA registry audit');
console.log('');
console.log('Counts');
console.log(`- plot NPC ids: ${plotNpcIds.size} (${mainPlotNpcPackageEntries.length} packaged base + ${sideQuestNpcEntries.length} side-effect registered + ${localNpcDefEntries.length} local defs)`);
console.log(`- NPC package sources: ${npcPackageEntries.length}`);
console.log(`- community NPC folders: ${npcCommunityFolderEntriesList.length}`);
console.log(`- local NPC defs found: ${localNpcDefEntries.length}`);
console.log(`- plot chain steps: ${plotChainEntries.length}`);
console.log(`- side quest steps: ${sideQuestEntries.filter(v => v.id).length}`);
console.log(`- contracts: ${contractEntries.length}`);
console.log(`- item ids: ${itemEntries.length}`);
console.log(`- monster kinds: ${monsterKindEntries.length}`);
console.log(`- monster registry entries: ${monsterRegistryEntries.length}`);
console.log(`- rumors: ${rumorEntries.length}`);
console.log(`- slime defs: ${slimeEntries.length}`);
console.log(`- zhelemish defs: ${zhelemishEntries.length}`);
console.log(`- interactive defs: ${interactiveEntries.length}`);
console.log(`- procedural geometries: ${floorGeometryEntries.length}`);
console.log(`- procedural majority factions: ${floorMajorityEntries.length}`);
console.log(`- procedural anomalies: ${floorAnomalyEntries.length}`);
console.log(`- procedural geometry docs: ${floorGeometryDocEntries?.length ?? 0}`);
console.log(`- procedural anomaly docs: ${floorAnomalyDocEntries?.length ?? 0}`);
console.log(`- design floor routes: ${designFloorRouteEntries.length}`);
console.log(`- design floor generators: ${designFloorGeneratorEntries.length}`);
console.log(`- permits / forgery recipes: ${permitEntries.length} / ${permitForgeryEntries.length}`);
console.log(`- computers / net hack terminals / emergency panels: ${computerEntries.length} / ${netHackTerminalEntries.length} / ${emergencyPanelEntries.length}`);
console.log(`- craft material ids: ${craftMaterialEntries.length}`);
console.log(`- item compositions: ${itemCompositionCount}`);
console.log(`- craft recipes: ${craftRecipeCount}`);
console.log(`- craft recipe sources: ${craftRecipeSourceEntriesList.length}`);
console.log(`- manifest imports checked: ${manifestImportRefs.length}`);
console.log(`- direct item call refs checked: ${directItemCallRefs.length}`);
console.log(`- interactive refs checked: ${interactiveRefs.length + directInteractiveCallRefs.length}`);
for (const [floor, entries] of [...manifestEntries.entries()].sort()) {
  console.log(`- ${floor} manifest entries: ${entries.length}`);
}

console.log('');
console.log('LIVING zone content');
for (const z of zoneEntries.filter(v => v.file.includes('/living/')).sort((a, b) => Number(a.id) - Number(b.id))) {
  console.log(`- zone ${z.id ?? '?'}: ${z.label ?? '<unresolved title>'} (${z.file}:${z.line})`);
}

console.log('');
if (unimportedContent.length) {
  console.log('Unimported content modules');
  for (const rel of unimportedContent) console.log(`- ${rel}`);
} else {
  console.log('Unimported content modules: none detected');
}

console.log('');
if (errors.length) {
  console.log('Errors');
  for (const err of errors) console.log(`- ${err}`);
  process.exitCode = 1;
} else {
  console.log('Errors: none');
}
