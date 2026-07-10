const fs = require('fs');
let content = fs.readFileSync('backend/.env', 'utf8');

const oldDB = 'DATABASE_URL="postgresql://postgres:Y45Ex%26%25.dMsV*Kn@db.wmmyiyjxunxzijgqzksk.supabase.co:5432/postgres"';
const newDB = 'DATABASE_URL="postgresql://postgres.wmmyiyjxunxzijgqzksk:Y45Ex%26%25.dMsV*Kn@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require"';

const oldDirect = 'DIRECT_URL="postgresql://postgres:Y45Ex%26%25.dMsV*Kn@db.wmmyiyjxunxzijgqzksk.supabase.co:5432/postgres"';
const newDirect = 'DIRECT_URL="postgresql://postgres:Y45Ex%26%25.dMsV*Kn@db.wmmyiyjxunxzijgqzksk.supabase.co:5432/postgres?sslmode=require"';

let changes = 0;
if (content.includes(oldDB)) {
  content = content.replace(oldDB, newDB);
  console.log('Updated DATABASE_URL');
  changes++;
} else {
  console.log('DATABASE_URL pattern NOT found in backend/.env');
}

if (content.includes(oldDirect)) {
  content = content.replace(oldDirect, newDirect);
  console.log('Updated DIRECT_URL');
  changes++;
} else {
  console.log('DIRECT_URL pattern NOT found in backend/.env');
}

if (changes > 0) {
  fs.writeFileSync('backend/.env', content, 'utf8');
  console.log('Saved backend/.env successfully!');
} else {
  console.log('No changes needed');
}
