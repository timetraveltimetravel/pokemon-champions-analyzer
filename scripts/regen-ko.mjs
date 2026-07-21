// ko.json만 재생성 (PokeAPI만 사용 — smogon 연결 불가 시에도 동작)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {KO_QUERY, buildKoData} from './ko-lib.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'gen');

const res = await fetch('https://beta.pokeapi.co/graphql/v1beta', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({query: KO_QUERY}),
});
const gql = await res.json();
if (gql.errors) throw new Error('GraphQL 오류: ' + JSON.stringify(gql.errors));
const ko = buildKoData(gql.data);
fs.writeFileSync(path.join(OUT, 'ko.json'), JSON.stringify(ko));
console.log(`ko.json: 포켓몬 ${Object.keys(ko.species).length}, 설명 ${Object.keys(ko.moveDesc).length}, 효과 ${Object.keys(ko.moveFx).length}`);
