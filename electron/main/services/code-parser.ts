/**
 * Tree-sitter based code parser using web-tree-sitter (WASM).
 * Extracts structural skeletons from source files — function/class/method
 * definitions with signatures, line ranges, imports, and callees.
 */

import * as path from 'path';
import * as crypto from 'crypto';
import type { ChunkData } from '../api/code-intel-client';

let Parser: any;
let Language: any;
let parserReady = false;
const languageParsers: Map<string, any> = new Map();

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.rb': 'ruby',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'c_sharp',
};

const FUNCTION_NODE_TYPES: Record<string, string[]> = {
  javascript: ['function_declaration', 'method_definition', 'arrow_function', 'function_expression'],
  typescript: ['function_declaration', 'method_definition', 'arrow_function', 'function_expression'],
  python: ['function_definition'],
  go: ['function_declaration', 'method_declaration'],
  rust: ['function_item'],
  java: ['method_declaration', 'constructor_declaration'],
  ruby: ['method', 'singleton_method'],
  c: ['function_definition'],
  cpp: ['function_definition'],
  c_sharp: ['method_declaration', 'constructor_declaration'],
};

const CLASS_NODE_TYPES: Record<string, string[]> = {
  javascript: ['class_declaration'],
  typescript: ['class_declaration'],
  python: ['class_definition'],
  go: ['type_declaration'],
  rust: ['struct_item', 'impl_item', 'trait_item'],
  java: ['class_declaration', 'interface_declaration'],
  ruby: ['class', 'module'],
  c: [],
  cpp: ['class_specifier'],
  c_sharp: ['class_declaration', 'interface_declaration'],
};

const IMPORT_NODE_TYPES: Record<string, string[]> = {
  javascript: ['import_statement', 'import_declaration'],
  typescript: ['import_statement', 'import_declaration'],
  python: ['import_statement', 'import_from_statement'],
  go: ['import_declaration'],
  rust: ['use_declaration'],
  java: ['import_declaration'],
  ruby: ['call'],
  c: ['preproc_include'],
  cpp: ['preproc_include'],
  c_sharp: ['using_directive'],
};

export function getLanguageForFile(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_EXTENSIONS[ext] || null;
}

export async function initializeParser(): Promise<void> {
  if (parserReady) return;

  try {
    const TreeSitterModule = require('web-tree-sitter');
    const ParserClass = TreeSitterModule.Parser ?? TreeSitterModule.default?.Parser ?? TreeSitterModule;
    const LanguageClass = TreeSitterModule.Language ?? TreeSitterModule.default?.Language ?? ParserClass.Language;
    if (typeof ParserClass.init === 'function') {
      await ParserClass.init();
    }
    Parser = ParserClass;
    Language = LanguageClass;
    parserReady = true;
    console.log('[CodeParser] web-tree-sitter initialized');
  } catch (e) {
    console.error('[CodeParser] Failed to initialize web-tree-sitter:', e);
    throw e;
  }
}

async function getParserForLanguage(language: string): Promise<any | null> {
  if (languageParsers.has(language)) {
    return languageParsers.get(language)!;
  }

  try {
    const parser = new Parser();
    const wasmPath = path.join(__dirname, '..', '..', '..', 'tree-sitter-wasms', `tree-sitter-${language}.wasm`);
    const lang = await Language.load(wasmPath);
    parser.setLanguage(lang);
    languageParsers.set(language, parser);
    return parser;
  } catch (e) {
    console.warn(`[CodeParser] Could not load grammar for ${language}:`, e);
    return null;
  }
}

function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function extractNodeName(node: any): string {
  const nameNode = node.childForFieldName('name');
  if (nameNode) return nameNode.text;

  const declaratorNode = node.childForFieldName('declarator');
  if (declaratorNode) {
    const declName = declaratorNode.childForFieldName('name');
    if (declName) return declName.text;
    return declaratorNode.text.split('(')[0].trim();
  }

  return '<anonymous>';
}

function extractSignature(node: any, sourceCode: string): string | undefined {
  const params = node.childForFieldName('parameters');
  const returnType = node.childForFieldName('return_type') || node.childForFieldName('type');

  if (!params) return undefined;

  let sig = params.text;
  if (returnType) {
    sig += `: ${returnType.text}`;
  }
  return sig.length > 500 ? sig.slice(0, 500) : sig;
}

function extractDocstring(node: any, sourceCode: string): string | undefined {
  const body = node.childForFieldName('body');
  if (body && body.firstChild) {
    const first = body.firstChild;
    if (first.type === 'expression_statement') {
      const str = first.firstChild;
      if (str && str.type === 'string') {
        return str.text.replace(/^['"`]{1,3}|['"`]{1,3}$/g, '').trim().slice(0, 500);
      }
    }
  }

  let prev = node.previousSibling;
  if (prev && prev.type === 'comment') {
    return prev.text.replace(/^\/\/\s?|^\/\*|\*\/$/g, '').trim().slice(0, 500);
  }

  return undefined;
}

function collectCallees(node: any): string[] {
  const callees: Set<string> = new Set();

  function walk(n: any) {
    if (n.type === 'call_expression' || n.type === 'call') {
      const fn = n.childForFieldName('function') || n.firstChild;
      if (fn) {
        let name = fn.text;
        if (name.includes('.')) {
          name = name.split('.').pop()!;
        }
        if (name.length < 100) {
          callees.add(name);
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      walk(n.child(i));
    }
  }

  walk(node);
  return Array.from(callees).slice(0, 50);
}

export async function parseFile(filePath: string, content: string): Promise<ChunkData[]> {
  const lang = getLanguageForFile(filePath);
  if (!lang) return [];
  const language: string = lang;

  await initializeParser();
  const parser = await getParserForLanguage(language);
  if (!parser) return [];

  const tree = parser.parse(content);
  const root = tree.rootNode;
  const chunks: ChunkData[] = [];
  const imports: string[] = [];

  const functionTypes = FUNCTION_NODE_TYPES[language] || [];
  const classTypes = CLASS_NODE_TYPES[language] || [];
  const importTypes = IMPORT_NODE_TYPES[language] || [];

  function walkForImports(node: any) {
    if (importTypes.includes(node.type)) {
      imports.push(node.text.trim().slice(0, 200));
    }
    for (let i = 0; i < node.childCount; i++) {
      walkForImports(node.child(i));
    }
  }
  walkForImports(root);

  function walkForChunks(node: any, parentClass?: string) {
    if (classTypes.includes(node.type)) {
      const name = extractNodeName(node);
      chunks.push({
        file_path: filePath,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        chunk_type: 'class',
        name,
        signature: undefined,
        language,
        docstring: extractDocstring(node, content),
        content_hash: computeContentHash(node.text),
        callees: [],
        imports,
      });

      for (let i = 0; i < node.childCount; i++) {
        walkForChunks(node.child(i), name);
      }
      return;
    }

    if (functionTypes.includes(node.type)) {
      const name = extractNodeName(node);
      const fullName = parentClass ? `${parentClass}.${name}` : name;

      if (name !== '<anonymous>') {
        chunks.push({
          file_path: filePath,
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
          chunk_type: parentClass ? 'method' : 'function',
          name: fullName,
          signature: extractSignature(node, content),
          language,
          docstring: extractDocstring(node, content),
          content_hash: computeContentHash(node.text),
          callees: collectCallees(node),
          imports: parentClass ? [] : imports,
        });
      }
      return;
    }

    for (let i = 0; i < node.childCount; i++) {
      walkForChunks(node.child(i), parentClass);
    }
  }

  walkForChunks(root);

  if (chunks.length === 0) {
    const fileBaseName = path.basename(filePath, path.extname(filePath));
    chunks.push({
      file_path: filePath,
      start_line: 1,
      end_line: content.split('\n').length,
      chunk_type: 'file',
      name: fileBaseName,
      signature: undefined,
      language,
      docstring: undefined,
      content_hash: computeContentHash(content),
      callees: [],
      imports,
    });
  }

  return chunks;
}
