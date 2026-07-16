const ts = require('typescript');
const { loadUiPackage } = require('./uiPackage');

// Returns { ok, errors: [{ kind: 'lint', message, loc? }] } per the frozen
// verify contract. Synchronous - it runs first on every generation.
const ALLOWED_PACKAGES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@phosphor-icons/react',
  'recharts',
  'clsx',
  'tailwind-merge',
]);

const HEX_COLOR = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

function lint(code) {
  const errors = [];
  const source = ts.createSourceFile(
    'Generated.tsx',
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const ui = loadUiPackage();

  const locOf = (node) => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    return `${line + 1}:${character + 1}`;
  };

  const checkSpecifier = (specifier, node) => {
    if (
      specifier === '@chumlab/icons' ||
      specifier.startsWith('@chumlab/icons/') ||
      specifier === '@chumlab/ui/icons'
    ) {
      errors.push({
        kind: 'lint',
        message: `"${specifier}" does not exist - icons come from @phosphor-icons/react`,
        loc: locOf(node),
      });
      return;
    }
    if (specifier === '@chumlab/ui') return;
    if (specifier.startsWith('@chumlab/ui/')) {
      const subpath = specifier.slice('@chumlab/ui/'.length);
      // Without the local package the subpath check degrades; typecheck
      // reports its own unavailability in that case.
      if (ui && !(subpath in ui.subpaths)) {
        errors.push({
          kind: 'lint',
          message: `"${specifier}" is not a @chumlab/ui subpath - check the package exports for the valid component paths`,
          loc: locOf(node),
        });
      }
      return;
    }
    if (!ALLOWED_PACKAGES.has(specifier)) {
      errors.push({
        kind: 'lint',
        message: `"${specifier}" is outside the import allowlist - generated code is a single file importing only @chumlab/ui, react, react-dom, @phosphor-icons/react, recharts, clsx and tailwind-merge`,
        loc: locOf(node),
      });
    }
  };

  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkSpecifier(node.moduleSpecifier.text, node.moduleSpecifier);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImportCall = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      if ((isImportCall || isRequire) && node.arguments.length && ts.isStringLiteral(node.arguments[0])) {
        checkSpecifier(node.arguments[0].text, node.arguments[0]);
      }
    }
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const match = HEX_COLOR.exec(node.text);
      if (match) {
        errors.push({
          kind: 'lint',
          message: `raw hex color "${match[0]}" - use the design tokens (bg-bg-base, text-fg, var(--accent), ...) instead`,
          loc: locOf(node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return { ok: errors.length === 0, errors };
}

module.exports = { lint };
