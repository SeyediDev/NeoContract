import { readFileSync } from 'node:fs';

export const centerKeys = ['abrgan','karavan','kavan','peyvand','dana','bonyan','fanasa-cloud','asman','kerane','rayan','dejan','ayin','didban','tarazu'];
const svg = name => readFileSync(new URL('../public/assets/brand/'+name,import.meta.url),'utf8').replace(/<\?xml[^>]*\?>/g,'');
export const parentLogo = svg('fanasa-logo-horizontal-fa-color.svg');
export const centerLogos = new Map(centerKeys.map(key=>[key,svg('center-'+key+'-lockup-fa-color.svg')]));
// Keep exported HTML printable offline with the same licensed font as the app.
export const documentFontCss=readFileSync(new URL('../public/assets/fonts/vazirmatn.css',import.meta.url),'utf8').replace(/url\(\.\/(Vazirmatn-[A-Za-z]+\.woff2)\)/g,(_,file)=>'url(data:font/woff2;base64,'+readFileSync(new URL('../public/assets/fonts/'+file,import.meta.url)).toString('base64')+')');
