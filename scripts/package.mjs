import {cpSync, mkdirSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

mkdirSync('dist', {recursive: true});
for (const name of ['metadata.json', 'stylesheet.css', 'schemas'])
    cpSync(`extension/${name}`, `dist/${name}`, {recursive: true});
execFileSync('glib-compile-schemas', ['--strict', 'dist/schemas'], {stdio: 'inherit'});
const {uuid} = JSON.parse(readFileSync('dist/metadata.json', 'utf8'));
console.log(`Built ${uuid} in dist/`);
