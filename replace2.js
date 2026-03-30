import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/text-xs font-medium focus:border-brand-green-dark/g, 'text-sm md:text-base font-medium focus:border-brand-green-dark');
content = content.replace(/text-xs font-medium text-slate-600 focus:border-brand-green-dark/g, 'text-sm md:text-base font-medium text-slate-600 focus:border-brand-green-dark');

fs.writeFileSync('src/App.tsx', content);
console.log('Replaced input text sizes');
