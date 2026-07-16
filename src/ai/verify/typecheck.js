const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { loadUiPackage } = require('./uiPackage');

// Returns { ok, errors: [{ kind: 'type', message, loc? }] } per the frozen
// verify contract, checking the generated file against the real bundled
// @chumlab/ui .d.ts. When the type environment cannot be constructed the
// result carries `unavailable: true` instead of throwing - a verify-infra
// problem must never take a generation down.
const GENERATED = '/generated/Generated.tsx';
const AMBIENT = '/generated/ambient.d.ts';

// The gate proves the @chumlab/ui and React surfaces; the other allowlisted
// libraries are any-typed so their full type packages stay out of this repo.
const AMBIENT_SOURCE = [
  'declare module "@phosphor-icons/react";',
  'declare module "recharts";',
  'declare module "clsx";',
  'declare module "tailwind-merge";',
].join('\n');

const COMPILER_OPTIONS = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  types: [],
};

// Warm singleton: the LanguageService (and everything it has parsed - libs,
// React types, the 30 component .d.ts files) is built once and reused; each
// call only bumps the generated file's version.
let service = null;
let serviceUiDir = null;
let currentCode = '';
let version = 0;

const resolutionHost = {
  fileExists: fs.existsSync,
  readFile: (file) => fs.readFileSync(file, 'utf8'),
};

// react/react-dom always resolve from this repo's node_modules, wherever the
// importing file lives - otherwise the ui .d.ts files would pull the
// frontend checkout's copy of @types/react and the two would not unify.
const RESOLVE_BASE = path.join(__dirname, '__resolver__.ts');

function buildService(ui) {
  const host = {
    getScriptFileNames: () => [GENERATED, AMBIENT],
    getScriptVersion: (file) => (file === GENERATED ? String(version) : '0'),
    getScriptSnapshot: (file) => {
      const text = host.readFile(file);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => COMPILER_OPTIONS,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (file) => file === GENERATED || file === AMBIENT || fs.existsSync(file),
    readFile: (file) => {
      if (file === GENERATED) return currentCode;
      if (file === AMBIENT) return AMBIENT_SOURCE;
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
    },
    resolveModuleNames: (names, containingFile) =>
      names.map((name) => {
        if (name === '@chumlab/ui') {
          return ui.rootTypes ? { resolvedFileName: ui.rootTypes } : undefined;
        }
        if (name.startsWith('@chumlab/ui/')) {
          const types = ui.subpaths[name.slice('@chumlab/ui/'.length)];
          return types && fs.existsSync(types) ? { resolvedFileName: types } : undefined;
        }
        const isReact = name === 'react' || name.startsWith('react/') || name === 'react-dom' || name.startsWith('react-dom/');
        const from = isReact || containingFile.startsWith('/generated/') ? RESOLVE_BASE : containingFile;
        return ts.resolveModuleName(name, from, COMPILER_OPTIONS, resolutionHost).resolvedModule;
      }),
  };
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

function toVerifyError(diagnostic) {
  const error = {
    kind: 'type',
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
  };
  if (diagnostic.file && diagnostic.file.fileName === GENERATED && typeof diagnostic.start === 'number') {
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    error.loc = `${line + 1}:${character + 1}`;
  }
  return error;
}

function typecheck(code) {
  const ui = loadUiPackage();
  if (!ui || !ui.rootTypes || !fs.existsSync(ui.rootTypes)) {
    service = null;
    return { ok: true, unavailable: true, errors: [] };
  }

  try {
    if (!service || serviceUiDir !== ui.dir) {
      service = buildService(ui);
      serviceUiDir = ui.dir;
    }
    currentCode = code;
    version += 1;

    const diagnostics = [
      ...service.getSyntacticDiagnostics(GENERATED),
      ...service.getSemanticDiagnostics(GENERATED),
    ];
    const errors = diagnostics.map(toVerifyError);
    return { ok: errors.length === 0, errors };
  } catch {
    service = null;
    return { ok: true, unavailable: true, errors: [] };
  }
}

module.exports = { typecheck };
