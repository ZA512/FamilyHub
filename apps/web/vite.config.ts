import react from '@vitejs/plugin-react';
import { transformAsync } from '@babel/core';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

import { englishMessages, englishTemplateMessages } from './lib/i18n-messages.ts';

const translatedAttributes = new Set([
  'alt',
  'aria-label',
  'hint',
  'label',
  'noEventsText',
  'placeholder',
  'title',
]);

type TranslationPluginState = { used?: boolean };

function familyHubTranslations({
  types: t,
}: {
  types: typeof import('@babel/types');
}) {
  function translationCall(
    value: string | import('@babel/types').Expression,
    state: TranslationPluginState,
  ) {
    state.used = true;
    return t.callExpression(t.identifier('__familyHubTranslate'), [
      typeof value === 'string' ? t.stringLiteral(value) : value,
    ]);
  }

  function templateTranslationCall(
    path: {
      node: import('@babel/types').TemplateLiteral;
      replaceWith: (node: unknown) => void;
      skip: () => void;
    },
    state: TranslationPluginState,
  ) {
    const key = path.node.quasis
      .map(
        (quasi, index) =>
          `${quasi.value.cooked ?? quasi.value.raw}${
            index < path.node.expressions.length ? `{${index}}` : ''
          }`,
      )
      .join('');
    if (!englishTemplateMessages[key]) return;
    state.used = true;
    path.replaceWith(
      t.callExpression(t.identifier('__familyHubTranslate'), [
        t.stringLiteral(key),
        t.objectExpression(
          path.node.expressions.map((expression, index) =>
            t.objectProperty(
              t.stringLiteral(String(index)),
              expression as import('@babel/types').Expression,
            ),
          ),
        ),
      ]),
    );
    path.skip();
  }

  function translateExpression(
    path: { traverse: (visitor: object) => void },
    state: TranslationPluginState,
  ) {
    path.traverse({
      TemplateLiteral(templatePath: {
        node: import('@babel/types').TemplateLiteral;
        replaceWith: (node: unknown) => void;
        skip: () => void;
      }) {
        templateTranslationCall(templatePath, state);
      },
      StringLiteral(stringPath: {
        node: { value: string };
        parentPath: { isJSXAttribute: () => boolean };
        replaceWith: (node: unknown) => void;
        skip: () => void;
      }) {
        if (stringPath.parentPath.isJSXAttribute()) return;
        if (englishMessages[stringPath.node.value]) {
          stringPath.replaceWith(translationCall(stringPath.node.value, state));
          stringPath.skip();
        }
      },
    });
  }

  return {
    visitor: {
      Program: {
        exit(
          path: {
            node: { body: unknown[] };
          },
          state: TranslationPluginState,
        ) {
          if (!state.used) return;
          path.node.body.unshift(
            t.importDeclaration(
              [
                t.importSpecifier(
                  t.identifier('__familyHubTranslate'),
                  t.identifier('t'),
                ),
              ],
              t.stringLiteral('@/lib/i18n'),
            ),
          );
        },
      },
      JSXText(
        path: { node: { value: string }; replaceWith: (node: unknown) => void },
        state: TranslationPluginState,
      ) {
        const raw = path.node.value;
        const value = raw.replace(/\s+/g, ' ').trim();
        if (!value || !englishMessages[value]) return;
        let translated: import('@babel/types').Expression = translationCall(
          value,
          state,
        );
        if (/^[ \t]+[^\r\n]/.test(raw)) {
          translated = t.binaryExpression(
            '+',
            t.stringLiteral(' '),
            translated,
          );
        }
        if (/[^\r\n][ \t]+$/.test(raw)) {
          translated = t.binaryExpression(
            '+',
            translated,
            t.stringLiteral(' '),
          );
        }
        path.replaceWith(t.jsxExpressionContainer(translated));
      },
      JSXAttribute(
        path: {
          node: {
            name: { name?: string };
            value?: { type: string; value?: string } | null;
          };
        },
        state: TranslationPluginState,
      ) {
        const attribute = path.node.name.name;
        const value = path.node.value;
        if (
          !attribute ||
          !translatedAttributes.has(attribute) ||
          !value ||
          value.type !== 'StringLiteral' ||
          !value.value ||
          !englishMessages[value.value]
        ) {
          return;
        }
        path.node.value = t.jsxExpressionContainer(
          translationCall(value.value, state),
        );
      },
      JSXExpressionContainer(
        path: {
          node: {
            expression:
              | import('@babel/types').Expression
              | import('@babel/types').JSXEmptyExpression;
          };
          traverse: (visitor: object) => void;
        },
        state: TranslationPluginState,
      ) {
        const expression = path.node.expression;
        if (expression.type === 'JSXEmptyExpression') return;
        const directOwner =
          t.isMemberExpression(expression) && t.isIdentifier(expression.object)
            ? expression.object.name
            : null;
        const indexedOwner =
          t.isMemberExpression(expression) &&
          t.isMemberExpression(expression.object) &&
          t.isIdentifier(expression.object.object)
            ? expression.object.object.name
            : null;
        const propertyName =
          t.isMemberExpression(expression) &&
          !expression.computed &&
          t.isIdentifier(expression.property)
            ? expression.property.name
            : null;
        const isLabelMember =
          t.isMemberExpression(expression) &&
          ((propertyName === 'label' &&
            ((directOwner !== null &&
              ['category', 'config', 'entry', 'item', 'module'].includes(
                directOwner,
              )) ||
              (indexedOwner !== null && /config$/i.test(indexedOwner)))) ||
            (propertyName === 'description' && directOwner === 'module') ||
            (expression.computed &&
              directOwner !== null &&
              /labels?$/i.test(directOwner)));
        const isLabelIdentifier =
          t.isIdentifier(expression) &&
          (/label$/i.test(expression.name) ||
            ['error', 'notice'].includes(expression.name));
        if (isLabelMember || isLabelIdentifier) {
          path.node.expression = translationCall(
            expression as import('@babel/types').Expression,
            state,
          );
          return;
        }
        translateExpression(path, state);
      },
    },
  };
}

export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [
    {
      name: 'familyhub-translations',
      enforce: 'pre',
      async transform(code, id) {
        if (!/\.[jt]sx$/.test(id) || id.includes('node_modules')) return null;
        const result = await transformAsync(code, {
          babelrc: false,
          configFile: false,
          filename: id,
          generatorOpts: { retainLines: true },
          parserOpts: {
            plugins: [
              'jsx',
              ...(id.endsWith('.tsx') ? (['typescript'] as const) : []),
            ],
          },
          plugins: [familyHubTranslations],
          sourceMaps: true,
        });
        return result?.code ? { code: result.code, map: result.map } : null;
      },
    },
    react(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
