// 계산 엔진: @smogon/calc(젠9) 위에 포켓몬 챔피언스 규칙(SP 육성, 신규 메가)을 얹는 계층
import {calculate, Generations, Move, Pokemon} from '@smogon/calc';
import type {Result} from '@smogon/calc';
import statsJson from './gen/stats.json';
import overridesJson from './gen/overrides.json';
import koJson from './gen/ko.json';
import dexinfoJson from './gen/dexinfo.json';
import learnsetsJson from './gen/learnsets.json';
import moveOverridesJson from './gen/move-overrides.json';
import {ABILITY_FX} from './ability-fx';

export const gen = Generations.get(9);

export const toID = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- 데이터 ----------
export interface SpreadEntry { 0: string; 1: number[]; 2: number }
export interface StatsMon {
  name: string;
  usage: number;
  count: number;
  abilities: [string, number][];
  items: [string, number][];
  moves: [string, number][];
  spreads: [string, number[], number][];
}
export interface StatsFile {
  info: {format: string; month: string; rating: number; battles: number};
  pokemon: StatsMon[];
}
export const STATS = statsJson as unknown as StatsFile;

interface Override {
  name: string;
  baseSpecies: string;
  forme: string;
  baseStats: {hp: number; atk: number; def: number; spa: number; spd: number; spe: number};
  types: string[];
  abilities: string[];
  weightkg: number;
}
export const OVERRIDES = overridesJson as unknown as Record<string, Override>;

const DEXINFO = dexinfoJson as unknown as {
  abilities: Record<string, string[]>;
  itemNames: Record<string, string>;
  hidden: string[];
  roster: string[];
  legalItems: string[];
};
const HIDDEN = new Set(DEXINFO.hidden ?? []);
export const LEGAL_ITEMS = new Set(DEXINFO.legalItems ?? []);

const LEARNSETS = learnsetsJson as unknown as Record<string, string[]>;

// 챔피언스 기술 밸런스 패치 (위력/타입/분류)
const MOVE_OVERRIDES = moveOverridesJson as unknown as Record<
  string,
  {basePower?: number; type?: string; category?: string}
>;

const KO = koJson as unknown as {
  species: Record<string, string>;
  moves: Record<string, string>;
  items: Record<string, string>;
  abilities: Record<string, string>;
  moveDesc: Record<string, string>;
  abilityDesc: Record<string, string>;
  itemDesc: Record<string, string>;
  moveFx: Record<string, string>;
};

// ---------- 한국어 이름 ----------
export const NATURE_KO: Record<string, string> = {
  Hardy: '노력', Lonely: '외로움', Brave: '용감', Adamant: '고집', Naughty: '개구쟁이',
  Bold: '대담', Docile: '온순', Relaxed: '무사태평', Impish: '장난꾸러기', Lax: '촐랑',
  Timid: '겁쟁이', Hasty: '성급', Serious: '성실', Jolly: '명랑', Naive: '천진난만',
  Modest: '조심', Mild: '의젓', Quiet: '냉정', Bashful: '수줍음', Rash: '덜렁',
  Calm: '차분', Gentle: '얌전', Sassy: '건방', Careful: '신중', Quirky: '변덕',
};
export const TYPE_KO: Record<string, string> = {
  Normal: '노말', Fire: '불꽃', Water: '물', Electric: '전기', Grass: '풀', Ice: '얼음',
  Fighting: '격투', Poison: '독', Ground: '땅', Flying: '비행', Psychic: '에스퍼',
  Bug: '벌레', Rock: '바위', Ghost: '고스트', Dragon: '드래곤', Dark: '악',
  Steel: '강철', Fairy: '페어리', Stellar: '스텔라',
};
const FORME_KO: Record<string, string> = {
  'Mega': '메가', 'Mega-X': '메가X', 'Mega-Y': '메가Y', 'Therian': '영물', 'Incarnate': '화신',
  'Origin': '오리진', 'Alola': '알로라', 'Galar': '가라르', 'Hisui': '히스이', 'Paldea': '팔데아',
  'Rapid-Strike': '연격', 'Single-Strike': '일격', 'F': '♀', 'M': '♂', 'Bloodmoon': '붉은달',
  'Wellspring': '우물', 'Hearthflame': '화덕', 'Cornerstone': '주춧돌', 'Four': '넷',
};

export function speciesKo(name: string): string {
  const id = toID(name);
  if (KO.species[id]) return KO.species[id];
  const ov = OVERRIDES[id];
  const sp: any = ov ?? gen.species.get(id as any);
  if (!sp) return name;
  const base: string = sp.baseSpecies ?? name;
  const baseKo = KO.species[toID(base)];
  if (!baseKo) return name;
  const forme = (ov?.forme || name.slice(base.length + 1)) || '';
  if (!forme) return baseKo;
  return `${baseKo}(${FORME_KO[forme] ?? forme})`;
}
export const moveKo = (name: string) => KO.moves[toID(name)] ?? name;
export const itemKo = (id: string) =>
  id === 'nothing'
    ? '도구 없음'
    : KO.items[toID(id)] ?? gen.items.get(id as any)?.name ?? DEXINFO.itemNames[toID(id)] ?? id;
export const abilityKo = (name: string) => KO.abilities[toID(name)] ?? name;

// ---------- 종 정보 ----------
export interface SpeciesInfo {
  name: string;      // Showdown 표기 (예: "Raichu-Mega-Y")
  ko: string;
  baseStats: {hp: number; atk: number; def: number; spa: number; spd: number; spe: number};
  types: string[];
  abilities: string[];
  override?: Override;
}

export function getSpecies(name: string): SpeciesInfo | undefined {
  const id = toID(name);
  const ov = OVERRIDES[id];
  if (ov) {
    const abilities = DEXINFO.abilities[id] ?? ov.abilities;
    return {name: ov.name, ko: speciesKo(ov.name), baseStats: ov.baseStats, types: ov.types, abilities, override: ov};
  }
  const sp = gen.species.get(id as any);
  if (!sp) return undefined;
  const abilities = DEXINFO.abilities[id] ?? (Object.values((sp as any).abilities ?? {}) as string[]);
  return {name: sp.name, ko: speciesKo(sp.name), baseStats: sp.baseStats as any, types: sp.types as any, abilities};
}

// 포켓몬 선택 목록: 챔피언스 로스터에 존재하는 종만 (통계 사용률순 → 가나다)
export function buildSpeciesList(): {name: string; ko: string; usage?: number}[] {
  const usageMap = new Map(STATS.pokemon.map((p) => [toID(p.name), p.usage]));
  const list: {name: string; ko: string; usage?: number}[] = [];
  for (const id of DEXINFO.roster ?? []) {
    if (HIDDEN.has(id) && !usageMap.has(id)) continue;
    const info = getSpecies(id);
    if (!info) continue;
    list.push({name: info.name, ko: info.ko, usage: usageMap.get(id)});
  }
  list.sort((a, b) => (b.usage ?? 0) - (a.usage ?? 0) || a.ko.localeCompare(b.ko, 'ko'));
  return list;
}

// ---------- 챔피언스 SP → 본가 노력치 ----------
// 공식 변환: 첫 SP = 노력치 4, 이후 SP당 8 (개체값 31 기준으로 실능 1:1 일치)
export const spToEv = (sp: number) => (sp <= 0 ? 0 : 8 * sp - 4);
export const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export const STAT_KO: Record<StatKey, string> = {hp: 'HP', atk: '공격', def: '방어', spa: '특공', spd: '특방', spe: '스핏'};

export function spArrayToEvs(sp: number[]) {
  const evs: Record<string, number> = {};
  STAT_KEYS.forEach((k, i) => (evs[k] = spToEv(sp[i] ?? 0)));
  return evs as {hp: number; atk: number; def: number; spa: number; spd: number; spe: number};
}

export interface BuildOptions {
  nature: string;
  sp: number[];             // SP 6개 (0~32)
  ability?: string;
  item?: string;            // Showdown item id 또는 'nothing'
  boosts?: Partial<Record<StatKey, number>>; // 랭크 업/다운 (-6 ~ +6)
}

export function makePokemon(name: string, o: BuildOptions): Pokemon {
  const id = toID(name);
  const ov = OVERRIDES[id];
  const item = !o.item || o.item === 'nothing' ? undefined : gen.items.get(o.item as any)?.name;
  const common = {
    level: 50,
    nature: o.nature as any,
    evs: spArrayToEvs(o.sp),
    ivs: {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31},
    ability: o.ability as any,
    item: item as any,
    boosts: (o.boosts ?? {}) as any,
  };
  if (ov) {
    const baseName = gen.species.get(toID(ov.baseSpecies) as any) ? ov.baseSpecies : 'Mew';
    return new Pokemon(gen, baseName as any, {
      ...common,
      overrides: {baseStats: ov.baseStats as any, types: ov.types as any, weightkg: ov.weightkg},
    });
  }
  return new Pokemon(gen, name as any, common);
}

// ---------- 툴팁 텍스트 ----------
// 성격 효과 (상승/하락 스탯)
const NATURE_EFFECT: Record<string, [string, string] | null> = {
  Adamant: ['atk', 'spa'], Lonely: ['atk', 'def'], Brave: ['atk', 'spe'], Naughty: ['atk', 'spd'],
  Bold: ['def', 'atk'], Impish: ['def', 'spa'], Relaxed: ['def', 'spe'], Lax: ['def', 'spd'],
  Modest: ['spa', 'atk'], Mild: ['spa', 'def'], Quiet: ['spa', 'spe'], Rash: ['spa', 'spd'],
  Calm: ['spd', 'atk'], Gentle: ['spd', 'def'], Sassy: ['spd', 'spe'], Careful: ['spd', 'spa'],
  Timid: ['spe', 'atk'], Hasty: ['spe', 'def'], Jolly: ['spe', 'spa'], Naive: ['spe', 'spd'],
  Hardy: null, Docile: null, Serious: null, Bashful: null, Quirky: null,
};

export function natureTip(name: string): string {
  const e = NATURE_EFFECT[name];
  if (e === undefined) return '';
  if (e === null) return `${NATURE_KO[name] ?? name}: 무보정 성격 (능력치 변화 없음)`;
  const KOS: Record<string, string> = {atk: '공격', def: '방어', spa: '특공', spd: '특방', spe: '스핏'};
  return `${NATURE_KO[name] ?? name}: ${KOS[e[0]]} +10% · ${KOS[e[1]]} -10%`;
}

export function moveTip(name: string): string {
  const move = gen.moves.get(toID(name) as any);
  if (!move) return '';
  const patch = (moveOverridesJson as any)[move.id] as {basePower?: number; type?: string; category?: string} | undefined;
  const type = patch?.type ?? move.type;
  const category = patch?.category ?? move.category;
  const bp = patch?.basePower ?? move.basePower;
  const catKo = category === 'Physical' ? '물리' : category === 'Special' ? '특수' : '변화';
  const head = `${TYPE_KO[type] ?? type} · ${catKo}${bp ? ` · 위력 ${bp}` : ''}${patch ? ' (챔피언스 조정)' : ''}`;
  const fx = KO.moveFx?.[move.id] ?? '';
  const desc = KO.moveDesc?.[move.id] ?? '';
  return [head, fx, desc].filter(Boolean).join('\n');
}

export function abilityTip(name: string): string {
  // 수치 기반 효과 설명 우선, 없으면 도감 설명으로 폴백
  const fx = ABILITY_FX[name];
  if (fx) return `${abilityKo(name)}: ${fx}`;
  const desc = KO.abilityDesc?.[toID(name)] ?? '';
  return desc ? `${abilityKo(name)}: ${desc}` : abilityKo(name);
}

export function itemTip(id: string): string {
  if (!id || id === 'nothing') return '';
  const desc = KO.itemDesc?.[toID(id)] ?? '';
  return desc ? `${itemKo(id)}: ${desc}` : itemKo(id);
}

// ---------- 특수 메커니즘 안내 ----------
const SPECIES_NOTES: Record<string, string> = {
  aegislash: '배틀스위치: 공격 기술을 쓰는 순간 블레이드폼(공격·특공 140)이 되고, 킹실드를 쓰면 실드폼(방어·특방 140)으로 돌아갑니다. 이 계산기는 공격 데미지는 블레이드폼, 받는 데미지는 실드폼 기준입니다.',
  palafin: '마이트체인지: 한 번 교대했다가 다시 나오면 마이티폼(공격 160)이 됩니다. 이 계산기의 공격 데미지는 마이티폼 기준입니다.',
  mimikyu: '탈: 처음 받는 공격 1회는 데미지가 0이 되고 대신 최대 HP의 1/8만 깎입니다. 표시된 판정보다 실전에서는 1타 더 버팁니다.',
};
const ABILITY_NOTES: Record<string, string> = {
  'Protean': '변환자재: 기술을 쓰기 직전 자신이 그 기술의 타입으로 변해 모든 공격이 자속(×1.5)이 됩니다 (계산에 반영됨). 방어 상성은 마지막에 쓴 기술 타입 기준으로 바뀌므로, 위 상성 표시는 원래 타입 기준입니다.',
  'Libero': '리베로: 기술을 쓰기 직전 자신이 그 기술의 타입으로 변해 모든 공격이 자속(×1.5)이 됩니다 (계산에 반영됨). 방어 상성은 마지막에 쓴 기술 타입 기준으로 바뀝니다.',
};

export function specialNotes(name: string, ability?: string): string[] {
  const notes: string[] = [];
  const id = toID(name);
  const ov = OVERRIDES[id];
  const base = toID(ov?.baseSpecies ?? (((gen.species.get(id as any) as any)?.baseSpecies as string) ?? name));
  if (SPECIES_NOTES[base]) notes.push(SPECIES_NOTES[base]);
  if (ability && ABILITY_NOTES[ability]) notes.push(ABILITY_NOTES[ability]);
  return notes;
}

// ---------- 타입 상성 ----------
// 공격 타입 → {방어 타입: 배율} (1은 생략, 6세대 이후 공식 차트)
export const TYPE_CHART: Record<string, Record<string, number>> = {
  Normal: {Rock: 0.5, Ghost: 0, Steel: 0.5},
  Fire: {Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Dragon: 0.5, Steel: 2},
  Water: {Fire: 2, Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2, Dragon: 0.5},
  Electric: {Water: 2, Electric: 0.5, Grass: 0.5, Ground: 0, Flying: 2, Dragon: 0.5},
  Grass: {Fire: 0.5, Water: 2, Grass: 0.5, Poison: 0.5, Ground: 2, Flying: 0.5, Bug: 0.5, Rock: 2, Dragon: 0.5, Steel: 0.5},
  Ice: {Fire: 0.5, Water: 0.5, Grass: 2, Ice: 0.5, Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5},
  Fighting: {Normal: 2, Ice: 2, Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Rock: 2, Ghost: 0, Dark: 2, Steel: 2, Fairy: 0.5},
  Poison: {Grass: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0, Fairy: 2},
  Ground: {Fire: 2, Electric: 2, Grass: 0.5, Poison: 2, Flying: 0, Bug: 0.5, Rock: 2, Steel: 2},
  Flying: {Electric: 0.5, Grass: 2, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5},
  Psychic: {Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0, Steel: 0.5},
  Bug: {Fire: 0.5, Grass: 2, Fighting: 0.5, Poison: 0.5, Flying: 0.5, Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5, Fairy: 0.5},
  Rock: {Fire: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5},
  Ghost: {Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5},
  Dragon: {Dragon: 2, Steel: 0.5, Fairy: 0},
  Dark: {Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5},
  Steel: {Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2},
  Fairy: {Fire: 0.5, Fighting: 2, Poison: 0.5, Dragon: 2, Dark: 2, Steel: 0.5},
};
export const ALL_TYPES = Object.keys(TYPE_CHART);

// 특성으로 무효가 되는 공격 타입
const ABILITY_IMMUNE: Record<string, string> = {
  'Levitate': 'Ground', 'Earth Eater': 'Ground', 'Eelevate': 'Ground',
  'Water Absorb': 'Water', 'Storm Drain': 'Water', 'Dry Skin': 'Water',
  'Volt Absorb': 'Electric', 'Lightning Rod': 'Electric', 'Motor Drive': 'Electric',
  'Flash Fire': 'Fire', 'Well-Baked Body': 'Fire',
  'Sap Sipper': 'Grass',
};

// 방어 상성 프로필: 공격 타입별 배율을 묶어서 반환
export function defensiveProfile(defTypes: string[], ability?: string) {
  const groups: Record<'x4' | 'x2' | 'x05' | 'x025' | 'x0', string[]> = {x4: [], x2: [], x05: [], x025: [], x0: []};
  for (const atk of ALL_TYPES) {
    let mult = 1;
    for (const def of defTypes) mult *= TYPE_CHART[atk]?.[def] ?? 1;
    if (ability && ABILITY_IMMUNE[ability] === atk) mult = 0;
    if (mult >= 4) groups.x4.push(atk);
    else if (mult >= 2) groups.x2.push(atk);
    else if (mult === 0) groups.x0.push(atk);
    else if (mult <= 0.26) groups.x025.push(atk);
    else if (mult <= 0.5) groups.x05.push(atk);
  }
  return groups;
}

// 배울 수 있는 공격기 (메가 등 폼체인지는 원종 학습셋으로 폴백)
export function learnsetDamagingMoves(name: string): string[] {
  const id = toID(name);
  if (LEARNSETS[id]) return LEARNSETS[id];
  const ov = OVERRIDES[id];
  const base = ov?.baseSpecies ?? ((gen.species.get(id as any) as any)?.baseSpecies as string | undefined);
  return base ? LEARNSETS[toID(base)] ?? [] : [];
}

// 스핏 실능 (스카프는 ×1.5)
export function speedStat(name: string, nature: string, spSpe: number, scarf = false): number {
  const sp = [0, 0, 0, 0, 0, spSpe];
  const p = makePokemon(name, {nature, sp});
  const s = p.stats.spe;
  return scarf ? Math.floor(s * 1.5) : s;
}

export function speedFromSpread(name: string, nature: string, sp: number[], scarf = false): number {
  const p = makePokemon(name, {nature, sp});
  const s = p.stats.spe;
  return scarf ? Math.floor(s * 1.5) : s;
}

// ---------- 위협 분석 ----------
export interface ThreatRow {
  moveName: string;
  moveKo: string;
  type: string;
  category: 'Physical' | 'Special';
  usagePct: number;
  minPct: number;
  maxPct: number;
  koLabel: string;
  koTone: 'ohko' | 'roll1' | 'twohko' | 'roll2' | 'safe' | 'immune';
  desc: string;
}
export interface StatusRow { moveName: string; moveKo: string; usagePct: number }

export interface ThreatOptions {
  spread: {nature: string; sp: number[]};
  item: string;
  ability: string;
  maxInvest: boolean;   // 공격/특공 32 + 보정 성격 가정
  attackerBoosts?: {atk?: number; spa?: number}; // 공격측 랭크
}

function koInfo(result: Result, maxPct: number): {label: string; tone: ThreatRow['koTone']} {
  if (maxPct <= 0) return {label: '무효', tone: 'immune'};
  let n = 0;
  let chance: number | undefined;
  try {
    const ko = result.kochance();
    n = ko.n;
    chance = ko.chance;
  } catch {
    return {label: '-', tone: 'safe'};
  }
  if (n <= 0) return {label: `${Math.max(2, Math.ceil(100 / maxPct))}타권`, tone: 'safe'};
  const guaranteed = chance === 1;
  const label = guaranteed
    ? `확정 ${n}타`
    : chance !== undefined && chance > 0
      ? `난수 ${n}타 (${(chance * 100).toFixed(1)}%)`
      : `${n}타권`;
  const tone: ThreatRow['koTone'] =
    n === 1 ? (guaranteed ? 'ohko' : 'roll1')
    : n === 2 ? (guaranteed ? 'twohko' : 'roll2')
    : 'safe';
  return {label, tone};
}

// 공격 시 자동 폼체인지: 방어 폼 종족값 대신 공격 폼으로 계산
const ATTACK_FORME: Record<string, string> = {
  aegislash: 'Aegislash-Blade',
  palafin: 'Palafin-Hero',
};

export function analyzeThreats(
  defender: Pokemon,
  attackerName: string,
  moves: [string, number][],
  o: ThreatOptions,
): {rows: ThreatRow[]; status: StatusRow[]} {
  const atkForme = ATTACK_FORME[toID(attackerName)];
  if (atkForme && getSpecies(atkForme)) attackerName = atkForme;
  const rows: ThreatRow[] = [];
  const status: StatusRow[] = [];
  for (const [mid, usagePct] of moves) {
    if (!mid || mid === 'nothing') continue;
    const move = gen.moves.get(mid as any);
    if (!move) continue;
    const patch = MOVE_OVERRIDES[move.id]; // 챔피언스 밸런스 패치 반영
    const category = (patch?.category ?? move.category) as typeof move.category;
    const type = patch?.type ?? move.type;
    if (category === 'Status' || !category) {
      status.push({moveName: move.name, moveKo: moveKo(move.name), usagePct});
      continue;
    }
    // 풀보정 가정 시 기술 분류에 맞는 성격/SP로 재구성
    let nature = o.spread.nature;
    let sp = o.spread.sp.slice();
    if (o.maxInvest) {
      nature = category === 'Physical' ? 'Adamant' : 'Modest';
      sp = sp.slice();
      sp[1] = category === 'Physical' ? 32 : sp[1];
      sp[3] = category === 'Special' ? 32 : sp[3];
    }
    const attacker = makePokemon(attackerName, {
      nature, sp, ability: o.ability, item: o.item, boosts: o.attackerBoosts,
    });
    let result: Result;
    try {
      result = calculate(
        gen, attacker, defender.clone(),
        new Move(gen, move.name, patch ? {overrides: patch as any} : undefined),
      );
    } catch {
      continue;
    }
    const maxHP = defender.maxHP();
    const [lo, hi] = result.range();
    const minPct = Math.floor((lo / maxHP) * 1000) / 10;
    const maxPct = Math.floor((hi / maxHP) * 1000) / 10;
    const ko = koInfo(result, maxPct);
    let desc = '';
    try { desc = result.desc(); } catch { /* 무효 등 */ }
    rows.push({
      moveName: move.name,
      moveKo: moveKo(move.name),
      type,
      category: category as 'Physical' | 'Special',
      usagePct,
      minPct,
      maxPct,
      koLabel: ko.label,
      koTone: ko.tone,
      desc,
    });
  }
  rows.sort((a, b) => b.maxPct - a.maxPct || b.usagePct - a.usagePct);
  status.sort((a, b) => b.usagePct - a.usagePct);
  return {rows, status};
}
