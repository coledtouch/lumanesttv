import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeMiddlewareDiagnosticPaths} from '../scripts/build-privacy.mts';

test('generated middleware diagnostics omit the private checkout while imports stay resolvable', () => {
  const root = 'C:/Users/Example/Projects/LumaNest';
  const source = `import * as middlewareModule from "${root}/proxy.ts";\nrunMiddleware({filePath: "${root}/proxy.ts", module: middlewareModule, isProxy: true});`;
  const cleaned = sanitizeMiddlewareDiagnosticPaths(source, root);
  assert.ok(cleaned.includes(`import * as middlewareModule from "${root}/proxy.ts"`));
  assert.ok(cleaned.includes('filePath: "./proxy.ts"'));
  assert.ok(cleaned.includes('module: middlewareModule, isProxy: true'));
});

test('portable generated paths preserve the filename and src convention in diagnostics', () => {
  for (const [root, path, label] of [
    ['/private/workspace/lumanest', '/private/workspace/lumanest/middleware.ts', './middleware.ts'],
    ['C:\\Users\\Example\\LumaNest', 'C:\\Users\\Example\\LumaNest\\src\\proxy.ts', './src/proxy.ts'],
  ]) {
    const source = 'filePath: ' + JSON.stringify(path);
    assert.equal(sanitizeMiddlewareDiagnosticPaths(source, root), 'filePath: ' + JSON.stringify(label));
  }
});

test('sanitizing diagnostic metadata leaves other paths and unrelated files untouched', () => {
  const source = 'filePath: "/private/workspace/lumanest/app/page.tsx", filePath: "/other/workspace/proxy.ts", filePath: "./proxy.ts"';
  assert.equal(sanitizeMiddlewareDiagnosticPaths(source, '/private/workspace/lumanest'), source);
});
