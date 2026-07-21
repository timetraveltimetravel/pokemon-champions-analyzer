// 데이터 파이프라인:
//  1. Smogon 월별 chaos 통계(포켓몬 챔피언스 BSS)를 내려받아 압축 가공
//  2. Showdown pokedex.json에서 @smogon/calc에 없는 종(챔피언스 신규 메가 등) 종족값 추출
//  3. PokeAPI GraphQL에서 한국어 이름(포켓몬/기술/도구/특성) 추출
// 실행: npm run fetch-data  (옵션: node scripts/fetch-data.mjs [format] [rating])

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {Generations} = require('@smogon/calc');
const gen = Generations.get(9);

const FORMAT = process.argv[2] ?? 'gen9championsbssregmb';
const RATING = process.argv[3] ?? '1760';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'gen');

const toID = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

async function findLatestMonth() {
  const now = new Date();
  for (let back = 1; back <= 6; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const url = `https://www.smogon.com/stats/${month}/chaos/${FORMAT}-${RATING}.json`;
    const res = await fetch(url, {method: 'HEAD'});
    if (res.ok) return month;
  }
  throw new Error(`${FORMAT} 통계를 찾을 수 없습니다`);
}

function topEntries(obj, n, total) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => [k, Math.round((v / total) * 1000) / 10])
    .filter(([, pct]) => pct >= 0.5);
}

function parseSpread(key) {
  // "Jolly:2/32/0/0/0/32" → [nature, [hp,atk,def,spa,spd,spe]]
  const [nature, sp] = key.split(':');
  return [nature, sp.split('/').map(Number)];
}

async function main() {
  fs.mkdirSync(OUT, {recursive: true});

  // 1) Smogon 통계 — 상위권(기본 1760) 컷과 전체(0) 컷을 함께 수록
  const month = await findLatestMonth();
  const processChaos = (chaos) => {
    const pokemon = [];
    for (const [name, p] of Object.entries(chaos.data)) {
      const total = Object.values(p.Abilities).reduce((a, b) => a + b, 0);
      if (!total || p.usage < 0.001) continue;
      const spreads = Object.entries(p.Spreads)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => {
          const [nature, sp] = parseSpread(k);
          return [nature, sp, Math.round((v / total) * 1000) / 10];
        });
      pokemon.push({
        name,
        usage: Math.round(p.usage * 10000) / 100,
        count: p['Raw count'],
        abilities: topEntries(p.Abilities, 3, total),
        items: topEntries(p.Items, 6, total),
        moves: topEntries(p.Moves, 14, total),
        spreads,
      });
    }
    pokemon.sort((a, b) => b.usage - a.usage);
    return {battles: chaos.info['number of battles'], pokemon};
  };

  const cuts = {};
  let battles = 0;
  for (const [key, rating] of [['top', RATING], ['all', '0']]) {
    const url = `https://www.smogon.com/stats/${month}/chaos/${FORMAT}-${rating}.json`;
    console.log(`통계 다운로드: ${url}`);
    const {battles: b, pokemon} = processChaos(await (await fetch(url)).json());
    battles = b;
    cuts[key] = {rating: Number(rating), pokemon};
    console.log(`  ${key}(${rating}+): ${pokemon.length}종`);
  }

  const stats = {info: {format: FORMAT, month, battles}, cuts};
  fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(stats));
  const pokemon = cuts.top.pokemon; // 이하 로스터 보강 등은 상위권 컷 기준 + 전체 컷 합집합
  const allCutIds = new Set(cuts.all.pokemon.map((p) => toID(p.name)));
  console.log(`stats.json: 상위권 ${pokemon.length}종 / 전체 ${cuts.all.pokemon.length}종 (${month}, ${battles}판)`);

  // 2) 챔피언스 로스터/학습셋 (Showdown 팀빌더 테이블 — 챔피언스 공식 합법 데이터)
  console.log('Showdown 팀빌더 테이블 다운로드...');
  const tbSrc = await (await fetch('https://play.pokemonshowdown.com/data/teambuilder-tables.js')).text();
  const tbPath = path.join(OUT, '..', '..', 'scripts', '.teambuilder-tables.cjs');
  fs.writeFileSync(tbPath, tbSrc);
  const {BattleTeambuilderTable} = require(tbPath);
  const champs = BattleTeambuilderTable.champions;
  if (!champs) throw new Error('팀빌더 테이블에 champions 섹션이 없습니다');
  // CAP(가상 포켓몬) 구간을 제외한 실제 로스터
  const rosterStart = champs.formatSlices?.AG ?? champs.formatSlices?.Uber ?? 0;
  const roster = champs.tiers.slice(rosterStart).filter((x) => typeof x === 'string');
  const rosterSet = new Set(roster);
  for (const {name} of pokemon) rosterSet.add(toID(name)); // 통계 등장 종은 무조건 포함
  for (const id of allCutIds) rosterSet.add(id);
  console.log(`챔피언스 로스터: ${rosterSet.size}종`);
  const legalItems = champs.items ? champs.items.filter((x) => typeof x === 'string') : [];

  // 챔피언스 기술 밸런스 패치 (위력/타입/분류 변경분만 — 데미지 계산에 영향)
  const moveOverrides = {};
  for (const [mid, v] of Object.entries(champs.overrideMoveData ?? {})) {
    const o = {};
    if (typeof v.basePower === 'number') o.basePower = v.basePower;
    if (typeof v.type === 'string') o.type = v.type;
    if (typeof v.category === 'string') o.category = v.category;
    if (Object.keys(o).length) moveOverrides[mid] = o;
  }
  fs.writeFileSync(path.join(OUT, 'move-overrides.json'), JSON.stringify(moveOverrides));
  console.log(`move-overrides.json: 기술 밸런스 패치 ${Object.keys(moveOverrides).length}건`);

  // 2.2) calc 데이터에 없는 종의 종족값 오버라이드 (Showdown 공식 pokedex)
  console.log('Showdown pokedex 다운로드...');
  const dex = await (await fetch('https://play.pokemonshowdown.com/data/pokedex.json')).json();
  const overrides = {};
  for (const id of rosterSet) {
    if (gen.species.get(id)) continue;
    const e = dex[id];
    if (!e) { console.warn(`  경고: ${id} 데이터 없음`); continue; }
    overrides[id] = {
      name: e.name,
      baseSpecies: e.baseSpecies ?? e.name,
      forme: e.forme ?? '',
      baseStats: e.baseStats,
      types: e.types,
      abilities: Object.values(e.abilities),
      weightkg: e.weightkg,
    };
  }
  // 로스터 종의 배틀 전용 폼(킬가르도-블레이드 등)도 계산용으로 포함
  for (const [id, e] of Object.entries(dex)) {
    if (overrides[id] || gen.species.get(id)) continue;
    const bases = typeof e.battleOnly === 'string' ? [e.battleOnly] : Array.isArray(e.battleOnly) ? e.battleOnly : [];
    if (!bases.some((b) => rosterSet.has(toID(b)))) continue;
    overrides[id] = {
      name: e.name,
      baseSpecies: e.baseSpecies ?? e.name,
      forme: e.forme ?? '',
      baseStats: e.baseStats,
      types: e.types,
      abilities: Object.values(e.abilities),
      weightkg: e.weightkg,
    };
  }
  fs.writeFileSync(path.join(OUT, 'overrides.json'), JSON.stringify(overrides));
  console.log(`overrides.json: ${Object.keys(overrides).length}종`);

  // 2.5) 전체 종 특성 목록 + 메가스톤 등 도구 영문 표기 (Showdown pokedex 기반)
  const abilities = {};
  const itemNames = {};
  const megaStones = {}; // 메가스톤 id → 메가폼 이름
  const hidden = [];
  for (const [id, e] of Object.entries(dex)) {
    if (e.abilities) abilities[id] = Object.values(e.abilities);
    if (e.requiredItem) {
      itemNames[toID(e.requiredItem)] = e.requiredItem;
      if ((e.forme ?? '').includes('Mega')) megaStones[toID(e.requiredItem)] = e.name;
    }
    if (e.requiredItems) for (const it of e.requiredItems) itemNames[toID(it)] = it;
    // 배틀 중에만 존재하는 폼(따라큐-Busted 등)과 토템 폼은 선택 목록에서 숨김 (메가는 유지)
    if ((e.battleOnly && !e.requiredItem && !e.requiredItems) || (e.forme ?? '').includes('Totem')) hidden.push(id);
  }
  fs.writeFileSync(path.join(OUT, 'dexinfo.json'), JSON.stringify({
    abilities, itemNames, megaStones, hidden, roster: [...rosterSet], legalItems,
  }));
  console.log(`dexinfo.json: 특성 ${Object.keys(abilities).length}종, 도구 표기 ${Object.keys(itemNames).length}개, 숨김 폼 ${hidden.length}종, 합법 도구 ${legalItems.length}개`);

  // 2.7) 배울 수 있는 공격기 학습셋 — 챔피언스 공식 학습셋(팀빌더 테이블) 기반, 변화기 제외
  console.log('챔피언스 학습셋 추출...');
  const isDamaging = (mid) => {
    const m = gen.moves.get(mid);
    return !!m && m.category && m.category !== 'Status';
  };
  const learnsets = {};
  const missingMoves = new Set();
  for (const id of rosterSet) {
    // 폼(메가 등)은 학습셋 항목이 없으므로 원종으로 폴백
    let ls = champs.learnsets[id];
    if (!ls) {
      const base = dex[id]?.baseSpecies;
      if (base) ls = champs.learnsets[toID(base)];
      // 원종 키도 없으면 같은 계열 폼의 학습셋으로 폴백 (예: floettemega → floetteeternal)
      if (!ls && base) {
        const baseId = toID(base);
        const alt = Object.keys(champs.learnsets).find((k) => k.startsWith(baseId));
        if (alt) ls = champs.learnsets[alt];
      }
    }
    if (!ls) { console.warn(`  경고: ${id} 학습셋 없음`); continue; }
    const ids = Object.keys(ls).filter((mid) => {
      if (gen.moves.get(mid)) return isDamaging(mid);
      missingMoves.add(mid);
      return false;
    });
    if (ids.length) learnsets[id] = ids;
  }
  if (missingMoves.size) console.warn(`  계산기 미지원 기술 ${missingMoves.size}개 제외: ${[...missingMoves].join(', ')}`);
  fs.writeFileSync(path.join(OUT, 'learnsets.json'), JSON.stringify(learnsets));
  const lsSize = fs.statSync(path.join(OUT, 'learnsets.json')).size;
  console.log(`learnsets.json: ${Object.keys(learnsets).length}종, ${(lsSize / 1024).toFixed(0)}KB`);

  // 3) 한국어 이름·설명·기술 효과 (PokeAPI GraphQL, language_id 3 = 한국어)
  console.log('PokeAPI 한국어 데이터 다운로드...');
  const {KO_QUERY, buildKoData} = await import('./ko-lib.mjs');
  const res = await fetch('https://beta.pokeapi.co/graphql/v1beta', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query: KO_QUERY}),
  });
  const gql = await res.json();
  if (gql.errors) throw new Error('GraphQL 오류: ' + JSON.stringify(gql.errors));
  const ko = buildKoData(gql.data);
  fs.writeFileSync(path.join(OUT, 'ko.json'), JSON.stringify(ko));
  console.log(`ko.json: 포켓몬 ${Object.keys(ko.species).length}, 기술 ${Object.keys(ko.moves).length}, 설명 ${Object.keys(ko.moveDesc).length}, 효과 ${Object.keys(ko.moveFx).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
