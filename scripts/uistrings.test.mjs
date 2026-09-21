import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Compile the table in memory so the tests also run on Node versions without TS imports.
const source = readFileSync(new URL('../src/lib/uistrings.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(`${source}\nexport { EN, TABLES };`, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { EN, TABLES, uiStrings } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('the Day Games languages have complete website controls and matching placeholders', () => {
  const keys = Object.keys(EN).sort();
  const tokens = (text) => [...text.matchAll(/\[[A-Z_]+\]/g)].map((m) => m[0]).sort();
  for (const locale of ['ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'zh']) {
    assert.deepEqual(Object.keys(TABLES[locale]).sort(), keys, locale);
    for (const key of keys) {
      assert.ok(TABLES[locale][key].trim(), `${locale}/${key}`);
      assert.deepEqual(tokens(TABLES[locale][key]), tokens(EN[key]), `${locale}/${key}`);
    }
  }
});

test('regional and script tags inherit the translated website controls', () => {
  assert.equal(uiStrings('zh-Hans-CN').openWebApp, '打开网页版应用');
  assert.equal(uiStrings('pt-BR').selectLanguage, 'Selecionar idioma');
  assert.equal(uiStrings('fr-CA').themeAuto, 'Automatique (selon le système)');
  assert.equal(uiStrings('unknown').openWebApp, EN.openWebApp);
});
