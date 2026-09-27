import { build } from 'esbuild';

// Bundle our own workspace packages (they ship TypeScript source); keep npm packages external.
const externalizeNpm = {
  name: 'externalize-npm',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith('@souqna/') ? undefined : { path: args.path, external: true },
    );
  },
};

await build({
  entryPoints: ['src/server.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  plugins: [externalizeNpm],
  logLevel: 'info',
});
