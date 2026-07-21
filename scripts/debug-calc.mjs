// 데미지 계산 디버깅: 9세대 공식을 독립 구현해 @smogon/calc 결과와 대조
// 실행: node scripts/debug-calc.mjs
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {calculate, Generations, Pokemon, Move} = require('@smogon/calc');
const gen = Generations.get(9);

const sp2ev = (s) => (s <= 0 ? 0 : 8 * s - 4);
const evs = (sp) => ({hp: sp2ev(sp[0]), atk: sp2ev(sp[1]), def: sp2ev(sp[2]), spa: sp2ev(sp[3]), spd: sp2ev(sp[4]), spe: sp2ev(sp[5])});
const IVS = {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31};

// 독립 구현: 9세대 데미지 공식 (레벨 50, 급소 없음, 싱글)
const pokeRound = (n) => (n % 1 > 0.5 ? Math.ceil(n) : Math.floor(n));
function manualDamage({bp, atk, def, stab, eff, atkStage = 0, defStage = 0, atkItemMod = 1, finalMod = 4096}) {
  const stageMul = (s) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
  const A = Math.floor(Math.floor(atk * stageMul(atkStage)) * atkItemMod);
  const D = Math.floor(def * stageMul(defStage));
  const base = Math.floor(Math.floor(Math.floor((22 * bp * A) / D) / 50) + 2);
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

const mk = (name, opts) => new Pokemon(gen, name, {level: 50, ivs: IVS, ...opts});
const dmg = (a, d, move, opts) => calculate(gen, a, d, new Move(gen, move, opts)).range();

// 1) 자속 + 상성 1배: 한카리아스(명랑 공32) 지진 → 한카리아스(무보정)
{
  const a = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  const d = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  check('자속 지진 (미러)', dmg(a, d, 'Earthquake'), manualDamage({bp: 100, atk: 182, def: 115, stab: 1.5, eff: 1}));
}
// 2) 상성 2배 + 자속: 역린 (드래곤 → 드래곤)
{
  const a = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  const d = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  check('자속+2배 역린', dmg(a, d, 'Outrage'), manualDamage({bp: 120, atk: 182, def: 115, stab: 1.5, eff: 2}));
}
// 3) 생명의구슬 (최종 배율 5324/4096)
{
  const a = mk('Mimikyu', {nature: 'Adamant', evs: evs([1, 32, 1, 0, 0, 32]), item: 'Life Orb'});
  const d = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  check('생구 치근거리기 (자속+2배)', dmg(a, d, 'Play Rough'),
    manualDamage({bp: 90, atk: 156, def: 115, stab: 1.5, eff: 2, finalMod: 5324}));
}
// 4) 구애머리띠 (공격 스탯 ×1.5)
{
  const a = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32]), item: 'Choice Band'});
  const d = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  check('구애머리띠 지진', dmg(a, d, 'Earthquake'),
    manualDamage({bp: 100, atk: 182, def: 115, stab: 1.5, eff: 1, atkItemMod: 1.5}));
}
// 5) 랭크 +2 / 방어 랭크 +1
{
  const a = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32]), boosts: {atk: 2}});
  const d = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32]), boosts: {def: 1}});
  check('공+2 vs 방+1 지진', dmg(a, d, 'Earthquake'),
    manualDamage({bp: 100, atk: 182, def: 115, stab: 1.5, eff: 1, atkStage: 2, defStage: 1}));
}
// 6) 돌격조끼 (특방 ×1.5)
{
  const a = mk('Primarina', {nature: 'Modest', evs: evs([0, 0, 0, 32, 0, 0])});
  const d = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32]), item: 'Assault Vest'});
  // 물 → 드래곤/땅 = 2 × 0.5 = 1배
  const spa = a.stats.spa, spd = Math.floor(d.stats.spd * 1.5);
  check('돌격조끼 하이드로펌프 (자속, 상성 1배)', dmg(a, d, 'Hydro Pump'),
    manualDamage({bp: 110, atk: spa, def: spd, stab: 1.5, eff: 1}));
}
// 7) 고정 데미지 (지구던지기 = 레벨 50)
{
  const a = mk('Blissey', {nature: 'Bold', evs: evs([32, 0, 32, 0, 0, 0])});
  const d = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  const r = dmg(a, d, 'Seismic Toss');
  const ok = r[0] === 50 && r[1] === 50;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} 지구던지기 고정 50: calc=[${r}]`);
}
// 8) 타입 무효 (전기 → 땅)
{
  const a = mk('Raichu', {nature: 'Timid', evs: evs([0, 0, 0, 32, 0, 32])});
  const d = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  const r = dmg(a, d, 'Thunderbolt');
  const ok = r[0] === 0 && r[1] === 0;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} 전기→땅 무효: calc=[${r}]`);
}
// 9) 챔피언스 기술 패치 (만나자마자 90→100) — 앱 엔진과 동일한 오버라이드 방식
{
  const a = mk('Golisopod', {nature: 'Adamant', evs: evs([0, 32, 0, 0, 0, 0])});
  const d = mk('Garchomp', {nature: 'Jolly', evs: evs([2, 32, 0, 0, 0, 32])});
  check('만나자마자 (패치 100)', dmg(a, d, 'First Impression', {overrides: {basePower: 100}}),
    manualDamage({bp: 100, atk: a.stats.atk, def: 115, stab: 1.5, eff: 1}));
}
// 10) SP 변환 실능 검증 (전 스탯, 홀짝 SP 혼합)
{
  const p = mk('Garchomp', {nature: 'Adamant', evs: evs([7, 13, 0, 1, 32, 8])});
  // 레벨 50 실능: 일반 스탯 = (종족값 + 20 + SP) × 성격, HP = 종족값 + 75 + SP
  const expect = {
    hp: 108 + 75 + 7,
    atk: Math.floor((130 + 20 + 13) * 1.1),
    def: 95 + 20 + 0,
    spa: Math.floor((80 + 20 + 1) * 0.9),
    spd: 85 + 20 + 32,
    spe: 102 + 20 + 8,
  };
  const got = {hp: p.maxHP(), ...p.stats};
  const ok = Object.entries(expect).every(([k, v]) => got[k] === v);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} SP 변환 실능 (7/13/0/1/32/8): calc=${JSON.stringify(got)} 기대=${JSON.stringify(expect)}`);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
