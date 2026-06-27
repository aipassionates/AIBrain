'use strict';
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync('C:\\tools\\data\\ga4-data.json','utf8')).rows || [];

function normPath(p){ return p === '/' ? '' : (p||'').replace(/\/$/,''); }
function fullUrl(p){ return 'https://passionates.com' + normPath(p); }

const groups = new Map();
for (const r of rows){
  const u = fullUrl(r.pagePath);
  if(!groups.has(u)) groups.set(u, []);
  groups.get(u).push({ path: r.pagePath, users: Number(r.activeUsers)||0 });
}

let collisions = 0, lostUsers = 0;
const examples = [];
for (const [u, arr] of groups){
  if (arr.length > 1){
    collisions++;
    arr.sort((a,b)=>b.users-a.users);
    const max = arr[0].users;
    const sum = arr.reduce((s,x)=>s+x.users,0);
    // last-wins picks arr in original order's last; approximate worst loss = sum - last
    lostUsers += (sum - max);
    if (examples.length < 15) examples.push({ url: u.replace('https://passionates.com','')||'/', variants: arr, sum, max });
  }
}

console.log(`Total GA4 export rows: ${rows.length}`);
console.log(`Distinct normalized URLs: ${groups.size}`);
console.log(`URLs with >1 collapsing path variant (collision): ${collisions}`);
console.log(`Approx users at risk from last-write-wins (sum-max): ${lostUsers}\n`);

// Homepage specifically
console.log('HOMEPAGE rows (map to https://passionates.com):');
for (const v of (groups.get('https://passionates.com')||[])) console.log(`   pagePath=${JSON.stringify(v.path)}  users=${v.users}`);

console.log('\nTop collision examples (url -> variants):');
for (const e of examples) {
  console.log(`  ${e.url}  [sum=${e.sum} max=${e.max}]`);
  for (const v of e.variants) console.log(`       ${JSON.stringify(v.path)} = ${v.users}`);
}
