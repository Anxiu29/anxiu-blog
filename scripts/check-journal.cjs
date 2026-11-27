const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const built = process.argv.includes('--built');
const checks = [
 'check-deployment.cjs', 'check-daily-quote.cjs', 'check-background-video.cjs', 'check-background-photos.cjs', 'check-post-view.cjs', 'check-navigation-layers.cjs',
 'check-journal-reading.cjs', 'check-reading-resume.cjs', 'check-journal-media.cjs',
 'check-journal-discovery.cjs', 'check-authoring.mjs',
 'check-authoring-interactions.mjs', 'check-new-post.mjs',
 'check-journal-covers.cjs', 'check-journal-article.cjs',
 'check-journal-search.cjs', 'check-journal-archive.cjs',
 'check-journal-todo.cjs', 'check-journal-music.cjs', 'check-music-pet-drag.cjs', 'check-music-sources.cjs', 'check-journal-navigation.cjs', 'check-search-loader.cjs', 'check-saved-articles.cjs', 'check-scroll-tools.cjs', 'check-public-index.mjs',
 ...(built ? ['check-music-page.cjs','check-journal-shell.cjs'] : [])
];
const builtAware = new Set(['check-deployment.cjs','check-public-index.mjs','check-journal-covers.cjs','check-journal-article.cjs','check-journal-search.cjs','check-journal-archive.cjs']);
let failures = 0;
for (const file of checks) {
 console.log(`\nRunning ${file}${built && builtAware.has(file) ? ' --built' : ''}`);
 const result = spawnSync(process.execPath,[path.join(__dirname,file),...(built && builtAware.has(file)?['--built']:[])],{cwd:root,stdio:'inherit'});
 if(result.error || result.status !== 0) {
  failures++;
  if(result.error)console.error(result.error.message);
 }
}
console.log(`\nJournal checks: ${checks.length-failures}/${checks.length} scripts passed.`);
process.exitCode=failures ? 1 : 0;
