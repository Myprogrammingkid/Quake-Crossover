const fs=require('fs');
let h=fs.readFileSync('shell.html','utf8');
h=h.replace('/*CORE*/',()=>fs.readFileSync('core.js','utf8')).replace('/*NET*/',()=>fs.readFileSync('netcore.js','utf8')).replace('/*GAME*/',()=>fs.readFileSync('game.js','utf8'));
fs.writeFileSync('index.html',h); console.log(h.length);
