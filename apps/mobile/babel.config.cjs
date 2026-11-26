// Each value imported by name from the generated API client's entry becomes a request of its own,
// `@citizenrun/shared/api/<name>`, which metro.config.cjs resolves to the one generated file that
// defines it. Metro bundles whole modules, so without this the entry brings every generated
// operation into the first chunk that imports one (D-164). Type imports, default and namespace
// imports stay on the entry.
const API_ENTRY = '@citizenrun/shared/api';

function importedName(specifier) {
  return specifier.imported.type === 'Identifier'
    ? specifier.imported.name
    : specifier.imported.value;
}

function splitApiImports({ types: t }) {
  return {
    name: 'split-api-imports',
    visitor: {
      ImportDeclaration(path) {
        const { node } = path;
        if (node.source.value !== API_ENTRY || node.importKind === 'type') {
          return;
        }
        const split = [];
        const kept = [];
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier' && specifier.importKind !== 'type') {
            split.push(specifier);
          } else {
            kept.push(specifier);
          }
        }
        if (split.length === 0) {
          return;
        }
        const declarations = split.map((specifier) =>
          t.importDeclaration(
            [specifier],
            t.stringLiteral(`${API_ENTRY}/${importedName(specifier)}`),
          ),
        );
        if (kept.length > 0) {
          declarations.push(t.importDeclaration(kept, t.stringLiteral(API_ENTRY)));
        }
        path.replaceWithMultiple(declarations);
      },
    },
  };
}

module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'], plugins: [splitApiImports] };
};
