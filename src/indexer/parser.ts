import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Symbol } from './db';

// tree-sitter types
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Parser = require('tree-sitter');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Python = require('tree-sitter-python');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JavaScript = require('tree-sitter-javascript');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { typescript: TypeScript } = require('tree-sitter-typescript');

// ── Shared helpers ────────────────────────────────────────────────────────────

function sha1(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex');
}

function nodeText(node: { startIndex: number; endIndex: number }, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

function symbolId(filePath: string, name: string, startLine: number): string {
  return sha1(`${filePath}:${name}:${startLine}`);
}

function isPrivateName(name: string): 'public' | 'private' {
  return name.startsWith('_') || name.startsWith('#') ? 'private' : 'public';
}

interface TreeNode {
  type: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  text: string;
  childCount: number;
  children: TreeNode[];
  namedChildren: TreeNode[];
  firstNamedChild: TreeNode | null;
  parent: TreeNode | null;
  childForFieldName(name: string): TreeNode | null;
}

export interface ParsedImport {
  module: string;         // e.g. "os.path", ".utils", "./hooks/useAuth"
  names: string[];        // imported names, [] means wildcard/whole module
  isRelative: boolean;
  rawText: string;
  line: number;
}

export interface ParseResult {
  symbols: Symbol[];
  imports: ParsedImport[];
}

// ── Parser instances (lazy, one per language) ─────────────────────────────────

let pyParser: typeof Parser | null = null;
let jsParser: typeof Parser | null = null;
let tsParser: typeof Parser | null = null;

function getPythonParser() {
  if (!pyParser) { pyParser = new Parser(); pyParser.setLanguage(Python); }
  return pyParser;
}

function getJsParser() {
  if (!jsParser) { jsParser = new Parser(); jsParser.setLanguage(JavaScript); }
  return jsParser;
}

function getTsParser() {
  if (!tsParser) { tsParser = new Parser(); tsParser.setLanguage(TypeScript); }
  return tsParser;
}

// ── Python parser ─────────────────────────────────────────────────────────────

function extractParams(params: TreeNode | null, source: string): string {
  if (!params) return '()';
  return nodeText(params, source);
}

function extractReturnType(node: TreeNode, source: string): string {
  const ret = node.childForFieldName('return_type');
  return ret ? ' -> ' + nodeText(ret, source) : '';
}

/**
 * Extract the first Python docstring from a function/class body.
 */
function extractPyDocstring(node: TreeNode, source: string): string {
  const body = node.childForFieldName('body');
  if (!body) return '';
  const first = body.namedChildren[0];
  if (!first || first.type !== 'expression_statement') return '';
  const expr = first.namedChildren[0];
  if (!expr) return '';
  if (expr.type !== 'string' && expr.type !== 'concatenated_string') return '';
  const raw = nodeText(expr, source);
  return raw
    .replace(/^("""|\"\"\"|'''|\"|\')/, '')
    .replace(/("""|\"\"\"|'''|\"|\')$/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 300);
}

function walkTreePy(
  node: TreeNode,
  source: string,
  filePath: string,
  symbols: Symbol[],
  imports: ParsedImport[],
  parentClass?: string,
): void {
  switch (node.type) {
    case 'function_definition':
    case 'async_function_definition': {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) break;
      const name = nameNode.text;
      const qualifiedName = parentClass ? `${parentClass}.${name}` : name;
      const params = extractParams(node.childForFieldName('parameters'), source);
      const retType = extractReturnType(node, source);
      const signature = `def ${qualifiedName}${params}${retType}:`;
      const body = nodeText(node, source);

      symbols.push({
        id: symbolId(filePath, qualifiedName, node.startPosition.row + 1),
        symbol_name: qualifiedName,
        symbol_type: parentClass ? 'method' : 'function',
        file_path: filePath,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        signature,
        docstring: extractPyDocstring(node, source),
        visibility: name.startsWith('_') ? 'private' : 'public',
        body_hash: sha1(body),
      });

      for (const child of node.namedChildren) {
        walkTreePy(child, source, filePath, symbols, imports, parentClass);
      }
      break;
    }

    case 'class_definition': {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) break;
      const name = nameNode.text;
      const bases = node.childForFieldName('superclasses');
      const basesStr = bases ? nodeText(bases, source) : '';
      const signature = `class ${name}${basesStr}:`;
      const body = nodeText(node, source);

      symbols.push({
        id: symbolId(filePath, name, node.startPosition.row + 1),
        symbol_name: name,
        symbol_type: 'class',
        file_path: filePath,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        signature,
        docstring: extractPyDocstring(node, source),
        visibility: name.startsWith('_') ? 'private' : 'public',
        body_hash: sha1(body),
      });

      for (const child of node.namedChildren) {
        walkTreePy(child, source, filePath, symbols, imports, name);
      }
      break;
    }

    case 'import_statement': {
      for (const child of node.namedChildren) {
        const modName = child.type === 'dotted_name' ? child.text :
                        child.type === 'aliased_import' ? (child.childForFieldName('name')?.text ?? '') : child.text;
        imports.push({
          module: modName,
          names: [],
          isRelative: false,
          rawText: nodeText(node, source),
          line: node.startPosition.row + 1,
        });
      }
      break;
    }

    case 'import_from_statement': {
      const moduleNode = node.childForFieldName('module_name');
      const rawMod = moduleNode ? nodeText(moduleNode, source) : '';
      const isRelative = nodeText(node, source).startsWith('from .');
      const names: string[] = [];

      for (const child of node.namedChildren) {
        if (child.type === 'dotted_name' && child !== moduleNode) names.push(child.text);
        if (child.type === 'aliased_import') {
          const n = child.childForFieldName('name');
          if (n) names.push(n.text);
        }
        if (child.type === 'wildcard_import') names.push('*');
      }

      imports.push({
        module: rawMod,
        names,
        isRelative,
        rawText: nodeText(node, source),
        line: node.startPosition.row + 1,
      });
      break;
    }

    default:
      for (const child of node.namedChildren) {
        walkTreePy(child, source, filePath, symbols, imports, parentClass);
      }
  }
}

// ── JS/TS parser ──────────────────────────────────────────────────────────────

const JS_DECLARATION_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'class_declaration',
  'abstract_class_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'lexical_declaration',
  'variable_declaration',
]);

/**
 * Extract JSDoc comment (/** ... *\/) immediately before `node` in source text.
 */
function extractJsDoc(node: TreeNode, source: string): string {
  const before = source.slice(0, node.startIndex);
  const match = before.match(/\/\*\*([\s\S]*?)\*\/\s*$/);
  if (!match) return '';
  return match[1]
    .split('\n')
    .map(line => line.replace(/^\s*\*\s?/, '').trim())
    .filter(line => line.length > 0 && !line.startsWith('@'))
    .join(' ')
    .slice(0, 300);
}

function walkTreeJs(
  node: TreeNode,
  source: string,
  filePath: string,
  symbols: Symbol[],
  imports: ParsedImport[],
  parentClass?: string,
  isExported = false,
): void {
  switch (node.type) {

    // ── export statement ──────────────────────────────────────────────────────
    case 'export_statement': {
      const decl = node.childForFieldName('declaration');
      if (decl) {
        walkTreeJs(decl, source, filePath, symbols, imports, parentClass, true);
      } else {
        // export default class/function, or export { } from
        for (const child of node.namedChildren) {
          if (JS_DECLARATION_TYPES.has(child.type)) {
            walkTreeJs(child, source, filePath, symbols, imports, parentClass, true);
          }
        }
        // export { foo } from './bar' — treat as re-export import
        const src = node.childForFieldName('source');
        if (src) {
          const modulePath = src.text.replace(/^['"]|['"]$/g, '');
          if (modulePath.startsWith('.')) {
            imports.push({
              module: modulePath,
              names: [],
              isRelative: true,
              rawText: nodeText(node, source),
              line: node.startPosition.row + 1,
            });
          }
        }
      }
      break;
    }

    // ── function & generator ──────────────────────────────────────────────────
    case 'function_declaration':
    case 'generator_function_declaration': {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) break;
      const name = nameNode.text;
      const qualName = parentClass ? `${parentClass}.${name}` : name;
      const paramsNode = node.childForFieldName('parameters');
      const params = paramsNode ? nodeText(paramsNode, source) : '()';
      const retNode = node.childForFieldName('return_type');
      const retType = retNode ? nodeText(retNode, source) : '';
      const signature = `function ${qualName}${params}${retType}`;

      symbols.push({
        id: symbolId(filePath, qualName, node.startPosition.row + 1),
        symbol_name: qualName,
        symbol_type: parentClass ? 'method' : 'function',
        file_path: filePath,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        signature,
        docstring: extractJsDoc(node, source),
        visibility: isExported ? 'public' : isPrivateName(name),
        body_hash: sha1(nodeText(node, source)),
      });

      // Recurse into body for nested functions/classes
      const body = node.childForFieldName('body');
      if (body) {
        for (const child of body.namedChildren) {
          walkTreeJs(child, source, filePath, symbols, imports, parentClass);
        }
      }
      break;
    }

    // ── method definition (inside class body) ─────────────────────────────────
    case 'method_definition': {
      const nameNode = node.childForFieldName('name');
      if (!nameNode || !parentClass) break;
      const name = nameNode.text;
      // Skip constructors and computed names
      if (name === 'constructor' || name.startsWith('[')) break;
      const qualName = `${parentClass}.${name}`;
      const paramsNode = node.childForFieldName('parameters');
      const params = paramsNode ? nodeText(paramsNode, source) : '()';
      const retNode = node.childForFieldName('return_type');
      const retType = retNode ? nodeText(retNode, source) : '';

      const hasPrivateModifier = node.namedChildren.some(
        c => c.type === 'accessibility_modifier' && (c.text === 'private' || c.text === 'protected'),
      );

      symbols.push({
        id: symbolId(filePath, qualName, node.startPosition.row + 1),
        symbol_name: qualName,
        symbol_type: 'method',
        file_path: filePath,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        signature: `${name}${params}${retType}`,
        docstring: extractJsDoc(node, source),
        visibility: hasPrivateModifier ? 'private' : isPrivateName(name),
        body_hash: sha1(nodeText(node, source)),
      });
      break;
    }

    // ── class declaration ─────────────────────────────────────────────────────
    case 'class_declaration':
    case 'abstract_class_declaration': {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) break;
      const name = nameNode.text;

      let heritage = '';
      for (const child of node.namedChildren) {
        if (child.type === 'class_heritage') { heritage = ' ' + nodeText(child, source); break; }
      }

      symbols.push({
        id: symbolId(filePath, name, node.startPosition.row + 1),
        symbol_name: name,
        symbol_type: 'class',
        file_path: filePath,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        signature: `class ${name}${heritage}`,
        docstring: extractJsDoc(node, source),
        visibility: isExported ? 'public' : isPrivateName(name),
        body_hash: sha1(nodeText(node, source)),
      });

      const classBody = node.childForFieldName('body');
      if (classBody) {
        for (const child of classBody.namedChildren) {
          walkTreeJs(child, source, filePath, symbols, imports, name);
        }
      }
      break;
    }

    // ── interface declaration (TypeScript) ────────────────────────────────────
    case 'interface_declaration': {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) break;
      const name = nameNode.text;

      let heritage = '';
      for (const child of node.namedChildren) {
        if (child.type === 'extends_type_clause') {
          heritage = ' extends ' + nodeText(child, source).replace(/^extends\s+/, '');
          break;
        }
      }

      symbols.push({
        id: symbolId(filePath, name, node.startPosition.row + 1),
        symbol_name: name,
        symbol_type: 'class',
        file_path: filePath,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        signature: `interface ${name}${heritage}`,
        docstring: extractJsDoc(node, source),
        visibility: isExported ? 'public' : isPrivateName(name),
        body_hash: sha1(nodeText(node, source)),
      });
      break;
    }

    // ── type alias (TypeScript) ───────────────────────────────────────────────
    case 'type_alias_declaration': {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) break;
      const name = nameNode.text;

      symbols.push({
        id: symbolId(filePath, name, node.startPosition.row + 1),
        symbol_name: name,
        symbol_type: 'variable',
        file_path: filePath,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        signature: `type ${name}`,
        docstring: extractJsDoc(node, source),
        visibility: isExported ? 'public' : isPrivateName(name),
        body_hash: sha1(nodeText(node, source)),
      });
      break;
    }

    // ── const/let/var with function value ─────────────────────────────────────
    case 'lexical_declaration':
    case 'variable_declaration': {
      for (const child of node.namedChildren) {
        if (child.type !== 'variable_declarator') continue;
        const nameNode = child.childForFieldName('name');
        const valueNode = child.childForFieldName('value');
        if (!nameNode || !valueNode) continue;
        if (!['arrow_function', 'function_expression', 'generator_function'].includes(valueNode.type)) continue;

        const name = nameNode.text;
        const qualName = parentClass ? `${parentClass}.${name}` : name;
        const paramsNode = valueNode.childForFieldName('parameters');
        const params = paramsNode ? nodeText(paramsNode, source) : '()';
        const retNode = valueNode.childForFieldName('return_type');
        const retType = retNode ? nodeText(retNode, source) : '';

        const sigKw = node.type === 'lexical_declaration'
          ? (node.children.find(c => c.text === 'const' || c.text === 'let')?.text ?? 'const')
          : 'var';
        const arrowStr = valueNode.type === 'arrow_function' ? ` => ...` : '';
        const signature = `${sigKw} ${qualName} = ${params}${retType}${arrowStr}`;

        symbols.push({
          id: symbolId(filePath, qualName, node.startPosition.row + 1),
          symbol_name: qualName,
          symbol_type: parentClass ? 'method' : 'function',
          file_path: filePath,
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
          signature,
          docstring: extractJsDoc(node, source),
          visibility: isExported ? 'public' : isPrivateName(name),
          body_hash: sha1(nodeText(valueNode, source)),
        });
      }
      break;
    }

    // ── import declaration ────────────────────────────────────────────────────
    case 'import_statement': {
      const sourceNode = node.childForFieldName('source');
      if (!sourceNode) break;
      const modulePath = sourceNode.text.replace(/^['"]|['"]$/g, '');
      const names: string[] = [];

      const clause = node.namedChildren.find(c => c.type === 'import_clause');
      if (clause) {
        for (const child of clause.namedChildren) {
          if (child.type === 'identifier') {
            // default import: import foo from ...
            names.push(child.text);
          } else if (child.type === 'named_imports') {
            for (const spec of child.namedChildren) {
              if (spec.type === 'import_specifier') {
                const alias = spec.childForFieldName('alias') ?? spec.childForFieldName('name');
                if (alias) names.push(alias.text);
              }
            }
          } else if (child.type === 'namespace_import') {
            const alias = child.namedChildren.find(c => c.type === 'identifier');
            if (alias) names.push(alias.text);
          }
        }
      }

      imports.push({
        module: modulePath,
        names,
        isRelative: modulePath.startsWith('.'),
        rawText: nodeText(node, source),
        line: node.startPosition.row + 1,
      });
      break;
    }

    default:
      for (const child of node.namedChildren) {
        walkTreeJs(child, source, filePath, symbols, imports, parentClass, isExported);
      }
  }
}

// ── Unified entry point ───────────────────────────────────────────────────────

const JS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);

export function parseFile(filePath: string): ParseResult {
  const source = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath).toLowerCase();
  const symbols: Symbol[] = [];
  const imports: ParsedImport[] = [];

  if (ext === '.py') {
    const tree = getPythonParser().parse(source);
    walkTreePy(tree.rootNode, source, filePath, symbols, imports, undefined);
  } else if (JS_EXTS.has(ext)) {
    const parser = ext === '.js' || ext === '.jsx' ? getJsParser() : getTsParser();
    const tree = parser.parse(source);
    walkTreeJs(tree.rootNode, source, filePath, symbols, imports, undefined, false);
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }

  return { symbols, imports };
}
