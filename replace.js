import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/text-\[6px\]/g, 'text-[10px] md:text-xs');
content = content.replace(/text-\[7px\]/g, 'text-xs');
content = content.replace(/text-\[8px\]/g, 'text-xs md:text-sm');
content = content.replace(/text-\[9px\]/g, 'text-sm md:text-base');
content = content.replace(/text-\[10px\]/g, 'text-sm md:text-base');
// Also increase the size of the 2026 badge and main titles
content = content.replace(/text-xs font-black tracking-widest shadow-lg shadow-brand-green-deep\/20/g, 'text-sm md:text-base font-black tracking-widest shadow-lg shadow-brand-green-deep/20');
content = content.replace(/text-3xl font-black tracking-tighter text-brand-green-deep leading-none/g, 'text-4xl md:text-5xl font-black tracking-tighter text-brand-green-deep leading-none');
content = content.replace(/text-3xl font-black tracking-tighter text-slate-800 leading-none/g, 'text-2xl md:text-3xl font-black tracking-tighter text-slate-800 leading-none mt-2');

// Increase bubble size for micro goals
content = content.replace(/w-5 h-5 rounded-md flex items-center/g, 'w-6 h-6 md:w-7 md:h-7 rounded-md flex items-center');
content = content.replace(/CheckCircle2 size=\{10\}/g, 'CheckCircle2 size={14}');

fs.writeFileSync('src/App.tsx', content);
console.log('Replaced text sizes');
