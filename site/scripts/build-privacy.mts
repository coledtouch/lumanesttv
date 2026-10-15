import type {Plugin} from 'vite';

const GENERATED_ENTRIES = new Set(['virtual:vinext-rsc-entry', 'virtual:vinext-server-entry']);

export function sanitizeMiddlewareDiagnosticPaths(source: string, projectRoot: string) {
  const root = projectRoot.replaceAll('\\', '/').replace(/\/$/, '');
  return source.replace(/\bfilePath\s*:\s*("(?:\\.|[^"\\])*")/g, (match, literal: string) => {
    let path: unknown;
    try {path = JSON.parse(literal);} catch {return match;}
    if (typeof path !== 'string') return match;
    const normalized = path.replaceAll('\\', '/');
    if (!normalized.startsWith(root + '/')) return match;
    const relative = normalized.slice(root.length + 1);
    if (!/^(?:src\/)?(?:proxy|middleware)\.(?:[cm]?[jt]sx?)$/.test(relative)) return match;
    // Vinext uses this field only as an error label; its import remains intact.
    return 'filePath: ' + JSON.stringify('./' + relative);
  });
}

export function buildPrivacy(): Plugin {
  let root = '';
  return {
    name: 'lumanest-build-privacy',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {root = config.root;},
    transform(source, id) {
      const entry = id.replace(/^\0/, '').split('?')[0];
      if (!GENERATED_ENTRIES.has(entry)) return null;
      const code = sanitizeMiddlewareDiagnosticPaths(source, root);
      return code === source ? null : {code, map: null};
    },
    generateBundle(_options, bundle) {
      const variants = new Set([root, root.replaceAll('\\', '/'), root.replaceAll('\\', '\\\\')]);
      variants.delete('');
      for (const [filename, output] of Object.entries(bundle)) {
        const code = output.type === 'chunk' ? output.code : typeof output.source === 'string' ? output.source : new TextDecoder().decode(output.source);
        if ([...variants].some(path => code.includes(path))) this.error('A private build path remains in ' + filename + '.');
      }
    },
  };
}
