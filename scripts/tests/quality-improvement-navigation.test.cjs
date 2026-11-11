/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness. */
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
test('improvement navigation is same quality page and old standalone only redirects',()=>{
const nav=fs.readFileSync('components/analyst/quality-top-nav.tsx','utf8');
assert(!nav.includes('>개선 1안</Link>'));assert(nav.includes('qualityHref'));
const old=fs.readFileSync('app/overview-improvement-1/page.tsx','utf8');assert(old.includes('redirect('));assert(!old.includes('VoiceImprovementOneWorkspace'));assert(old.includes("redirect('/?'"));
});
