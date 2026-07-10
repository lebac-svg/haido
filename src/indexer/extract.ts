import type { Node, Tree } from 'web-tree-sitter';
import type { SymbolInfo, SymbolKind } from '../core/types.js';
import { hashNode } from './normalize.js';
import type { LangId } from './parser.js';

/**
 * Symbol extraction rules (v0.1, SPEC F1):
 * - TS/TSX/JS: functions, classes, class methods (incl. arrow-valued class fields),
 *   const-with-function-value (exported or not), exported data consts, type/interface/enum.
 * - Python: module functions, classes, class methods (decorators included in the hash).
 * - Locals are skipped: we never descend into function bodies.
 * - qname = '<relPath>#<Outer.Inner>'; duplicates get '@L<line>' appended.
 */
const FUNC_VALUES = new Set([
  'arrow_function',
  'function_expression',
  'function', // older grammar name for function expressions
  'generator_function',
]);

export function extractSymbols(tree: Tree, lang: LangId, relPath: string): SymbolInfo[] {
  const out: SymbolInfo[] = [];
  const seen = new Map<string, number>();

  const push = (
    kind: SymbolKind,
    name: string,
    classChain: string[],
    defNode: Node,
    hashTarget: Node,
  ): void => {
    let qname = `${relPath}#${[...classChain, name].join('.')}`;
    const dup = seen.get(qname) ?? 0;
    seen.set(qname, dup + 1);
    if (dup > 0) qname = `${qname}@L${String(hashTarget.startPosition.row + 1)}`;
    const text = defNode.text;
    const nl = text.indexOf('\n');
    out.push({
      kind,
      name,
      qname,
      startLine: hashTarget.startPosition.row + 1,
      endLine: hashTarget.endPosition.row + 1,
      signature: (nl === -1 ? text : text.slice(0, nl)).trim().slice(0, 160),
      bodyHash: hashNode(hashTarget),
    });
  };

  const visitChildren = (node: Node, classChain: string[], exported: boolean): void => {
    for (const child of node.namedChildren) {
      if (child) visit(child, classChain, exported);
    }
  };

  const visit = (node: Node, classChain: string[], exported: boolean): void => {
    if (lang === 'py') {
      visitPy(node, classChain);
      return;
    }
    switch (node.type) {
      case 'export_statement':
        visitChildren(node, classChain, true);
        return;
      case 'function_declaration':
      case 'generator_function_declaration': {
        const name = node.childForFieldName('name');
        if (name) push('function', name.text, classChain, node, node);
        return;
      }
      case 'class_declaration':
      case 'abstract_class_declaration': {
        const name = node.childForFieldName('name');
        if (!name) return;
        push('class', name.text, classChain, node, node);
        const body = node.childForFieldName('body');
        if (body) visitChildren(body, [...classChain, name.text], false);
        return;
      }
      case 'method_definition': {
        if (classChain.length === 0) return; // object-literal method — not a stable anchor
        const name = node.childForFieldName('name');
        if (name) push('method', name.text, classChain, node, node);
        return;
      }
      case 'public_field_definition': {
        // class field holding a function: `onClick = () => ...`
        const name = node.childForFieldName('name');
        const value = node.childForFieldName('value');
        if (classChain.length > 0 && name && value && FUNC_VALUES.has(value.type)) {
          push('method', name.text, classChain, node, node);
        }
        return;
      }
      case 'interface_declaration':
      case 'type_alias_declaration':
      case 'enum_declaration': {
        const name = node.childForFieldName('name');
        if (name) push('type', name.text, classChain, node, node);
        return;
      }
      case 'lexical_declaration':
      case 'variable_declaration': {
        for (const decl of node.namedChildren) {
          if (!decl || decl.type !== 'variable_declarator') continue;
          const name = decl.childForFieldName('name');
          if (!name || name.type !== 'identifier') continue; // skip destructuring patterns
          const value = decl.childForFieldName('value');
          if (value && FUNC_VALUES.has(value.type)) {
            push('function', name.text, classChain, decl, decl);
          } else if (exported) {
            push('const', name.text, classChain, decl, decl);
          }
        }
        return;
      }
      case 'function_signature': // overload declarations — implementation carries the hash
      case 'ambient_declaration':
        return;
      default:
        // descend through top-level statements; `exported` only applies to direct children
        visitChildren(node, classChain, false);
    }
  };

  const visitPy = (node: Node, classChain: string[]): void => {
    switch (node.type) {
      case 'decorated_definition': {
        const def = node.childForFieldName('definition');
        if (def) visitPy(def, classChain);
        return;
      }
      case 'class_definition': {
        const name = node.childForFieldName('name');
        if (!name) return;
        const hashTarget = node.parent?.type === 'decorated_definition' ? node.parent : node;
        push('class', name.text, classChain, node, hashTarget);
        const body = node.childForFieldName('body');
        if (body) visitChildren(body, [...classChain, name.text], false);
        return;
      }
      case 'function_definition': {
        const name = node.childForFieldName('name');
        if (!name) return;
        const hashTarget = node.parent?.type === 'decorated_definition' ? node.parent : node;
        const kind: SymbolKind = classChain.length > 0 ? 'method' : 'function';
        push(kind, name.text, classChain, node, hashTarget);
        return; // never descend into function bodies
      }
      default:
        visitChildren(node, classChain, false);
    }
  };

  visit(tree.rootNode, [], false);
  return out;
}
