// PokeAPI GraphQL 한국어 데이터 공용 모듈 (fetch-data.mjs / 단독 재생성 스크립트에서 사용)

export const toID = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export const KO_QUERY = `query {
  species: pokemon_v2_pokemonspeciesname(where: {language_id: {_eq: 3}}) { ko: name en: pokemon_v2_pokemonspecy { name } }
  moves: pokemon_v2_movename(where: {language_id: {_eq: 3}}) { ko: name en: pokemon_v2_move { name } }
  items: pokemon_v2_itemname(where: {language_id: {_eq: 3}}) { ko: name en: pokemon_v2_item { name } }
  abilities: pokemon_v2_abilityname(where: {language_id: {_eq: 3}}) { ko: name en: pokemon_v2_ability { name } }
  moveDesc: pokemon_v2_moveflavortext(where: {language_id: {_eq: 3}}) { ko: flavor_text v: version_group_id en: pokemon_v2_move { name } }
  abilityDesc: pokemon_v2_abilityflavortext(where: {language_id: {_eq: 3}}) { ko: flavor_text v: version_group_id en: pokemon_v2_ability { name } }
  itemDesc: pokemon_v2_itemflavortext(where: {language_id: {_eq: 3}}) { ko: flavor_text v: version_group_id en: pokemon_v2_item { name } }
  moveMeta: pokemon_v2_move {
    name accuracy priority
    pokemon_v2_movemeta {
      ailment_chance flinch_chance stat_chance drain healing crit_rate min_hits max_hits
      pokemon_v2_movemetaailment { name }
      pokemon_v2_movemetacategory { name }
    }
    pokemon_v2_movemetastatchanges { change pokemon_v2_stat { name } }
    pokemon_v2_movetarget { name }
  }
}`;

const AILMENT_KO = {
  paralysis: '마비', sleep: '잠듦', freeze: '얼음', burn: '화상', poison: '독',
  confusion: '혼란', infatuation: '헤롱헤롱', trap: '구속(연속 데미지)', nightmare: '악몽',
  torment: '트집', disable: '사슬묶기', yawn: '하품(다음 턴 잠듦)', 'heal-block': '회복봉인',
  'leech-seed': '씨뿌리기', embargo: '금제', 'perish-song': '멸망의노래', ingrain: '뿌리박기',
  'tar-shot': '타르샷', 'no-type-immunity': '타입 무효 해제',
};
const STAT_FX_KO = {
  attack: '공격', defense: '방어', 'special-attack': '특공', 'special-defense': '특방',
  speed: '스핏', accuracy: '명중률', evasion: '회피율',
};

// 기술의 기계적 효과를 한국어 한 줄로 생성 ("명중 95 · 상대의 스핏 1랭크 하락" 등)
function buildFx(row) {
  const meta = row.pokemon_v2_movemeta?.[0];
  const target = row.pokemon_v2_movetarget?.name;
  const cat = meta?.pokemon_v2_movemetacategory?.name ?? '';
  const selfSubject = cat.includes('raise') || cat === 'net-good-stats' || target === 'user';
  const parts = [];
  if (row.accuracy == null) {
    if (!selfSubject) parts.push('필중');
  } else if (row.accuracy !== 100) {
    parts.push(`명중 ${row.accuracy}`);
  }
  if (row.priority) parts.push(`우선도 ${row.priority > 0 ? '+' : ''}${row.priority}`);
  if (meta) {
    const ail = meta.pokemon_v2_movemetaailment?.name;
    if (ail && ail !== 'none') {
      const label = AILMENT_KO[ail] ?? ail;
      parts.push(
        meta.ailment_chance > 0
          ? `${meta.ailment_chance}% 확률로 상대를 ${label} 상태로 만든다`
          : `상대를 ${label} 상태로 만든다`,
      );
    }
    if (meta.flinch_chance > 0) parts.push(`${meta.flinch_chance}% 확률로 상대를 풀죽게 한다`);
    const scs = row.pokemon_v2_movemetastatchanges ?? [];
    if (scs.length) {
      const txt = scs
        .map((sc) => `${STAT_FX_KO[sc.pokemon_v2_stat.name] ?? sc.pokemon_v2_stat.name} ${Math.abs(sc.change)}랭크 ${sc.change > 0 ? '상승' : '하락'}`)
        .join(', ');
      const subj = selfSubject ? '자신의' : '상대의';
      const chance = meta.stat_chance;
      parts.push(chance > 0 && chance < 100 ? `${chance}% 확률로 ${subj} ${txt}` : `${subj} ${txt}`);
    }
    if (meta.drain > 0) parts.push(`준 데미지의 ${meta.drain}%만큼 HP 회복`);
    if (meta.drain < 0) parts.push(`반동: 준 데미지의 ${-meta.drain}%`);
    if (meta.healing > 0) parts.push(`최대 HP의 ${meta.healing}% 회복`);
    if (meta.crit_rate > 0) parts.push('급소에 맞기 쉬움');
    if (meta.min_hits != null) {
      parts.push(meta.min_hits === meta.max_hits ? `${meta.min_hits}회 연속 공격` : `${meta.min_hits}~${meta.max_hits}회 연속 공격`);
    }
  }
  return parts.join(' · ');
}

// GraphQL 응답 → ko.json 데이터
export function buildKoData(data) {
  const ko = {};
  for (const key of ['species', 'moves', 'items', 'abilities']) {
    ko[key] = {};
    for (const row of data[key]) {
      if (row.en?.name) ko[key][toID(row.en.name)] = row.ko;
    }
  }
  // 설명 텍스트: 최신 버전 우선, "사용할 수 없는 기술" 더미는 이전 버전으로 폴백
  const clean = (s) => s.replace(/[\n\f\r]+/g, ' ').trim();
  for (const key of ['moveDesc', 'abilityDesc', 'itemDesc']) {
    const best = {};
    for (const row of data[key]) {
      if (!row.en?.name || !row.ko) continue;
      const id = toID(row.en.name);
      const dummy = row.ko.startsWith('사용할 수 없는');
      const cur = best[id];
      if (!cur || (cur.dummy && !dummy) || (cur.dummy === dummy && row.v > cur.v)) {
        best[id] = {v: row.v, ko: clean(row.ko), dummy};
      }
    }
    ko[key] = {};
    for (const [id, e] of Object.entries(best)) ko[key][id] = e.ko;
  }
  // 기계적 효과 텍스트
  ko.moveFx = {};
  for (const row of data.moveMeta) {
    const fx = buildFx(row);
    if (fx) ko.moveFx[toID(row.name)] = fx;
  }
  return ko;
}
