import {execFileSync} from 'node:child_process';
import {readFileSync, rmSync} from 'node:fs';

const {uuid} = JSON.parse(readFileSync('dist/metadata.json', 'utf8'));
const archive = `${uuid}.shell-extension.zip`;
rmSync(archive, {force: true});
execFileSync('zip', ['-qr', `../${archive}`, '.'], {cwd: 'dist', stdio: 'inherit'});
console.log(archive);
