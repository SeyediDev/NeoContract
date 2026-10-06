import { readFileSync } from 'node:fs';

export const centerKeys = ['abrgan','karavan','kavan','peyvand','dana','bonyan','fanasa-cloud','asman','kerane','rayan','dejan','ayin','didban','tarazu'];
const svg = name => readFileSync(new URL('../public/assets/brand/'+name,import.meta.url),'utf8').replace(/<\?xml[^>]*\?>/g,'');
export const parentLogo = svg('fanasa-logo-horizontal-fa-color.svg');
export const centerLogos = new Map(centerKeys.map(key=>[key,svg('center-'+key+'-lockup-fa-color.svg')]));
