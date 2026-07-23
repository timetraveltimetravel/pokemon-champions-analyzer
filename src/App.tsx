import {useEffect, useMemo, useRef, useState} from 'react';
import {
  STATS, StatsMon, CutKey, ThreatRow, analyzeThreats, buildSpeciesList, gen, getSpecies,
  itemKo, abilityKo, makePokemon, speciesKo, toID, learnsetDamagingMoves, LEGAL_ITEMS,
  speedStat, speedFromSpread, itemSpeedMult, defensiveProfile, TYPE_CHART, ALL_TYPES,
  moveTip, abilityTip, itemTip, natureTip, specialNotes,
  Weather, Terrain, FieldState, WEATHER_KO, TERRAIN_KO, AUTO_WEATHER, AUTO_TERRAIN,
  Status, STATUS_KO, STATUS_EFFECT,
  NATURE_KO, TYPE_KO, STAT_KEYS, STAT_KO,
} from './engine';

// 호버(또는 탭)하면 설명이 뜨는 툴팁
function Tip({tip, children}: {tip?: string; children: React.ReactNode}) {
  if (!tip) return <>{children}</>;
  return (
    <span className="tt" tabIndex={0}>
      {children}
      <span className="tip">{tip}</span>
    </span>
  );
}

// ---------- 공용: 검색 셀렉트 ----------
// 한글/영문/숫자만 남기는 검색 정규화 ("킬가르도." → "킬가르도", "메가 우츠보트" → "메가우츠보트")
const norm = (s: string) => s.toLowerCase().replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-z0-9]/g, '');
const FORM_PREFIX = /^(메가|알로라|가라르|히스이|팔데아|원시)(.+)$/;

interface Option { value: string; label: string; sub?: string }
function SearchSelect({options, placeholder, onSelect, selectedLabel, big}: {
  options: Option[];
  placeholder: string;
  onSelect: (v: string) => void;
  selectedLabel?: string;
  big?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // 한글 IME 조합이 끊기지 않도록 입력창은 비제어(uncontrolled)로 두고 값만 읽는다
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => {
    if (!open && inputRef.current) inputRef.current.value = selectedLabel ?? '';
  }, [selectedLabel, open]);
  // 공백 기준 토큰이 모두 포함되면 매칭 → "메가 우츠보트"로도 "우츠보트(메가)" 검색 가능
  // "메가라이츄"처럼 붙여 쓴 폼 접두어는 분리해서 토큰화
  const tokens = useMemo(() => {
    const out: string[] = [];
    for (const raw of q.split(/\s+/)) {
      const t = norm(raw);
      if (!t) continue;
      const m = t.match(FORM_PREFIX);
      if (m) { out.push(m[1], m[2]); } else { out.push(t); }
    }
    return out;
  }, [q]);
  const filtered = useMemo(() => {
    if (!tokens.length) return options.slice(0, 15);
    return options.filter((o) => {
      const hay = `${norm(o.label)}|${toID(o.value)}|${o.sub ? norm(o.sub) : ''}`;
      return tokens.every((t) => hay.includes(t));
    }).slice(0, 15);
  }, [tokens, options]);
  const pick = (v: string) => {
    onSelect(v);
    setOpen(false);
    inputRef.current?.blur();
  };
  return (
    <div className={`ss ${big ? 'big' : ''}`} ref={ref}>
      <input
        ref={inputRef}
        defaultValue={selectedLabel ?? ''}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQ('');
          if (inputRef.current) inputRef.current.value = '';
        }}
        onInput={(e) => setQ(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && filtered[0]) pick(filtered[0].value);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && filtered.length > 0 && (
        <ul>
          {filtered.map((o) => (
            <li key={o.value} onMouseDown={() => pick(o.value)}>
              <span>{o.label}</span>
              {o.sub && <em>{o.sub}</em>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TypeBadge({t, sm}: {t: string; sm?: boolean}) {
  return <span className={`type t-${t.toLowerCase()}${sm ? ' sm' : ''}`}>{TYPE_KO[t] ?? t}</span>;
}

// 방어 상성 (약점/반감/무효)
function Matchups({types, ability}: {types: string[]; ability?: string}) {
  const p = useMemo(() => defensiveProfile(types, ability), [types, ability]);
  const row = (label: string, cls: string, items: [string, string][]) =>
    items.length > 0 && (
      <div className="mu-row">
        <span className={`mu-label ${cls}`}>{label}</span>
        <span className="mu-types">
          {items.map(([t, tag]) => (
            <span key={t + tag} className="mu-item">
              <TypeBadge t={t} sm />{tag && <em>{tag}</em>}
            </span>
          ))}
        </span>
      </div>
    );
  return (
    <div className="matchups">
      {row('약점', 'weak', [...p.x4.map((t): [string, string] => [t, '×4']), ...p.x2.map((t): [string, string] => [t, ''])])}
      {row('반감', 'resist', [...p.x05.map((t): [string, string] => [t, '']), ...p.x025.map((t): [string, string] => [t, '×¼'])])}
      {row('무효', 'immune', p.x0.map((t): [string, string] => [t, '']))}
    </div>
  );
}

// 랭크 -6 ~ +6 셀렉터
function RankSelect({label, value, onChange}: {label: string; value: number; onChange: (v: number) => void}) {
  return (
    <label className="rank">
      {label}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={value > 0 ? 'up' : value < 0 ? 'down' : ''}>
        {Array.from({length: 13}, (_, i) => 6 - i).map((v) => (
          <option key={v} value={v}>{v > 0 ? `+${v}` : v}</option>
        ))}
      </select>
    </label>
  );
}

// 상태이상 셀렉터
function StatusSelect({label, value, onChange}: {label: string; value: Status; onChange: (v: Status) => void}) {
  return (
    <label className="rank status-sel">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as Status)}
        className={value ? 'on' : ''} title={STATUS_EFFECT[value]}>
        {(Object.keys(STATUS_KO) as Status[]).map((s) => (
          <option key={s} value={s}>{STATUS_KO[s]}{STATUS_EFFECT[s] ? ` (${STATUS_EFFECT[s]})` : ''}</option>
        ))}
      </select>
    </label>
  );
}

// 정렬 토글
function SortToggle({sortBy, setSortBy}: {sortBy: 'usage' | 'damage'; setSortBy: (s: 'usage' | 'damage') => void}) {
  return (
    <div className="ctrl-group sort-group">
      <span className="ctrl-label">정렬</span>
      <span className="cut-toggle">
        <button className={sortBy === 'usage' ? 'on' : ''} onClick={() => setSortBy('usage')}>채용률순</button>
        <button className={sortBy === 'damage' ? 'on' : ''} onClick={() => setSortBy('damage')}>데미지순</button>
      </span>
    </div>
  );
}

// SP 6개 입력 그리드
function SpGrid({sp, onChange}: {sp: number[]; onChange: (sp: number[]) => void}) {
  const total = sp.reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="sp-grid">
        {STAT_KEYS.map((k, i) => (
          <label key={k}>{STAT_KO[k]}
            <input type="number" min={0} max={32} value={sp[i]}
              onChange={(e) => {
                const next = sp.slice();
                next[i] = Math.max(0, Math.min(32, Number(e.target.value)));
                onChange(next);
              }} />
          </label>
        ))}
      </div>
      <div className={`sp-total ${total > 66 ? 'over' : ''}`}>SP 합계 {total} / 66</div>
    </>
  );
}

// 위협 테이블 (양방향 공용) — 공격기·변화기를 한 표에 채용률/데미지 순으로 표시
function ThreatTable({rows}: {rows: ThreatRow[]}) {
  if (rows.length === 0) return <p className="empty-mini">표시할 기술이 없습니다.</p>;
  return (
    <table className="threat">
      <thead>
        <tr><th>기술</th><th>타입</th><th className="col-cat">분류</th><th className="col-use">채용</th><th>데미지</th><th>판정</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const isStatus = r.category === 'Status';
          return (
            <tr key={r.moveName} className={r.koTone}>
              <td><Tip tip={moveTip(r.moveName)}><b>{r.moveKo}</b></Tip><small>{r.moveName}</small></td>
              <td><TypeBadge t={r.type} /></td>
              <td className="col-cat">{isStatus ? '변화' : r.category === 'Physical' ? '물리' : '특수'}</td>
              <td className="col-use">{r.usagePct > 0 ? `${r.usagePct.toFixed(1)}%` : '—'}</td>
              <td className="dmg">
                {isStatus ? <span className="dash">—</span> : <>
                  <div className="bar"><i style={{width: `${Math.min(100, r.maxPct)}%`}} /></div>
                  <span>{r.minPct.toFixed(1)}% ~ {r.maxPct.toFixed(1)}%</span>
                </>}
              </td>
              <td><span className={`ko ${r.koTone}`}>{r.koLabel}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// 가이드 모달
function Guide({onClose}: {onClose: () => void}) {
  const cell = (atk: string, def: string) => {
    const m = TYPE_CHART[atk]?.[def] ?? 1;
    if (m === 2) return <td key={def} className="tc-2">2</td>;
    if (m === 0.5) return <td key={def} className="tc-05">½</td>;
    if (m === 0) return <td key={def} className="tc-0">0</td>;
    return <td key={def} className="tc-1" />;
  };
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <h2>📖 가이드</h2>
          <button onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="modal-body">
          <h3>챔피언스 육성 시스템 (SP)</h3>
          <ul>
            <li>능력치마다 <b>SP 0~32</b>를 투자할 수 있고, 총합은 <b>66</b>까지입니다.</li>
            <li>SP 1당 그 능력치의 실능이 <b>+1</b> 됩니다 (레벨 50 기준).</li>
            <li>성격은 한 능력치를 <b>×1.1</b>, 다른 하나를 <b>×0.9</b> 합니다 (무보정 성격도 있음).</li>
            <li>본가와의 관계: SP 1 = 노력치 4, 이후 SP 1당 노력치 8 (개체값 31 기준으로 실능이 정확히 일치). 이 앱은 이 변환으로 본가 공식 계산기를 그대로 사용합니다.</li>
          </ul>

          <h3>데미지(결정력) 계산식</h3>
          <p className="formula">
            기본 데미지 = ⌊⌊⌊(레벨×2/5+2) × 위력 × 공격실능 / 방어실능⌋ / 50⌋ + 2⌋
          </p>
          <ul>
            <li>레벨 50 기준 (레벨×2/5+2) = 22. 물리 기술은 공격/방어, 특수 기술은 특공/특방을 사용합니다.</li>
            <li>이후 배율이 차례로 곱해집니다: <b>자속(STAB) ×1.5</b> → <b>타입 상성</b> (아래 표) → <b>도구/특성 배율</b> (구애 ×1.5, 생명의구슬 ×1.3 등) → <b>난수 ×0.85~1.00</b> (16단계).</li>
            <li>급소는 ×1.5이며 방어 랭크 상승을 무시합니다 (이 앱은 급소 미적용 기준).</li>
            <li><b>랭크 배수</b>: +1 ×1.5, +2 ×2, +3 ×2.5 … +6 ×4 / -1 ×2/3, -2 ×1/2 … -6 ×1/4</li>
          </ul>
          <h3>판정 용어</h3>
          <ul>
            <li><b>확정 n타</b>: 최소 난수로 맞아도 n번이면 반드시 쓰러짐</li>
            <li><b>난수 n타 (p%)</b>: n번 만에 쓰러질 확률이 p%</li>
            <li><b>무효</b>: 타입 상성이나 특성으로 데미지 0</li>
          </ul>

          <h3>타입 상성표 (세로: 공격 타입 → 가로: 방어 타입)</h3>
          <p className="dim-note">빈 칸 = ×1 · <span className="tc-2 lg">2</span> = 효과 굉장 · <span className="tc-05 lg">½</span> = 반감 · <span className="tc-0 lg">0</span> = 무효</p>
          <div className="type-chart-wrap">
            <table className="type-chart">
              <thead>
                <tr>
                  <th>공\방</th>
                  {ALL_TYPES.map((t) => <th key={t}><TypeBadge t={t} sm /></th>)}
                </tr>
              </thead>
              <tbody>
                {ALL_TYPES.map((atk) => (
                  <tr key={atk}>
                    <th><TypeBadge t={atk} sm /></th>
                    {ALL_TYPES.map((def) => cell(atk, def))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="dim-note">복합 타입은 두 타입의 배율을 곱합니다 (예: 물+땅에게 풀 = 2×2 = ×4). 특성(부유, 저수 등)으로 무효가 되는 경우는 각 포켓몬의 상성 표시에 반영되어 있습니다.</p>
        </div>
      </div>
    </div>
  );
}

// ---------- 상태 ----------
interface SideConfig { nature: string; sp: number[]; ability: string; item: string }
const DEFAULT_MY: SideConfig = {nature: 'Serious', sp: [32, 0, 0, 0, 0, 0], ability: '', item: 'nothing'};
const ZERO_RANKS = {myAtk: 0, mySpa: 0, myDef: 0, mySpd: 0, oppAtk: 0, oppSpa: 0, oppDef: 0, oppSpd: 0};
const ZERO_SP = [0, 0, 0, 0, 0, 0];

function topSpreadConfig(mon: StatsMon, fallbackAbility: string): SideConfig {
  const [nature, sp] = mon.spreads[0] ?? ['Serious', ZERO_SP];
  const abilId = mon.abilities[0]?.[0];
  return {
    nature,
    sp: sp.slice(),
    ability: abilId && abilId !== 'noability' ? gen.abilities.get(abilId as any)?.name ?? fallbackAbility : fallbackAbility,
    item: mon.items[0]?.[0] ?? 'nothing',
  };
}

// 채용 기술 + (옵션) 학습셋 전체 병합
function movePool(name: string, mon: StatsMon | undefined, includeAll: boolean): [string, number][] {
  const statMoves = mon?.moves ?? [];
  const moves: [string, number][] = statMoves.slice();
  if (!mon || includeAll) {
    const have = new Set(statMoves.map(([m]) => toID(m)));
    for (const mid of learnsetDamagingMoves(name)) {
      if (!have.has(mid)) moves.push([mid, 0]);
    }
  }
  return moves;
}

const ALL_ITEMS: Option[] = (() => {
  const list: Option[] = [{value: 'nothing', label: '도구 없음'}];
  for (const it of gen.items) {
    if (LEGAL_ITEMS.size && !LEGAL_ITEMS.has(it.id)) continue; // 챔피언스에 없는 도구 제외
    list.push({value: it.id, label: itemKo(it.id), sub: it.name});
  }
  list.sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  return list;
})();

const WEATHER_ICON: Record<Weather, string> = {'': '', Sun: '☀️', Rain: '🌧️', Sand: '🌪️', Snow: '❄️'};
const TERRAIN_ICON: Record<Terrain, string> = {'': '', Electric: '⚡', Grassy: '🌿', Psychic: '🔮', Misty: '🧚'};

// 소지품 스핏 배율 표시 접미어
const speedItemSuffix = (item: string) =>
  item === 'choicescarf' ? ' (스카프)' : item === 'ironball' ? ' (아이언볼)' : '';

export default function App() {
  // 통계 기준: 상위권(1760+) / 전체 래더
  const [cut, setCut] = useState<CutKey>('top');
  const cutPokemon = STATS.cuts[cut].pokemon;
  const statsByName = useMemo(() => new Map(cutPokemon.map((p) => [toID(p.name), p])), [cutPokemon]);

  const speciesList = useMemo(() => buildSpeciesList(cutPokemon), [cutPokemon]);
  const allOptions: Option[] = useMemo(
    () => speciesList.map((s) => ({
      value: s.name,
      label: s.ko,
      sub: s.usage ? `${s.name} · ${s.usage.toFixed(1)}%` : s.name,
    })),
    [speciesList],
  );

  const [myName, setMyName] = useState('');
  const [my, setMy] = useState<SideConfig>(DEFAULT_MY);
  const [oppName, setOppName] = useState('');
  const [spreadIdx, setSpreadIdx] = useState(0);       // -1 = 직접 입력
  const [oppNature, setOppNature] = useState('Serious');
  const [oppSp, setOppSp] = useState<number[]>(ZERO_SP.slice());
  const [oppItem, setOppItem] = useState('nothing');
  const [oppAbility, setOppAbility] = useState('');
  const [maxInvest, setMaxInvest] = useState(false);
  const [showAllMoves, setShowAllMoves] = useState(false);
  const [myShowAllMoves, setMyShowAllMoves] = useState(false);
  const [ranks, setRanks] = useState({...ZERO_RANKS});
  const [field, setField] = useState<FieldState>({weather: '', terrain: ''});
  const [fieldManual, setFieldManual] = useState(false); // 사용자가 직접 만지면 자동 적용 중단
  const [myStatus, setMyStatus] = useState<Status>('');
  const [oppStatus, setOppStatus] = useState<Status>('');
  const [sortBy, setSortBy] = useState<'usage' | 'damage'>('usage');
  const [guideOpen, setGuideOpen] = useState(false);
  const setRank = (k: keyof typeof ZERO_RANKS) => (v: number) => setRanks((r) => ({...r, [k]: v}));

  const mySpecies = myName ? getSpecies(myName) : undefined;
  const oppSpecies = oppName ? getSpecies(oppName) : undefined;
  const oppStats = oppName ? statsByName.get(toID(oppName)) : undefined;
  const myStats = myName ? statsByName.get(toID(myName)) : undefined;

  const pickMy = (name: string, map = statsByName) => {
    setMyName(name);
    const sp = getSpecies(name);
    const stat = map.get(toID(name));
    const ability = sp?.abilities[0] ?? '';
    setMy(stat ? topSpreadConfig(stat, ability) : {...DEFAULT_MY, sp: DEFAULT_MY.sp.slice(), ability});
    setMyShowAllMoves(false);
    setRanks({...ZERO_RANKS});
    setMyStatus('');
    setFieldManual(false); // 새 포켓몬이면 자동 날씨 다시 판정
  };
  const pickOpp = (name: string, map = statsByName) => {
    setOppName(name);
    const stat = map.get(toID(name));
    const top = stat?.spreads[0];
    setSpreadIdx(stat ? 0 : -1);
    setOppNature(top?.[0] ?? 'Serious');
    setOppSp(top?.[1]?.slice() ?? ZERO_SP.slice());
    setShowAllMoves(false);
    setMaxInvest(!stat); // 통계 없으면 풀보정 가정
    setOppItem(stat?.items[0]?.[0] ?? 'nothing');
    const abilId = stat?.abilities[0]?.[0];
    setOppAbility(
      abilId && abilId !== 'noability'
        ? gen.abilities.get(abilId as any)?.name ?? ''
        : getSpecies(name)?.abilities[0] ?? '',
    );
    setRanks({...ZERO_RANKS});
    setOppStatus('');
    setFieldManual(false); // 새 포켓몬이면 자동 날씨 다시 판정
  };

  // 상대 가정 스프레드 (통계 선택 또는 직접 입력)
  // 통계 컷 전환 시 현재 선택된 포켓몬의 가정을 새 컷 기준으로 갱신
  const switchCut = (c: CutKey) => {
    if (c === cut) return;
    setCut(c);
    const map = new Map(STATS.cuts[c].pokemon.map((p) => [toID(p.name), p]));
    if (myName) pickMy(myName, map);
    if (oppName) pickOpp(oppName, map);
  };

  const oppSpread: [string, number[]] = useMemo(() => {
    if (spreadIdx >= 0 && oppStats?.spreads[spreadIdx]) {
      const [n, s] = oppStats.spreads[spreadIdx];
      return [n, s];
    }
    return [oppNature, oppSp];
  }, [spreadIdx, oppStats, oppNature, oppSp]);

  // 스프레드 선택을 직접 입력으로 전환할 때 현재 값으로 초기화
  const switchSpread = (idx: number) => {
    if (idx === -1 && spreadIdx >= 0 && oppStats?.spreads[spreadIdx]) {
      const [n, s] = oppStats.spreads[spreadIdx];
      setOppNature(n);
      setOppSp(s.slice());
    }
    setSpreadIdx(idx);
  };

  // 등장 특성으로 자동으로 깔리는 날씨/필드 감지 (내 쪽 우선, 없으면 상대 쪽)
  // deps는 반드시 원시값만 — 객체를 넣으면 매 렌더 새 참조가 되어 무한 갱신됨
  const autoField = useMemo(() => {
    const sides: {ability: string; who: string}[] = [];
    if (my.ability && myName) sides.push({ability: my.ability, who: getSpecies(myName)?.ko ?? myName});
    if (oppAbility && oppName) sides.push({ability: oppAbility, who: getSpecies(oppName)?.ko ?? oppName});
    let weather: {v: Weather; ability: string; who: string} | undefined;
    let terrain: {v: Terrain; ability: string; who: string} | undefined;
    for (const s of sides) {
      if (!weather && AUTO_WEATHER[s.ability]) weather = {v: AUTO_WEATHER[s.ability], ...s};
      if (!terrain && AUTO_TERRAIN[s.ability]) terrain = {v: AUTO_TERRAIN[s.ability], ...s};
    }
    return {weather, terrain};
  }, [my.ability, myName, oppAbility, oppName]);

  // 사용자가 직접 만지기 전까지는 자동 감지 결과를 반영 (deps도 원시값으로 고정)
  const autoWeather = autoField.weather?.v ?? '';
  const autoTerrain = autoField.terrain?.v ?? '';
  useEffect(() => {
    if (fieldManual) return;
    setField({weather: autoWeather, terrain: autoTerrain});
  }, [autoWeather, autoTerrain, fieldManual]);

  const setFieldByUser = (f: FieldState) => { setFieldManual(true); setField(f); };

  // 방어측 포켓몬 (받는 데미지용: 내 랭크 방어/특방 반영)
  const defender = useMemo(() => {
    if (!mySpecies) return undefined;
    try {
      return makePokemon(mySpecies.name, {
        nature: my.nature, sp: my.sp, ability: my.ability || undefined, item: my.item,
        boosts: {def: ranks.myDef, spd: ranks.mySpd}, status: myStatus,
      });
    } catch { return undefined; }
  }, [mySpecies, my, ranks.myDef, ranks.mySpd, myStatus]);

  // 상대를 방어측으로 (주는 데미지용: 상대 가정 스프레드 + 상대 랭크)
  const oppDefender = useMemo(() => {
    if (!oppSpecies) return undefined;
    try {
      return makePokemon(oppSpecies.name, {
        nature: oppSpread[0], sp: oppSpread[1], ability: oppAbility || undefined, item: oppItem,
        boosts: {def: ranks.oppDef, spd: ranks.oppSpd}, status: oppStatus,
      });
    } catch { return undefined; }
  }, [oppSpecies, oppSpread, oppAbility, oppItem, ranks.oppDef, ranks.oppSpd, oppStatus]);

  // 받는 데미지: 상대 → 나
  const incoming = useMemo(() => {
    if (!defender || !oppSpecies) return undefined;
    try {
      return analyzeThreats(defender, oppSpecies.name, movePool(oppSpecies.name, oppStats, showAllMoves), {
        spread: {nature: oppSpread[0], sp: oppSpread[1]},
        item: oppItem,
        ability: oppAbility,
        maxInvest,
        attackerBoosts: {atk: ranks.oppAtk, spa: ranks.oppSpa},
        attackerStatus: oppStatus,
        field, sortBy,
      });
    } catch (e) { console.error(e); return undefined; }
  }, [defender, oppSpecies, oppStats, oppSpread, oppItem, oppAbility, maxInvest, showAllMoves, ranks.oppAtk, ranks.oppSpa, oppStatus, field, sortBy]);

  // 주는 데미지: 나 → 상대
  const outgoing = useMemo(() => {
    if (!oppDefender || !mySpecies) return undefined;
    try {
      return analyzeThreats(oppDefender, mySpecies.name, movePool(mySpecies.name, myStats, myShowAllMoves), {
        spread: {nature: my.nature, sp: my.sp},
        item: my.item,
        ability: my.ability,
        maxInvest: false,
        attackerBoosts: {atk: ranks.myAtk, spa: ranks.mySpa},
        attackerStatus: myStatus,
        field, sortBy,
      });
    } catch (e) { console.error(e); return undefined; }
  }, [oppDefender, mySpecies, myStats, my, myShowAllMoves, ranks.myAtk, ranks.mySpa, myStatus, field, sortBy]);

  // 상대 실능 (가정 스프레드 기준, 랭크 미적용 표시용)
  const oppRealStats = useMemo(() => {
    if (!oppSpecies) return undefined;
    try {
      const p = makePokemon(oppSpecies.name, {nature: oppSpread[0], sp: oppSpread[1]});
      return {hp: p.maxHP(), atk: p.stats.atk, def: p.stats.def, spa: p.stats.spa, spd: p.stats.spd, spe: p.stats.spe};
    } catch { return undefined; }
  }, [oppSpecies, oppSpread]);

  // 스피드 시나리오
  const speed = useMemo(() => {
    if (!defender || !oppSpecies) return undefined;
    const par = (s: Status, v: number) => (s === 'par' ? Math.floor(v * 0.5) : v); // 마비 스핏 ½
    const mySpe = par(myStatus, itemSpeedMult(my.item, defender.stats.spe));
    // 주 컬럼은 상대의 실제 소지품(스카프 ×1.5 / 아이언볼 ×0.5)·마비 반영, 보조 컬럼은 소지품 없는 원본×1.5 가정
    const rows: {label: string; spe: number; scarf: number}[] = [];
    const seen = new Set<string>();
    const push = (label: string, base: number) => {
      const spe = par(oppStatus, itemSpeedMult(oppItem, base));
      const key = `${label}:${spe}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({label, spe, scarf: par(oppStatus, Math.floor(base * 1.5))});
    };
    try {
      if (oppStats?.spreads[0]) {
        const [nat, sp, pct] = oppStats.spreads[0];
        push(`통계 1위 (${NATURE_KO[nat] ?? nat} ${sp[5]} · ${pct}%)`, speedFromSpread(oppSpecies.name, nat, sp));
      }
      if (spreadIdx === -1) push('직접 입력 스프레드', speedFromSpread(oppSpecies.name, oppNature, oppSp));
      push('최속 (SP32 + 성격↑)', speedStat(oppSpecies.name, 'Timid', 32));
      push('준속 (SP32 무보정)', speedStat(oppSpecies.name, 'Serious', 32));
      push('무보정 (SP0)', speedStat(oppSpecies.name, 'Serious', 0));
    } catch { return undefined; }
    rows.sort((a, b) => b.spe - a.spe);
    const scarfPct = oppStats?.items.find(([id]) => id === 'choicescarf')?.[1];
    // 상대가 이미 스카프면 보조 컬럼은 주 컬럼과 같아 불필요 → 숨김
    const showScarfCol = oppItem !== 'choicescarf';
    const notes = [
      oppItem === 'choicescarf' ? '상대 스카프' : oppItem === 'ironball' ? '상대 아이언볼' : '',
      oppStatus === 'par' ? '상대 마비' : '', myStatus === 'par' ? '내 마비' : '',
    ].filter(Boolean).join(' · ');
    return {mySpe, rows, scarfPct, showScarfCol, oppItemNote: notes};
  }, [defender, oppSpecies, oppStats, my.item, oppItem, spreadIdx, oppNature, oppSp, myStatus, oppStatus]);

  const verdict = (opp: number, mine: number) =>
    opp > mine ? {t: '상대 선공', c: 'lose'} : opp < mine ? {t: '내가 선공', c: 'win'} : {t: '동속', c: 'tie'};

  return (
    <div className="app">
      <header>
        <div className="head-row">
          <h1>포켓몬 챔피언스 위협 분석기</h1>
          <button className="guide-btn" onClick={() => setGuideOpen(true)}>📖 가이드</button>
        </div>
        <p>
          랭크배틀 싱글 M-B · Smogon {STATS.info.month} ({STATS.info.battles.toLocaleString()}판) · 통계 기준:{' '}
          <span className="cut-toggle">
            <button className={cut === 'top' ? 'on' : ''} onClick={() => switchCut('top')}>
              상위권 {STATS.cuts.top.rating}+
            </button>
            <button className={cut === 'all' ? 'on' : ''} onClick={() => switchCut('all')}>
              전체 래더
            </button>
          </span>
        </p>
      </header>
      {guideOpen && <Guide onClose={() => setGuideOpen(false)} />}

      {/* 선택 영역 */}
      <div className="pick-row">
        <div className="pick">
          <div className="pick-title">🛡️ 내 포켓몬</div>
          <SearchSelect big options={allOptions} placeholder="내 포켓몬 (한글/영어)" onSelect={pickMy}
            selectedLabel={mySpecies ? mySpecies.ko : ''} />
          {mySpecies && defender && (
            <>
              <div className="summary">
                <span className="types">{mySpecies.types.map((t) => <TypeBadge key={t} t={t} />)}</span>
                <span className="stat-line">
                  <b className="stat-tag">종족값</b> {STAT_KEYS.map((k) => `${STAT_KO[k]} ${(mySpecies.baseStats as any)[k]}`).join(' · ')}
                </span>
                <span className="stat-line">
                  <b className="stat-tag">실능</b> HP {defender.maxHP()} · 공격 {defender.rawStats.atk} · 방어 {defender.rawStats.def} · 특공 {defender.rawStats.spa} · 특방 {defender.rawStats.spd} · 스핏 {itemSpeedMult(my.item, defender.rawStats.spe)}
                  {speedItemSuffix(my.item)}
                </span>
                <Matchups types={mySpecies.types} ability={my.ability} />
                <span className="stat-line dim">
                  <Tip tip={natureTip(my.nature)}>{NATURE_KO[my.nature]}</Tip>
                  {' · '}
                  <Tip tip={abilityTip(my.ability)}>{abilityKo(my.ability)}</Tip>
                  {' · '}
                  <Tip tip={itemTip(my.item)}>{itemKo(my.item)}</Tip>
                </span>
                {specialNotes(mySpecies.name, my.ability).map((n) => (
                  <div key={n} className="special-note">💡 {n}</div>
                ))}
              </div>
              <details>
                <summary>상세 설정 (성격 / SP / 특성 / 도구)</summary>
                <div className="config">
                  <label>성격
                    <select value={my.nature} onChange={(e) => setMy({...my, nature: e.target.value})}>
                      {Object.entries(NATURE_KO).map(([en, ko]) => <option key={en} value={en} title={natureTip(en)}>{ko} ({en})</option>)}
                    </select>
                    <span className="opt-desc">{natureTip(my.nature)}</span>
                  </label>
                  <SpGrid sp={my.sp} onChange={(sp) => setMy({...my, sp})} />
                  <label>특성
                    <select value={my.ability} onChange={(e) => setMy({...my, ability: e.target.value})}>
                      {mySpecies.abilities.map((a) => <option key={a} value={a} title={abilityTip(a)}>{abilityKo(a)} ({a})</option>)}
                    </select>
                    <span className="opt-desc">{abilityTip(my.ability)}</span>
                  </label>
                  <label>도구</label>
                  <SearchSelect options={ALL_ITEMS} placeholder="도구 검색" onSelect={(v) => setMy({...my, item: v})}
                    selectedLabel={itemKo(my.item)} />
                  {myStats && (
                    <>
                      <button onClick={() => setMy(topSpreadConfig(myStats, mySpecies.abilities[0] ?? ''))}>
                        통계 1위 스프레드 적용
                      </button>
                      <label className="check">
                        <input type="checkbox" checked={myShowAllMoves} onChange={(e) => setMyShowAllMoves(e.target.checked)} />
                        내 공격기: 배울 수 있는 모든 기술 표시
                      </label>
                    </>
                  )}
                </div>
              </details>
            </>
          )}
        </div>

        <div className="vs">VS</div>

        <div className="pick">
          <div className="pick-title">⚔️ 상대 포켓몬</div>
          <SearchSelect big options={allOptions} placeholder="상대 포켓몬 (한글/영어)" onSelect={pickOpp}
            selectedLabel={oppSpecies ? oppSpecies.ko : ''} />
          {oppSpecies && (
            <>
              <div className="summary">
                <span className="types">{oppSpecies.types.map((t) => <TypeBadge key={t} t={t} />)}</span>
                <span className="stat-line">
                  <b className="stat-tag">종족값</b> {STAT_KEYS.map((k) => `${STAT_KO[k]} ${(oppSpecies.baseStats as any)[k]}`).join(' · ')}
                </span>
                {oppRealStats && (
                  <span className="stat-line">
                    <b className="stat-tag">실능</b> HP {oppRealStats.hp} · 공격 {oppRealStats.atk} · 방어 {oppRealStats.def} · 특공 {oppRealStats.spa} · 특방 {oppRealStats.spd} · 스핏 {itemSpeedMult(oppItem, oppRealStats.spe)}
                    {speedItemSuffix(oppItem)}
                  </span>
                )}
                <Matchups types={oppSpecies.types} ability={oppAbility} />
                <span className="stat-line dim">
                  가정: <Tip tip={abilityTip(oppAbility)}>{abilityKo(oppAbility) || '특성 없음'}</Tip>
                  {' · '}
                  <Tip tip={itemTip(oppItem)}>{itemKo(oppItem)}</Tip>
                  {' · '}
                  <Tip tip={natureTip(oppSpread[0])}>{NATURE_KO[oppSpread[0]] ?? oppSpread[0]}</Tip>
                  {' '}{oppSpread[1].join('/')}
                  {spreadIdx === -1 && ' (직접 입력)'}
                </span>
                {specialNotes(oppSpecies.name, oppAbility).map((n) => (
                  <div key={n} className="special-note">💡 {n}</div>
                ))}
              </div>
              <details>
                <summary>상세 설정 (특성 / 도구 / 스프레드 가정)</summary>
                <div className="config">
                  <label>특성{oppStats ? ' (채용률)' : ''}
                    <select value={oppAbility} onChange={(e) => setOppAbility(e.target.value)}>
                      {oppStats
                        ? oppStats.abilities.map(([id, pct]) => {
                            if (id === 'noability') return <option key={id} value="">특성 없음 · {pct}%</option>;
                            const name = gen.abilities.get(id as any)?.name ?? id;
                            return <option key={id} value={name} title={abilityTip(name)}>{abilityKo(name)} · {pct}%</option>;
                          })
                        : oppSpecies.abilities.map((a) => <option key={a} value={a} title={abilityTip(a)}>{abilityKo(a)} ({a})</option>)}
                    </select>
                    {oppAbility && <span className="opt-desc">{abilityTip(oppAbility)}</span>}
                  </label>
                  {oppStats ? (
                    <label>도구 (채용률)
                      <select value={oppItem} onChange={(e) => setOppItem(e.target.value)}>
                        {oppStats.items.map(([id, pct]) => (
                          <option key={id} value={id}>{itemKo(id)} · {pct}%</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <>
                      <label>도구</label>
                      <SearchSelect options={ALL_ITEMS} placeholder="도구 검색" onSelect={setOppItem}
                        selectedLabel={itemKo(oppItem)} />
                    </>
                  )}
                  {oppStats && (
                    <label>스프레드 (채용률)
                      <select value={spreadIdx} onChange={(e) => switchSpread(Number(e.target.value))}>
                        {oppStats.spreads.map(([nature, sp, pct], i) => (
                          <option key={i} value={i}>{NATURE_KO[nature] ?? nature} {sp.join('/')} · {pct}%</option>
                        ))}
                        <option value={-1}>직접 입력 (성격·SP 커스텀)</option>
                      </select>
                    </label>
                  )}
                  {(spreadIdx === -1 || !oppStats) && (
                    <>
                      <label>상대 성격
                        <select value={oppNature} onChange={(e) => setOppNature(e.target.value)}>
                          {Object.entries(NATURE_KO).map(([en, ko]) => <option key={en} value={en} title={natureTip(en)}>{ko} ({en})</option>)}
                        </select>
                        <span className="opt-desc">{natureTip(oppNature)}</span>
                      </label>
                      <SpGrid sp={oppSp} onChange={setOppSp} />
                    </>
                  )}
                  <label className="check">
                    <input type="checkbox" checked={maxInvest} onChange={(e) => setMaxInvest(e.target.checked)} />
                    풀보정 가정 (공격 SP 32 + 보정 성격)
                  </label>
                  {oppStats && (
                    <label className="check">
                      <input type="checkbox" checked={showAllMoves} onChange={(e) => setShowAllMoves(e.target.checked)} />
                      배울 수 있는 모든 공격기 표시
                    </label>
                  )}
                </div>
              </details>
            </>
          )}
        </div>
      </div>

      {/* 특성으로 자동 적용된 날씨·필드 안내 (크게 표시) */}
      {oppSpecies && mySpecies && !fieldManual && (autoField.weather || autoField.terrain) && (
        <div className="auto-field">
          <span className="af-icon">{autoField.weather ? WEATHER_ICON[autoField.weather.v] : TERRAIN_ICON[autoField.terrain!.v]}</span>
          <span className="af-text">
            <b>{autoField.weather ? WEATHER_KO[autoField.weather.v] : TERRAIN_KO[autoField.terrain!.v]}</b> 자동 적용됨
            <em>
              {(autoField.weather ?? autoField.terrain)!.who}의 특성 「{abilityKo((autoField.weather ?? autoField.terrain)!.ability)}」 — 아래 데미지에 반영 중
            </em>
          </span>
          <button className="af-off" onClick={() => setFieldByUser({weather: '', terrain: ''})}>끄기</button>
        </div>
      )}

      {/* 날씨·필드 (양쪽 데미지에 공통 적용) */}
      {oppSpecies && mySpecies && (
        <div className="field-bar">
          <span className="field-title">🌦️ 필드 상태</span>
          <label>날씨
            <select value={field.weather} onChange={(e) => setFieldByUser({...field, weather: e.target.value as Weather})}
              className={field.weather ? 'on' : ''}>
              {(Object.keys(WEATHER_KO) as Weather[]).map((w) => <option key={w} value={w}>{WEATHER_KO[w]}</option>)}
            </select>
          </label>
          <label>필드
            <select value={field.terrain} onChange={(e) => setFieldByUser({...field, terrain: e.target.value as Terrain})}
              className={field.terrain ? 'on' : ''}>
              {(Object.keys(TERRAIN_KO) as Terrain[]).map((t) => <option key={t} value={t}>{TERRAIN_KO[t]}</option>)}
            </select>
          </label>
          {(field.weather || field.terrain) && (
            <button className="field-reset" onClick={() => setFieldByUser({weather: '', terrain: ''})}>초기화</button>
          )}
          {fieldManual && (autoField.weather || autoField.terrain) && (
            <button className="field-reset" onClick={() => setFieldManual(false)}>특성 자동값 복원</button>
          )}
          <span className="field-hint">필드는 땅에 있는 포켓몬에게만 적용됩니다</span>
        </div>
      )}

      {/* 스피드 판정 */}
      {speed && oppSpecies && (
        <section className="card speed-card">
          <h2>⚡ 스피드 판정 <small>내 스핏 실능 {speed.mySpe}{speedItemSuffix(my.item)}{speed.oppItemNote ? ` · ${speed.oppItemNote}` : ''}</small></h2>
          <table>
            <thead>
              <tr>
                <th>상대 가정</th><th>실능</th><th>판정</th>
                {speed.showScarfCol && <th>스카프면{speed.scarfPct ? ` (채용 ${speed.scarfPct}%)` : ''}</th>}
              </tr>
            </thead>
            <tbody>
              {speed.rows.map((r) => {
                const v = verdict(r.spe, speed.mySpe);
                const vs = verdict(r.scarf, speed.mySpe);
                return (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td className="num">{r.spe}</td>
                    <td><span className={`chip-v ${v.c}`}>{v.t}</span></td>
                    {speed.showScarfCol && <td><span className={`chip-v ${vs.c}`}>{r.scarf} · {vs.t}</span></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* 받는 데미지 */}
      {incoming && oppSpecies && mySpecies && defender && (
        <section className="card">
          <h2>🛡️ 받는 데미지 <small>{oppSpecies.ko} → {mySpecies.ko} (내 HP {defender.maxHP()})</small></h2>
          <div className="controls">
            <div className="ctrl-group">
              <span className="ctrl-label">랭크</span>
              <RankSelect label="상대 공격" value={ranks.oppAtk} onChange={setRank('oppAtk')} />
              <RankSelect label="상대 특공" value={ranks.oppSpa} onChange={setRank('oppSpa')} />
              <RankSelect label="내 방어" value={ranks.myDef} onChange={setRank('myDef')} />
              <RankSelect label="내 특방" value={ranks.mySpd} onChange={setRank('mySpd')} />
            </div>
            <div className="ctrl-group">
              <span className="ctrl-label">상태</span>
              <StatusSelect label="상대" value={oppStatus} onChange={setOppStatus} />
              <StatusSelect label="나" value={myStatus} onChange={setMyStatus} />
            </div>
            <SortToggle sortBy={sortBy} setSortBy={setSortBy} />
          </div>
          <ThreatTable rows={incoming.rows} />
        </section>
      )}

      {/* 주는 데미지 */}
      {outgoing && oppSpecies && mySpecies && oppDefender && (
        <section className="card">
          <h2>🗡️ 주는 데미지 <small>{mySpecies.ko} → {oppSpecies.ko} (상대 HP {oppDefender.maxHP()})</small></h2>
          <div className="controls">
            <div className="ctrl-group">
              <span className="ctrl-label">랭크</span>
              <RankSelect label="내 공격" value={ranks.myAtk} onChange={setRank('myAtk')} />
              <RankSelect label="내 특공" value={ranks.mySpa} onChange={setRank('mySpa')} />
              <RankSelect label="상대 방어" value={ranks.oppDef} onChange={setRank('oppDef')} />
              <RankSelect label="상대 특방" value={ranks.oppSpd} onChange={setRank('oppSpd')} />
            </div>
            <div className="ctrl-group">
              <span className="ctrl-label">상태</span>
              <StatusSelect label="나" value={myStatus} onChange={setMyStatus} />
              <StatusSelect label="상대" value={oppStatus} onChange={setOppStatus} />
            </div>
            <SortToggle sortBy={sortBy} setSortBy={setSortBy} />
          </div>
          <ThreatTable rows={outgoing.rows} />
          <p className="fineprint">
            연속기는 계산기 기본 타수 가정 · 킬가르도/돌핀맨은 공격 폼(블레이드/마이티) 기준 ·
            챔피언스 기술 밸런스 패치 반영 · SP는 공식 변환으로 본가 계산식과 실능 1:1 일치 ·
            데이터: Smogon {STATS.info.month} / Showdown / PokeAPI
          </p>
        </section>
      )}
      {!oppSpecies && (
        <p className="empty">양쪽 포켓몬을 선택하면 ⚡ 스피드 추월 여부와 🛡️ 받는 데미지, 🗡️ 주는 데미지가 바로 표시됩니다.</p>
      )}
    </div>
  );
}
