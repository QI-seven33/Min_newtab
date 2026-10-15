import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const icons = ['moon', 'sun', 'desktop', 'arrow-right', 'pause', 'play', 'sliders-horizontal', 'x', 'upload-simple', 'image', 'plus'];
await mkdir('assets', { recursive: true });
const symbols = await Promise.all(icons.map(async name => {
  const source = await readFile(`node_modules/@phosphor-icons/core/assets/regular/${name}.svg`, 'utf8');
  const body = source.slice(source.indexOf('>') + 1, source.lastIndexOf('</svg>'));
  return `<symbol id="${name}" viewBox="0 0 256 256">${body}</symbol>`;
}));
await writeFile('assets/icons.svg', `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>\n`);
await build({ entryPoints: ['src/app.js'], outfile: 'newtab.js', bundle: true, minify: true, format: 'iife', target: 'chrome120', supported: { 'template-literal': false }, legalComments: 'eof' });
const licenses = await Promise.all([
  ['Material Web', '@material/web/LICENSE'], ['Lit', 'lit/LICENSE'], ['Lit HTML', 'lit-html/LICENSE'], ['Lit Element', 'lit-element/LICENSE'], ['Reactive Element', '@lit/reactive-element/LICENSE'], ['Phosphor Icons', '@phosphor-icons/core/LICENSE'],
].map(async ([name, path]) => `${name}\n${'='.repeat(name.length)}\n${await readFile(`node_modules/${path}`, 'utf8')}`));
await writeFile('THIRD_PARTY_NOTICES.txt', licenses.join('\n\n'));
console.log('Built newtab.js, local icon sprite and third-party notices.');
