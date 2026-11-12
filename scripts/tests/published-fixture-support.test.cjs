const {test}=require('node:test'),assert=require('node:assert/strict');
const {requiresHistoricalFixture}=require('./published-fixture.cjs');
test('missing historical data never silently substitutes a different active cohort',()=>{
 assert.equal(requiresHistoricalFixture(false,'da0b8405340fe0ea2459',false),true);
 assert.equal(requiresHistoricalFixture(true,'da0b8405340fe0ea2459',false),false);
 assert.equal(requiresHistoricalFixture(false,'79840583bdb8e36221c2',false),false);
 assert.equal(requiresHistoricalFixture(false,'da0b8405340fe0ea2459',true),false);
});
