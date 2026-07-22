// 데미지 계산 감사: 9세대 공식을 독립 구현해 @smogon/calc 결과와 대조
// 실행: node scripts/debug-calc.mjs
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {calculate, Generations, Pokemon, Move, Field} = require('@smogon/calc');
const gen = Generations.get(9);

const sp2ev = (s) => (s <= 0 ? 0 : 8 * s - 4);
const evs = (sp) => ({hp: sp2ev(sp[0]), atk: sp2ev(sp[1]), def: sp2ev(sp[2]), spa: sp2ev(sp[3]), spd: sp2ev(sp[4]), spe: sp2ev(sp[5])});
const IVS = {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31};

// 독립 구현: 9세대 데미지 공식 (레벨 50, 급소 없음, 싱글)
// 적용 순서: 기본식 → 날씨 → 난수 → 자속 → 타입상성 → 최종배율
const pokeRound = (n) => (n % 1 > 0.5 ? Math.ceil(n) : Math.floor(n));
function manualDamage({bp, atk, def, stab, eff, atkStage = 0, defStage = 0, atkItemMod = 1, weatherMod = 4096, finalMod = 4096}) {
  const stageMul = (s) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
  const A = Math.floor(Math.floor(atk * stageMul(atkStage)) * atkItemMod);
  const D = Math.floor(def * stageMul(defStage));
  let base = Math.floor(Math.floor(Math.floor((22 * bp * A) / D) / 50) + 2);
  if (weatherMod !== 4096) base = pokeRound((base * weatherMod) / 4096);
  const rolls = [];
  for (let r = 85; r <= 100; r++) {
    let dmg = Math.floor((base * r) / 100);
    if (stab !== 1) dmg = pokeRound((dmg * Math.round(stab * 4096)) / 4096);
    dmg = Math.floor(dmg * eff);
    if (finalMod !== 4096) dmg = pokeRound((dmg * finalMod) / 4096);
    rolls.push(dmg);
  }
  return [rolls[0], rolls[15]];
}

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got[0] === want[0] && got[1] === want[1];
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}: calc=[${got}] manual=[${want}]`);
}
// 배율이 실제로 적용됐는지(미적용 버그 탐지) 비율로 확인
function checkRatio(name, base, got, expected, tol = 0.06) {
  const r = got[1] / base[1];
  const ok = Math.abs(r - expected) <= tol;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}: [${base}] → [${got}] 비율 ${r.toFixed(3)} (기대 ${expected})`);
}

const mk = (name, opts) => new Pokemon(gen, name, {level: 50, ivs: IVS, ...opts});
const dmg = (a, d, move, opts, field) => calculate(gen, a, d.clone(), new Move(gen, move, opts), field).range();

console.log('=== A. 기본 공식 ===');
{
  const a = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  const d = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  check('자속 지진 (미러)', dmg(a, d, 'Earthquake'), manualDamage({bp: 100, atk: 182, def: 115, stab: 1.5, eff: 1}));
  check('자속+2배 역린', dmg(a, d, 'Outrage'), manualDamage({bp: 120, atk: 182, def: 115, stab: 1.5, eff: 2}));
  check('공+2 vs 방+1 지진',
    dmg(mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32]), boosts: {atk: 2}}),
        mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32]), boosts: {def: 1}}), 'Earthquake'),
    manualDamage({bp: 100, atk: 182, def: 115, stab: 1.5, eff: 1, atkStage: 2, defStage: 1}));
}
{
  const a = mk('Mimikyu', {nature: 'Adamant', evs: evs([1, 32, 1, 0, 0, 32]), item: 'Life Orb'});
  const d = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  check('생구 치근거리기', dmg(a, d, 'Play Rough'),
    manualDamage({bp: 90, atk: 156, def: 115, stab: 1.5, eff: 2, finalMod: 5324}));
}
{
  const a = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32]), item: 'Choice Band'});
  const d = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  check('구애머리띠 지진', dmg(a, d, 'Earthquake'),
    manualDamage({bp: 100, atk: 182, def: 115, stab: 1.5, eff: 1, atkItemMod: 1.5}));
}
{
  const a = mk('Blissey', {nature: 'Bold', evs: evs([32, 0, 32, 0, 0, 0])});
  const d = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  const r = dmg(a, d, 'Seismic Toss');
  const ok = r[0] === 50 && r[1] === 50;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} 지구던지기 고정 50: calc=[${r}]`);
}
{
  const r = dmg(mk('Raichu', {nature: 'Timid', evs: evs([0, 0, 0, 32, 0, 32])}),
                mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])}), 'Thunderbolt');
  const ok = r[0] === 0 && r[1] === 0;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} 전기→땅 무효: calc=[${r}]`);
}
{
  const a = mk('Golisopod', {nature: 'Adamant', evs: evs([0, 32, 0, 0, 0, 0])});
  const d = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  check('만나자마자 (챔피언스 패치 100)', dmg(a, d, 'First Impression', {overrides: {basePower: 100}}),
    manualDamage({bp: 100, atk: a.stats.atk, def: 115, stab: 1.5, eff: 1}));
}
{
  const p = mk('Garchomp', {nature: 'Adamant', evs: evs([7, 13, 0, 1, 32, 8])});
  const expect = {hp: 108 + 75 + 7, atk: Math.floor((130 + 20 + 13) * 1.1), def: 95 + 20 + 0,
    spa: Math.floor((80 + 20 + 1) * 0.9), spd: 85 + 20 + 32, spe: 102 + 20 + 8};
  const got = {hp: p.maxHP(), ...p.stats};
  const ok = Object.entries(expect).every(([k, v]) => got[k] === v);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} SP 변환 실능: ${JSON.stringify(got)}`);
}

console.log('\n=== B. 날씨 ===');
{
  const zard = mk('Charizard', {nature: 'Modest', evs: evs([0, 0, 0, 32, 0, 32])});
  const chomp = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  const baseFire = dmg(zard, chomp, 'Flamethrower');
  // 불꽃 → 한카리아스(드래곤/땅): 드래곤 0.5 × 땅 1 = 0.5배
  check('쾌청 불꽃 (×1.5)', dmg(zard, chomp, 'Flamethrower', undefined, new Field({weather: 'Sun'})),
    manualDamage({bp: 90, atk: zard.stats.spa, def: chomp.stats.spd, stab: 1.5, eff: 0.5, weatherMod: 6144}));
  check('비 불꽃 (×0.5)', dmg(zard, chomp, 'Flamethrower', undefined, new Field({weather: 'Rain'})),
    manualDamage({bp: 90, atk: zard.stats.spa, def: chomp.stats.spd, stab: 1.5, eff: 0.5, weatherMod: 2048}));
  console.log(`   (무날씨 기준값 [${baseFire}])`);
  const prim = mk('Primarina', {nature: 'Modest', evs: evs([0, 0, 0, 32, 0, 0])});
  check('비 물 (×1.5)', dmg(prim, chomp, 'Surf', undefined, new Field({weather: 'Rain'})),
    manualDamage({bp: 90, atk: prim.stats.spa, def: chomp.stats.spd, stab: 1.5, eff: 1, weatherMod: 6144}));
}
{
  // 모래바람: 바위타입 특방 1.5배 (특수만) / 물리는 불변
  const prim = mk('Primarina', {nature: 'Modest', evs: evs([0, 0, 0, 32, 0, 0])});
  const luc = mk('Lucario-Mega', {nature: 'Adamant', evs: evs([0, 32, 0, 0, 0, 32])});
  const tyr = mk('Tyranitar', {nature: 'Adamant', evs: evs([2, 32, 0, 0, 0, 32])});
  const spBase = dmg(prim, tyr, 'Surf');
  checkRatio('모래: 특수기 vs 바위 (특방1.5 → 약 0.67배)', spBase, dmg(prim, tyr, 'Surf', undefined, new Field({weather: 'Sand'})), 0.667);
  const phBase = dmg(luc, tyr, 'Close Combat');
  const phSand = dmg(luc, tyr, 'Close Combat', undefined, new Field({weather: 'Sand'}));
  const same = phBase[0] === phSand[0] && phBase[1] === phSand[1];
  same ? pass++ : fail++;
  console.log(`${same ? '✅' : '❌'} 모래: 물리기 vs 바위는 불변 (사용자 보고 케이스): [${phBase}] → [${phSand}]`);
}
{
  // 싸라기눈: 얼음타입 방어 1.5배 (물리만)
  const chomp = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  const glalie = mk('Glalie', {nature: 'Adamant', evs: evs([2, 0, 0, 0, 0, 0])});
  const base = dmg(chomp, glalie, 'Earthquake');
  checkRatio('눈: 물리기 vs 얼음 (방어1.5 → 약 0.67배)', base, dmg(chomp, glalie, 'Earthquake', undefined, new Field({weather: 'Snow'})), 0.667);
}

console.log('\n=== C. 필드(터레인) ===');
{
  const raichu = mk('Raichu', {nature: 'Timid', evs: evs([0, 0, 0, 32, 0, 32])});
  const meta = mk('Metagross-Mega', {nature: 'Adamant', evs: evs([2, 32, 0, 0, 0, 0])});
  const base = dmg(raichu, meta, 'Thunderbolt');
  checkRatio('일렉필드: 지상 사용자 전기기 ×1.3', base, dmg(raichu, meta, 'Thunderbolt', undefined, new Field({terrain: 'Electric'})), 1.3);
  const chomp = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  const eqBase = dmg(chomp, meta, 'Earthquake');
  checkRatio('그래스필드: 지진 ×0.5', eqBase, dmg(chomp, meta, 'Earthquake', undefined, new Field({terrain: 'Grassy'})), 0.5);
  // 비행 타입은 필드 영향 없음
  const zard = mk('Charizard', {nature: 'Modest', evs: evs([0, 0, 0, 32, 0, 32])});
  const zb = dmg(zard, meta, 'Flamethrower');
  const zg = dmg(zard, meta, 'Flamethrower', undefined, new Field({terrain: 'Grassy'}));
  const unaffected = zb[0] === zg[0] && zb[1] === zg[1];
  unaffected ? pass++ : fail++;
  console.log(`${unaffected ? '✅' : '❌'} 필드는 비행(비지상) 사용자에게 미적용: [${zb}] → [${zg}]`);
}

console.log('\n=== D. 특성 ===');
{
  const chomp = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  const luc = mk('Lucario', {nature: 'Adamant', evs: evs([0, 32, 0, 0, 0, 32]), ability: 'Steadfast'});
  const lucA = mk('Lucario', {nature: 'Adamant', evs: evs([0, 32, 0, 0, 0, 32]), ability: 'Adaptability'});
  checkRatio('적응력: 자속 1.5→2.0 (×1.33)', dmg(luc, chomp, 'Aura Sphere'), dmg(lucA, chomp, 'Aura Sphere'), 1.333);
  const metaN = mk('Metagross', {nature: 'Adamant', evs: evs([0, 32, 0, 0, 0, 0]), ability: 'Clear Body'});
  const metaT = mk('Metagross', {nature: 'Adamant', evs: evs([0, 32, 0, 0, 0, 0]), ability: 'Tough Claws'});
  checkRatio('단단한발톱: 접촉기 ×1.3', dmg(metaN, chomp, 'Zen Headbutt'), dmg(metaT, chomp, 'Zen Headbutt'), 1.3);
  const scizN = mk('Scizor', {nature: 'Adamant', evs: evs([0, 32, 0, 0, 0, 0]), ability: 'Swarm'});
  const scizT = mk('Scizor', {nature: 'Adamant', evs: evs([0, 32, 0, 0, 0, 0]), ability: 'Technician'});
  checkRatio('테크니션: 위력60이하 ×1.5', dmg(scizN, chomp, 'Bullet Punch'), dmg(scizT, chomp, 'Bullet Punch'), 1.5);
  const mawN = mk('Mawile', {nature: 'Adamant', evs: evs([0, 32, 0, 0, 0, 0]), ability: 'Intimidate'});
  const mawH = mk('Mawile', {nature: 'Adamant', evs: evs([0, 32, 0, 0, 0, 0]), ability: 'Huge Power'});
  checkRatio('천하장사: 공격 실능 2배', dmg(mawN, chomp, 'Play Rough'), dmg(mawH, chomp, 'Play Rough'), 2.0, 0.1);
}
{
  // 방어 특성
  const zard = mk('Charizard', {nature: 'Modest', evs: evs([0, 0, 0, 32, 0, 32])});
  const snorN = mk('Snorlax', {nature: 'Careful', evs: evs([32, 0, 0, 0, 32, 0]), ability: 'Immunity'});
  const snorT = mk('Snorlax', {nature: 'Careful', evs: evs([32, 0, 0, 0, 32, 0]), ability: 'Thick Fat'});
  checkRatio('두꺼운지방: 불꽃 데미지 ×0.5', dmg(zard, snorN, 'Flamethrower'), dmg(zard, snorT, 'Flamethrower'), 0.5);
  const dragN = mk('Dragonite', {nature: 'Careful', evs: evs([32, 0, 0, 0, 0, 0]), ability: 'Inner Focus'});
  const dragM = mk('Dragonite', {nature: 'Careful', evs: evs([32, 0, 0, 0, 0, 0]), ability: 'Multiscale'});
  checkRatio('멀티스케일: HP만땅 데미지 ×0.5', dmg(zard, dragN, 'Flamethrower'), dmg(zard, dragM, 'Flamethrower'), 0.5);
}

console.log('\n=== E. 도구 ===');
{
  const chomp = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  const prim = mk('Primarina', {nature: 'Modest', evs: evs([0, 0, 0, 32, 0, 0])});
  const primSpecs = mk('Primarina', {nature: 'Modest', evs: evs([0, 0, 0, 32, 0, 0]), item: 'Choice Specs'});
  checkRatio('구애안경: 특공 ×1.5', dmg(prim, chomp, 'Surf'), dmg(primSpecs, chomp, 'Surf'), 1.5, 0.08);
  const primWater = mk('Primarina', {nature: 'Modest', evs: evs([0, 0, 0, 32, 0, 0]), item: 'Mystic Water'});
  checkRatio('신비의물방울: 물 기술 ×1.2', dmg(prim, chomp, 'Surf'), dmg(primWater, chomp, 'Surf'), 1.2);
  // 약점 상황에서 전문가벨트 ×1.2
  const glalie = mk('Glalie', {nature: 'Adamant', evs: evs([2, 0, 0, 0, 0, 0])});
  const chompBelt = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32]), item: 'Expert Belt'});
  checkRatio('전문가벨트: 약점 공격 ×1.2', dmg(chomp, glalie, 'Iron Head'), dmg(chompBelt, glalie, 'Iron Head'), 1.2);
  // 돌격조끼: 특방 ×1.5
  const chompAV = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32]), item: 'Assault Vest'});
  checkRatio('돌격조끼: 특수 데미지 ×0.67', dmg(prim, chomp, 'Surf'), dmg(prim, chompAV, 'Surf'), 0.667);
}

console.log('\n=== F. 표시(%) 계산 ===');
{
  const a = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  const d = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  const [lo, hi] = dmg(a, d, 'Earthquake');
  const maxHP = d.maxHP();
  const minPct = Math.floor((lo / maxHP) * 1000) / 10;
  const maxPct = Math.floor((hi / maxHP) * 1000) / 10;
  const ok = Math.abs(minPct - (lo / maxHP) * 100) < 0.1 && Math.abs(maxPct - (hi / maxHP) * 100) < 0.1;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} % 변환: ${lo}~${hi} / HP ${maxHP} → ${minPct}%~${maxPct}%`);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
