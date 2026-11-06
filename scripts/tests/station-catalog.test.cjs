/* eslint-disable @typescript-eslint/no-require-imports -- Node loads the real TypeScript helper. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('../analyst-ts-loader.cjs');
const {validateStationCatalog,filterStationRows,stationFromRow,stationCatalogTechnology}=load('lib/analyst/station-catalog.ts');
const fixture=()=>({schemaVersion:'lte-station-catalog-v1',source:{file:'inventory.xlsx',sha256:'a'.repeat(64),fileDate:'2026-11-04'},summary:{inputRows:4,invalidRows:1,registeredCells:3,withPci:2,missingPci:1,invalidPci:0,conflictingPci:0,distinctPci:1},rows:[['RU-A','CELL-A',0,37,127,'valid'],['RU-B','CELL-B',0,37.1,127.1,'valid'],['RU-C','CELL-C',null,37.2,127.2,'missing']]});
test('catalog validates shape and preserves valid PCI zero separately from missing',()=>{
 const data=validateStationCatalog(fixture());
 assert.equal(stationFromRow(data.rows[0],data.source.file).pci,0);
 assert.equal(stationFromRow(data.rows[2],data.source.file).pci,null);
 assert.throws(()=>validateStationCatalog({...fixture(),schemaVersion:'bad'}));
 const invalid=fixture();invalid.rows[0][2]=504;
 assert.throws(()=>validateStationCatalog(invalid));
});
test('PCI filter is exact and RU / Cell query can be combined without selecting an unrelated sector',()=>{
 const {rows}=fixture();
 assert.deepEqual(filterStationRows(rows,'','0'),rows.slice(0,2));
 assert.deepEqual(filterStationRows(rows,'cell-b','0'),[rows[1]]);
 assert.equal(filterStationRows(rows,'RU-A','4').length,0);
 assert.deepEqual(filterStationRows(rows,'','missing'),[rows[2]]);
 assert.equal(filterStationRows(rows,'','504').length,0);
});
test('partial summaries and inconsistent observation counts cannot reach the UI',()=>{
 assert.throws(()=>validateStationCatalog({...fixture(),summary:{registeredCells:3}}));
 assert.throws(()=>validateStationCatalog({...fixture(),observations:{dates:null}}));
 const observations={sourceRevision:'a'.repeat(20),dates:['2026-10-30'],total:3,exactMatched:2,comparable:1,matched:1,mismatched:0,unregistered:1,unavailable:1};
 assert.equal(validateStationCatalog({...fixture(),observations}).observations.total,3);
 assert.throws(()=>validateStationCatalog({...fixture(),observations:{...observations,total:4}}));
});
const nrFixture=()=>({schemaVersion:'nr-station-catalog-v1',technology:'NR',source:{file:'nr-inventory.xlsx',sha256:'b'.repeat(64),fileDate:'2026-11-06'},summary:{inputRows:5,invalidRows:1,registeredCells:4,withPci:3,missingPci:1,invalidPci:0,conflictingPci:0,distinctPci:3},rows:[['NR0001','0000123',0,37,127,'valid'],['NR0002','0000123',504,37.1,127.1,'valid'],['NR0003','0000456',1007,37.2,127.2,'valid'],['NR0004','0000789',null,37.3,127.3,'missing']]});
test('NR catalog preserves RAT and original identities with PCI zero through 1007',()=>{
 const data=validateStationCatalog(nrFixture());
 assert.equal(stationCatalogTechnology(data),'NR');
 assert.equal(stationCatalogTechnology(validateStationCatalog(fixture())),'LTE');
 assert.deepEqual(data.rows.map(row=>row[2]),[0,504,1007,null]);
 const station=stationFromRow(data.rows[1],data.source.file,'NR');
 assert.equal(station.technology,'NR');
 assert.equal(station.cellId,'0000123');
 assert.equal(station.baseStationId,'NR0002');
 assert.equal(station.inventorySource,'nr-inventory.xlsx');
 assert.equal(stationFromRow(fixture().rows[0],'lte.xlsx').technology,'LTE');
 const invalid=nrFixture();invalid.rows[2][2]=1008;
 assert.throws(()=>validateStationCatalog(invalid),/PCI/);
});
test('NR PCI search uses its own range without widening existing LTE searches',()=>{
 const rows=nrFixture().rows;
 assert.deepEqual(filterStationRows(rows,'','504','NR'),[rows[1]]);
 assert.deepEqual(filterStationRows(rows,'nr0003','1007','NR'),[rows[2]]);
 assert.deepEqual(filterStationRows(rows,'','0','NR'),[rows[0]]);
 assert.deepEqual(filterStationRows(rows,'','missing','NR'),[rows[3]]);
 assert.deepEqual(filterStationRows(rows,'','504'),[]);
 assert.deepEqual(filterStationRows(rows,'','1008','NR'),[]);
 assert.deepEqual(filterStationRows(rows,'0000123','','NR'),rows.slice(0,2));
});
test('schema and technology must agree and LTE observation audits cannot be attached to NR',()=>{
 for(const technology of [undefined,'LTE','5G'])assert.throws(()=>validateStationCatalog({...nrFixture(),technology}),/형식/);
 assert.throws(()=>validateStationCatalog({...fixture(),technology:'NR'}),/형식/);
 assert.equal(validateStationCatalog({...fixture(),technology:'LTE'}).technology,'LTE');
 const observations={sourceRevision:'a'.repeat(20),dates:['2026-10-30'],total:3,exactMatched:2,comparable:1,matched:1,mismatched:0,unregistered:1,unavailable:1};
 assert.throws(()=>validateStationCatalog({...nrFixture(),observations}),/NR|5G/);
});
test('exact RU+Cell duplication is rejected while reused Cell IDs on different RUs are retained',()=>{
 assert.equal(validateStationCatalog(nrFixture()).rows.length,4);
 const data=nrFixture();data.rows[1][0]='NR0001';
 assert.throws(()=>validateStationCatalog(data),/중복/);
 const malformed=nrFixture();malformed.source={file:9,sha256:'',fileDate:'2026-11-06'};
 assert.throws(()=>validateStationCatalog(malformed),/형식/);
});
