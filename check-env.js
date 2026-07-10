const fs = require('fs');
const content = fs.readFileSync('backend/.env', 'utf8');
console.log('Full backend/.env content:');
console.log(content);
