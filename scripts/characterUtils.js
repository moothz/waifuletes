
export function slugifyCharacter(text) {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function cleanSeriesTitle(title) {
  if (!title) return 'Anime';
  return title
    .replace(/:\s*Season\s*\d+.*$/i, '')
    .replace(/\s+Season\s*\d+.*$/i, '')
    .replace(/:\s*Part\s*\d+.*$/i, '')
    .replace(/\s+Part\s*\d+.*$/i, '')
    .replace(/:\s*The Final Season.*$/i, '')
    .replace(/\s+Final Season.*$/i, '')
    .replace(/:\s*(?:2nd|3rd|4th|5th)\s+Season.*$/i, '')
    .replace(/\s+\b(II|III|IV|V|VI)\b.*$/i, '')
    .replace(/\s+\b\d+\b$/i, '')
    .replace(/:\s*The Missing Pieces$/i, '')
    .replace(/:\s*Visitor Arc$/i, '')
    .replace(/:\s*The Culling Game.*$/i, '')
    .replace(/:\s*Diamond is Unbreakable.*$/i, '')
    .replace(/:\s*The School Idol Movie.*$/i, '')
    .replace(/:\s*School Idol Project.*$/i, '')
    .replace(/\s*OVAs?.*$/i, '')
    .replace(/\s*Specials?.*$/i, '')
    .trim() || title;
}

const RARITY_ORDER = {
  COMMON: 1,
  UNCOMMON: 2,
  RARE: 3,
  EPIC: 4,
  LEGENDARY: 5,
};

export function calculateRarityFromMudaeRank(rank) {
  if (!rank || rank <= 0) return 'COMMON';
  if (rank <= 50) return 'LEGENDARY';
  if (rank <= 250) return 'EPIC';
  if (rank <= 1000) return 'RARE';
  if (rank <= 3000) return 'UNCOMMON';
  return 'COMMON';
}

export function pickHigherRarity(r1, r2) {
  const v1 = RARITY_ORDER[r1] || 1;
  const v2 = RARITY_ORDER[r2] || 1;
  return v1 >= v2 ? r1 : r2;
}

export function normalizeName(str) {
  if (!str) return '';
  return str
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

const SERIES_ALIASES = {
  rezero: ['re:zero', 'rezero', 're zero', 'starting life in another world'],
  konosuba: ['konosuba', 'kono subarashii', 'isekai quartet'],
  demonslayer: ['kimetsu no yaiba', 'demon slayer'],
  attackontitan: ['shingeki no kyojin', 'attack on titan'],
  myheroacademia: ['boku no hero academia', 'my hero academia'],
  fate: ['fate/', 'fate series', 'fate/stay night', 'fate/zero', 'fate/grand order', 'fate extra', 'fate/apocrypha'],
  dragonball: ['dragon ball', 'dragonball'],
  swordartonline: ['sword art online', 'sao'],
  jujutsukaisen: ['jujutsu kaisen', 'jjk'],
  onepiece: ['one piece'],
  chainsawman: ['chainsaw man'],
  genshin: ['genshin impact', 'genshin'],
  honkai: ['honkai: star rail', 'honkai impact', 'honkai'],
  danganronpa: ['danganronpa'],
  highschooldxd: ['high school dxd', 'highschool dxd', 'dxd'],
  evangelion: ['neon genesis evangelion', 'evangelion'],
  steinsgate: ['steins;gate', 'steins gate'],
  darlinginthefranxx: ['darling in the franxx', 'ditf'],
  bleach: ['bleach'],
  naruto: ['naruto', 'naruto shippuden', 'boruto'],
  hunterxhunter: ['hunter x hunter', 'hunterxhunter'],
  bluearchive: ['blue archive'],
  nikke: ['goddess of victory: nikke', 'nikke'],
  deathnote: ['death note'],
  overlord: ['overlord'],
  quintessentialquintuplets: ['5-toubun no hanayome', 'the quintessential quintuplets', 'gotoubun'],
  mydressupdarling: ['sono bisque doll wa koi wo suru', 'my dress-up darling'],
  frieren: ['sousou no frieren', 'frieren: beyond journey’s end', 'frieren'],
  rascaldoesnotdream: ['seishun buta yarou', 'rascal does not dream'],
  jojo: ['jojo\'s bizarre adventure', 'jojo no kimyou na bouken'],
  bocchi: ['bocchi the rock'],
  spyxfamily: ['spy x family', 'spyxfamily'],
  danmachi: ['danmachi', 'is it wrong to try to pick up girls in a dungeon'],
  monogatari: ['bakemonogatari', 'monogatari series', 'kizumonogatari', 'nisemonogatari'],
  toarumajutsu: ['toaru majutsu no index', 'toaru kagaku no railgun', 'a certain magical index', 'a certain scientific railgun'],
  gintama: ['gintama'],
  pokemon: ['pokemon', 'pocket monsters'],
  leagueoflegends: ['league of legends', 'arcane']
};

export function normalizeSeries(series) {
  if (!series) return '';
  const cleaned = cleanSeriesTitle(series);
  const lower = cleaned.toLowerCase();

  for (const [canonical, aliases] of Object.entries(SERIES_ALIASES)) {
    if (aliases.some(a => lower.includes(a))) {
      return canonical;
    }
  }

  return cleaned
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

export function seriesMatch(seriesA, seriesB, contextA = '', contextB = '') {
  if (!seriesA || !seriesB) return false;
  const normA = normalizeSeries(seriesA);
  const normB = normalizeSeries(seriesB);

  if (normA && normA === normB) return true;

  if (normA.length >= 4 && normB.length >= 4) {
    if (normA.includes(normB) || normB.includes(normA)) return true;
  }

  // Cross-reference descriptions or context for known crossovers/misattributed series
  const combinedContext = `${contextA} ${contextB}`.toLowerCase();
  if (combinedContext) {
    if (normA === 'rezero' && (combinedContext.includes('re:zero') || combinedContext.includes('roswaal') || combinedContext.includes('subaru') || combinedContext.includes('lugnica'))) {
      return true;
    }
    if (normB === 'rezero' && (combinedContext.includes('re:zero') || combinedContext.includes('roswaal') || combinedContext.includes('subaru') || combinedContext.includes('lugnica'))) {
      return true;
    }
    if (normA === 'konosuba' && (combinedContext.includes('konosuba') || combinedContext.includes('kazuma') || combinedContext.includes('axel'))) {
      return true;
    }
    if (normB === 'konosuba' && (combinedContext.includes('konosuba') || combinedContext.includes('kazuma') || combinedContext.includes('axel'))) {
      return true;
    }
  }

  return false;
}

