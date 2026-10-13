// Profil d'investisseur : le questionnaire, le calcul du profil de risque, le choix des actions et les réglages du bot.
//
// Le principe est celui des banques suisses (loi sur les services financiers, LSFin) et des « robo-advisors » :
//   - la CAPACITÉ de risque : ce que la situation de la personne lui permet de perdre (horizon, épargne, réserve) ;
//   - la TOLÉRANCE au risque : ce qu'elle est prête à supporter (objectif, réaction à une baisse…) ;
//   - les CONNAISSANCES : un débutant ne reçoit pas un profil très risqué.
// Le profil retenu est le plus prudent des trois : c'est le maillon le plus faible qui décide.
//
// Le bot choisit ensuite lui-même ses actions en mesurant leur « agitation » (volatilité) sur l'année passée :
// des placements calmes pour un profil prudent, plus agités pour un profil audacieux.

import type { BacktestResult, BotConfig, BrokerId, Interval, RiskLevel, SelectionMeasure, SelectionSnapshot, StrategyId } from './types.ts';

// ---------------------------------------------------------------------------
// Le questionnaire
// ---------------------------------------------------------------------------

export interface QuestionOption {
  id: string;
  label: string;
  detail?: string;
  /** Points de tolérance au risque (0 = très prudent, 3 = très audacieux). */
  points?: number;
  /** Pour les questions de connaissances : la bonne réponse. */
  correct?: boolean;
}

export interface Question {
  id: string;
  section: string;
  title: string;
  /** Pourquoi on pose cette question, en une phrase. */
  why: string;
  options: QuestionOption[];
  /** Question de connaissances : on affiche la bonne réponse et son explication après le choix. */
  quiz?: { explanation: string };
}

export const SECTIONS = ['Votre situation', 'Vous et le risque', 'Vos connaissances', 'Vos préférences'] as const;

export const QUESTIONS: Question[] = [
  {
    id: 'horizon',
    section: 'Votre situation',
    title: 'Dans combien de temps pourriez-vous avoir besoin de cet argent ?',
    why: "Plus on peut attendre, plus on peut traverser les baisses de la bourse sans devoir vendre au mauvais moment.",
    options: [
      { id: 'lt1', label: "Dans moins d'un an" },
      { id: '1to3', label: 'Dans 1 à 3 ans' },
      { id: '3to5', label: 'Dans 3 à 5 ans' },
      { id: '5to10', label: 'Dans 5 à 10 ans' },
      { id: 'gt10', label: 'Pas avant 10 ans ou plus' },
    ],
  },
  {
    id: 'share',
    section: 'Votre situation',
    title: 'Cet argent représente quelle part de vos économies ?',
    why: "On ne place en bourse que de l'argent dont on n'a pas besoin. Si c'est presque tout ce que vous avez, il faut être plus prudent.",
    options: [
      { id: 'small', label: 'Une petite partie', detail: "Moins d'un quart de mes économies" },
      { id: 'half', label: 'Environ la moitié' },
      { id: 'most', label: 'Presque tout' },
    ],
  },
  {
    id: 'reserve',
    section: 'Votre situation',
    title: 'Si vous aviez une grosse dépense imprévue, pourriez-vous la payer sans toucher à ce placement ?',
    why: "Une réserve de secours évite de devoir revendre ses actions juste après une baisse, et donc d'encaisser la perte.",
    options: [
      { id: 'yes', label: 'Oui, sans problème' },
      { id: 'hard', label: 'Oui, mais difficilement' },
      { id: 'no', label: 'Non' },
    ],
  },
  {
    id: 'goal',
    section: 'Vous et le risque',
    title: "Qu'attendez-vous surtout de ce placement ?",
    why: "Un placement qui peut rapporter beaucoup peut aussi perdre beaucoup : c'est la règle de base de la bourse.",
    options: [
      { id: 'protect', label: "Surtout ne pas perdre d'argent", detail: 'Même si ça rapporte peu', points: 0 },
      { id: 'savings', label: "Gagner un peu plus qu'un compte épargne", points: 1 },
      { id: 'grow', label: 'Faire grossir mon argent sur plusieurs années', points: 2 },
      { id: 'max', label: 'Gagner le plus possible', detail: "Quitte à prendre de gros risques", points: 3 },
    ],
  },
  {
    id: 'drop',
    section: 'Vous et le risque',
    title: 'Imaginez : vous placez 10 000 CHF. Un mois plus tard, ils ne valent plus que 8 500 CHF. Que faites-vous ?',
    why: "Ce genre de baisse arrive régulièrement en bourse. Votre réaction dit beaucoup de ce que vous pouvez supporter.",
    options: [
      { id: 'sell_all', label: 'Je retire tout', detail: 'Je ne veux pas perdre plus', points: 0 },
      { id: 'sell_part', label: "J'en retire une partie", points: 1 },
      { id: 'wait', label: "J'attends", detail: 'Ça finira bien par remonter', points: 2 },
      { id: 'buy_more', label: "J'en rajoute", detail: "C'est le moment d'acheter moins cher", points: 3 },
    ],
  },
  {
    id: 'choice',
    section: 'Vous et le risque',
    title: 'Pour une année, lequel de ces placements choisiriez-vous ?',
    why: "Il n'y a pas de bonne réponse : chacun choisit l'équilibre entre gain possible et perte possible qui lui convient.",
    options: [
      { id: 'a', label: 'Au pire −2 %, au mieux +4 %', points: 0 },
      { id: 'b', label: 'Au pire −8 %, au mieux +12 %', points: 1 },
      { id: 'c', label: 'Au pire −15 %, au mieux +25 %', points: 2 },
      { id: 'd', label: 'Au pire −30 %, au mieux +50 %', points: 3 },
    ],
  },
  {
    id: 'maxloss',
    section: 'Vous et le risque',
    title: 'À partir de quelle baisse ne dormiriez-vous plus tranquille ?',
    why: "Le bot s'en servira comme limite : si votre placement baisse autant, il vend tout pour protéger le reste.",
    options: [
      { id: '5', label: 'Une baisse de 5 %', detail: '500 CHF perdus sur 10 000', points: 0 },
      { id: '10', label: 'Une baisse de 10 %', detail: '1 000 CHF perdus sur 10 000', points: 1 },
      { id: '20', label: 'Une baisse de 20 %', detail: '2 000 CHF perdus sur 10 000', points: 2 },
      { id: '35', label: 'Une baisse de 35 % ou plus', detail: '3 500 CHF perdus sur 10 000', points: 3 },
    ],
  },
  {
    id: 'experience',
    section: 'Vos connaissances',
    title: 'Avez-vous déjà investi (actions, fonds, cryptos…) ?',
    why: 'Un débutant reçoit un profil plus prudent, le temps de découvrir comment la bourse bouge.',
    options: [
      { id: 'never', label: 'Jamais' },
      { id: 'little', label: 'Un peu, quelques fois' },
      { id: 'regular', label: 'Oui, régulièrement' },
    ],
  },
  {
    id: 'quiz_stock',
    section: 'Vos connaissances',
    title: "D'après vous, une action, c'est…",
    why: "Une petite question pour vérifier qu'on parle de la même chose. Ce n'est pas grave de se tromper !",
    options: [
      { id: 'loan', label: 'Un prêt à une entreprise, remboursé avec des intérêts' },
      { id: 'share', label: "Un petit morceau d'une entreprise, dont le prix monte et descend", correct: true },
      { id: 'guaranteed', label: 'Un placement garanti par la banque' },
    ],
    quiz: {
      explanation:
        "Une action est un petit morceau d'une entreprise. Si l'entreprise marche bien, son prix a tendance à monter ; sinon, il baisse. Rien n'est garanti. (Le prêt à une entreprise, c'est une « obligation ».)",
    },
  },
  {
    id: 'quiz_diversify',
    section: 'Vos connaissances',
    title: 'Pourquoi achète-t-on plusieurs actions différentes plutôt qu’une seule ?',
    why: "C'est la règle la plus importante pour investir sans trop de risque.",
    options: [
      { id: 'more_gain', label: 'Pour être sûr de gagner plus' },
      { id: 'less_risk', label: "Pour que la chute d'une seule ne fasse pas tout perdre", correct: true },
      { id: 'mandatory', label: "Parce que c'est obligatoire" },
    ],
    quiz: {
      explanation:
        "C'est la « diversification » : si une entreprise s'effondre, les autres limitent la casse. Ça ne garantit pas de gagner, mais ça réduit fortement le risque.",
    },
  },
  {
    id: 'region',
    section: 'Vos préférences',
    title: 'Dans quoi aimeriez-vous que le bot investisse ?',
    why: 'Le bot choisira ses actions dans cette famille, selon votre profil de risque.',
    options: [
      { id: 'ch', label: 'Surtout en Suisse', detail: 'Nestlé, Novartis, Swisscom, UBS…' },
      { id: 'world', label: 'Dans le monde entier', detail: 'Suisse, États-Unis, Europe' },
      { id: 'tech', label: 'Dans la tech', detail: 'Apple, Microsoft, Nvidia, Logitech…' },
      { id: 'any', label: 'Peu importe', detail: 'Le bot choisit parmi tout' },
    ],
  },
  {
    id: 'crypto',
    section: 'Vos préférences',
    title: 'Le bot peut-il acheter un peu de cryptomonnaies (Bitcoin…) ?',
    why: 'Les cryptos peuvent perdre la moitié de leur valeur en quelques semaines. Elles ne sont utilisées que pour les profils dynamique et audacieux.',
    options: [
      { id: 'no', label: 'Non, merci' },
      { id: 'yes', label: 'Oui, un peu' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Les 5 profils et les réglages du bot pour chacun
// ---------------------------------------------------------------------------

/** Tranches d'agitation (volatilité annuelle en %), du plus calme au plus agité. */
export type RiskBand = 'very_calm' | 'calm' | 'medium' | 'agitated' | 'very_agitated';

export const BANDS: { id: RiskBand; label: string; max: number }[] = [
  { id: 'very_calm', label: 'Très calme', max: 8 },
  { id: 'calm', label: 'Calme', max: 20 },
  { id: 'medium', label: 'Moyen', max: 30 },
  { id: 'agitated', label: 'Agité', max: 45 },
  { id: 'very_agitated', label: 'Très agité', max: Infinity },
];

export function bandOf(volatility: number): RiskBand {
  return (BANDS.find((b) => volatility < b.max) ?? BANDS[BANDS.length - 1]).id;
}

export interface ProfileInfo {
  level: RiskLevel;
  name: string;
  /** Ce que veut la personne, en une phrase. */
  tagline: string;
  /** Ce que le bot fait pour elle, en langage simple. */
  plan: string;
  /** Ordre de grandeur d'une année normale (en %), pour se faire une idée. */
  typicalYear: { worst: number; best: number };
  /** Comment le bot décide, en langage simple. */
  howItDecides: string;
  strategy: StrategyId;
  params: Record<string, number>;
  interval: Interval;
  /** Part maximale de l'argent investie en même temps (le reste attend en sécurité). */
  maxInvestedPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  /** Limite de perte globale par défaut (la réponse « baisse supportable » peut la réduire). */
  maxLossPct: number;
  /** Les cases à remplir, chacune avec un niveau d'agitation. */
  slots: RiskBand[];
}

/** Explication de la règle « suivre la tendance », avec les réglages du profil. */
export function trendExplanation(days: number, band: number): string {
  const weeks = Math.round(days / 5);
  return `Une fois par jour, à la clôture de la bourse, le bot compare le prix de chaque placement à son prix moyen des ${days} derniers jours de bourse (environ ${weeks} semaines). Il achète quand le prix est au-dessus (la tendance monte) et vend quand il passe plus de ${band} % en dessous (la tendance s'est retournée). Il agit peu souvent : chaque achat et chaque vente coûte des frais.`;
}

/**
 * Comment décide le bot d'un placement créé avec le questionnaire.
 * Nos tests honnêtes sur les vrais cours (choix en oct. 2022 avec les seuls cours d'avant, puis rejoué jusqu'en
 * oct. 2026, frais réels de Yuh) ont montré que, pour un petit investisseur, acheter et vendre souvent (par exemple en
 * suivant la tendance) rapporte moins, à tous les niveaux de risque, que de garder ses placements : les frais et les
 * allers-retours mangent les gains. Le bot choisit donc bien, puis garde et protège.
 */
const HOLD_AND_PROTECT =
  "Le bot achète les placements choisis dès que leur bourse est ouverte, puis il les garde. Chaque jour, il vérifie ce que vaut votre placement : s'il descend sous votre limite de perte, il vend tout pour protéger le reste. Il n'achète et ne vend pas sans arrêt : nos tests sur 4 ans de vrais cours montrent que les allers-retours coûtent plus en frais qu'ils ne rapportent.";

export const PROFILES: Record<RiskLevel, ProfileInfo> = {
  1: {
    level: 1,
    name: 'Très prudent',
    tagline: "Votre priorité : ne pas perdre d'argent.",
    plan: "Le bot place votre argent dans des placements très calmes (des prêts à l'État ou à de grandes entreprises suisses, de l'or, des entreprises très stables) et garde 40 % de côté.",
    typicalYear: { worst: -3, best: 5 },
    howItDecides: HOLD_AND_PROTECT,
    strategy: 'buy_hold',
    params: {},
    interval: '1d',
    maxInvestedPct: 60,
    stopLossPct: 0,
    takeProfitPct: 0,
    maxLossPct: 5,
    slots: ['very_calm', 'very_calm', 'calm', 'calm'],
  },
  2: {
    level: 2,
    name: 'Prudent',
    tagline: "Faire un peu mieux qu'un compte épargne, sans stress.",
    plan: 'Le bot mélange des placements très calmes et des actions de grandes entreprises stables, et garde 20 % de côté.',
    typicalYear: { worst: -8, best: 12 },
    howItDecides: HOLD_AND_PROTECT,
    strategy: 'buy_hold',
    params: {},
    interval: '1d',
    maxInvestedPct: 80,
    stopLossPct: 0,
    takeProfitPct: 0,
    maxLossPct: 10,
    slots: ['very_calm', 'calm', 'calm', 'calm', 'medium'],
  },
  3: {
    level: 3,
    name: 'Équilibré',
    tagline: 'Faire grossir votre argent en acceptant quelques baisses.',
    plan: 'Le bot investit surtout dans des actions de grandes entreprises, calmes et moyennes, et garde 10 % de côté.',
    typicalYear: { worst: -15, best: 25 },
    howItDecides: HOLD_AND_PROTECT,
    strategy: 'buy_hold',
    params: {},
    interval: '1d',
    maxInvestedPct: 90,
    stopLossPct: 0,
    takeProfitPct: 0,
    maxLossPct: 15,
    slots: ['calm', 'calm', 'medium', 'medium', 'medium', 'agitated'],
  },
  4: {
    level: 4,
    name: 'Dynamique',
    tagline: 'Viser plus de gains, en acceptant des baisses importantes.',
    plan: 'Le bot investit tout votre argent dans des actions plus agitées, qui peuvent monter plus vite… et baisser plus vite.',
    typicalYear: { worst: -25, best: 40 },
    howItDecides: HOLD_AND_PROTECT,
    strategy: 'buy_hold',
    params: {},
    interval: '1d',
    maxInvestedPct: 100,
    stopLossPct: 0,
    takeProfitPct: 0,
    maxLossPct: 25,
    slots: ['calm', 'medium', 'medium', 'agitated', 'agitated', 'agitated'],
  },
  5: {
    level: 5,
    name: 'Audacieux',
    tagline: 'Chercher le maximum de gains, en acceptant de grosses baisses.',
    plan: "Le bot investit tout votre argent dans les actions les plus agitées (et un peu de cryptos si vous les acceptez). C'est le profil qui peut le plus gagner, et le plus perdre.",
    typicalYear: { worst: -35, best: 60 },
    howItDecides: HOLD_AND_PROTECT,
    strategy: 'buy_hold',
    params: {},
    interval: '1d',
    maxInvestedPct: 100,
    stopLossPct: 0,
    takeProfitPct: 0,
    maxLossPct: 35,
    slots: ['medium', 'agitated', 'agitated', 'very_agitated', 'very_agitated'],
  },
};

// ---------------------------------------------------------------------------
// Calcul du profil
// ---------------------------------------------------------------------------

export type Answers = Record<string, string>;

export interface ProfileResult {
  level: RiskLevel;
  /** Les trois mesures, de 1 à 5. */
  capacity: RiskLevel;
  tolerance: RiskLevel;
  knowledgeCap: RiskLevel;
  /** Pourquoi le profil n'est pas plus élevé (en langage simple). */
  limitedBy: string[];
  /** Réponses qui se contredisent, expliquées. */
  warnings: string[];
  /** Limite de perte globale retenue (en %). */
  maxLossPct: number;
  quizCorrect: number;
}

const clampLevel = (n: number) => Math.min(5, Math.max(1, Math.round(n))) as RiskLevel;

const HORIZON_CAP: Record<string, RiskLevel> = { lt1: 1, '1to3': 2, '3to5': 3, '5to10': 4, gt10: 5 };
const SHARE_CAP: Record<string, RiskLevel> = { small: 5, half: 4, most: 2 };
const RESERVE_CAP: Record<string, RiskLevel> = { yes: 5, hard: 3, no: 2 };

function points(questionId: string, answers: Answers): number {
  const q = QUESTIONS.find((x) => x.id === questionId);
  return q?.options.find((o) => o.id === answers[questionId])?.points ?? 0;
}

export function isCorrect(questionId: string, answers: Answers): boolean {
  const q = QUESTIONS.find((x) => x.id === questionId);
  return !!q?.options.find((o) => o.id === answers[questionId])?.correct;
}

export function computeProfile(answers: Answers): ProfileResult {
  // 1. Capacité : la situation décide (le plus faible des trois critères).
  const horizonCap = HORIZON_CAP[answers.horizon] ?? 1;
  const shareCap = SHARE_CAP[answers.share] ?? 2;
  const reserveCap = RESERVE_CAP[answers.reserve] ?? 2;
  const capacity = Math.min(horizonCap, shareCap, reserveCap) as RiskLevel;

  // 2. Tolérance : 4 questions notées de 0 à 3 (total sur 12).
  const tolPoints = ['goal', 'drop', 'choice', 'maxloss'].reduce((a, id) => a + points(id, answers), 0);
  const tolerance = (tolPoints <= 2 ? 1 : tolPoints <= 5 ? 2 : tolPoints <= 8 ? 3 : tolPoints <= 10 ? 4 : 5) as RiskLevel;

  // 3. Connaissances : expérience (0 à 2) + bonnes réponses au quiz (0 à 2).
  const experience = { never: 0, little: 1, regular: 2 }[answers.experience as 'never'] ?? 0;
  const quizCorrect = (isCorrect('quiz_stock', answers) ? 1 : 0) + (isCorrect('quiz_diversify', answers) ? 1 : 0);
  const knowledge = experience + quizCorrect;
  const knowledgeCap = (knowledge <= 1 ? 3 : knowledge === 2 ? 4 : 5) as RiskLevel;

  const level = clampLevel(Math.min(capacity, tolerance, knowledgeCap));

  const limitedBy: string[] = [];
  if (level < tolerance) {
    if (horizonCap === level) limitedBy.push("vous pourriez avoir besoin de cet argent assez vite : il faut éviter qu'une baisse tombe au mauvais moment");
    if (shareCap === level) limitedBy.push("cet argent représente une grande partie de vos économies");
    if (reserveCap === level) limitedBy.push("vous n'avez pas (ou peu) de réserve de secours en cas d'imprévu");
    if (knowledgeCap === level) limitedBy.push("vous débutez : le bot ne prend pas plus de risque qu'un profil équilibré le temps que vous découvriez la bourse");
  }

  const warnings: string[] = [];
  if (answers.goal === 'max' && (answers.drop === 'sell_all' || answers.maxloss === '5'))
    warnings.push(
      "Vous voulez gagner le plus possible, mais une petite baisse vous ferait tout retirer. Les placements qui peuvent rapporter le plus sont justement ceux qui baissent le plus fort : le bot suit votre réponse la plus prudente.",
    );
  if (tolerance - capacity >= 2)
    warnings.push("Vous êtes prêt à prendre des risques, mais votre situation ne le permet pas vraiment : le bot reste plus prudent pour vous protéger.");
  if (capacity - tolerance >= 2)
    warnings.push("Votre situation vous permettrait de prendre plus de risques, mais vous préférez la tranquillité : le bot respecte votre choix.");

  const answered = Number(answers.maxloss);
  const maxLossPct = Math.min(PROFILES[level].maxLossPct, Number.isFinite(answered) && answered > 0 ? answered : PROFILES[level].maxLossPct);

  return { level, capacity, tolerance, knowledgeCap, limitedBy, warnings, maxLossPct, quizCorrect };
}

// ---------------------------------------------------------------------------
// Les actions parmi lesquelles le bot choisit
// ---------------------------------------------------------------------------

export type AssetKind = 'action' | 'fonds' | 'obligations' | 'or' | 'crypto';
export type AssetRegion = 'CH' | 'US' | 'EU' | 'WORLD' | 'CRYPTO';

export interface AssetInfo {
  symbol: string;
  name: string;
  /** Ce que c'est, pour quelqu'un qui n'y connaît rien. */
  what: string;
  kind: AssetKind;
  region: AssetRegion;
  sector: string;
  tech?: boolean;
  /** Monnaie dans laquelle le placement est coté. */
  currency: string;
}

/** Fonds cotés à la bourse suisse mais en dollars. */
const QUOTED_IN_USD = new Set(['CSSPX.SW', 'CSNDX.SW']);

/** Monnaie de cotation d'un symbole Yahoo Finance (déduite de sa bourse). */
export function quoteCurrencyOf(symbol: string): string {
  const s = symbol.toUpperCase();
  if (QUOTED_IN_USD.has(s) || s.endsWith('-USD')) return 'USD';
  if (s.endsWith('.SW')) return 'CHF';
  if (/\.(PA|AS|DE|MI|MC|BR)$/.test(s)) return 'EUR';
  if (s.endsWith('.L')) return 'GBP';
  return 'USD';
}

const a = (symbol: string, name: string, what: string, kind: AssetKind, region: AssetRegion, sector: string, tech = false): AssetInfo => ({
  symbol,
  name,
  what,
  kind,
  region,
  sector,
  tech,
  currency: quoteCurrencyOf(symbol),
});

export const ASSETS: AssetInfo[] = [
  // Placements très calmes et fonds (des centaines d'entreprises en un seul achat)
  a('CSBGC3.SW', "Obligations de la Confédération", "Un prêt à l'État suisse, remboursé en moins de 3 ans. Très sûr, rapporte peu.", 'obligations', 'CH', 'obligations'),
  a('CHCORP.SW', "Obligations d'entreprises suisses", 'Des prêts à de grandes entreprises suisses. Sûr, rapporte un peu plus que l’État.', 'obligations', 'CH', 'obligations'),
  a('ZGLD.SW', 'Or', "De l'or gardé en Suisse. Une valeur refuge quand la bourse va mal.", 'or', 'CH', 'or'),
  a('CSSMI.SW', 'Fonds SMI', 'Les 20 plus grandes entreprises suisses en un seul achat.', 'fonds', 'CH', 'fonds'),
  a('CHSPI.SW', 'Fonds SPI', 'Plus de 200 entreprises suisses en un seul achat.', 'fonds', 'CH', 'fonds'),
  a('VWRL.SW', 'Fonds Monde', "Plus de 3 500 entreprises du monde entier en un seul achat.", 'fonds', 'WORLD', 'fonds'),
  a('CSSPX.SW', 'Fonds S&P 500', 'Les 500 plus grandes entreprises américaines en un seul achat.', 'fonds', 'US', 'fonds'),
  a('CSNDX.SW', 'Fonds Nasdaq 100', 'Les 100 plus grandes entreprises technologiques américaines.', 'fonds', 'US', 'fonds', true),
  // Suisse
  a('NESN.SW', 'Nestlé', 'Alimentation : Nespresso, KitKat, Maggi…', 'action', 'CH', 'alimentation'),
  a('NOVN.SW', 'Novartis', 'Médicaments.', 'action', 'CH', 'santé'),
  a('ROP.SW', 'Roche', 'Médicaments et tests médicaux.', 'action', 'CH', 'santé'),
  a('SCMN.SW', 'Swisscom', 'Téléphone, internet et télévision en Suisse.', 'action', 'CH', 'télécoms'),
  a('UBSG.SW', 'UBS', 'La plus grande banque suisse.', 'action', 'CH', 'banque'),
  a('ZURN.SW', 'Zurich Insurance', 'Assurances.', 'action', 'CH', 'assurance'),
  a('SREN.SW', 'Swiss Re', 'Assure les compagnies d’assurance.', 'action', 'CH', 'assurance'),
  a('SLHN.SW', 'Swiss Life', 'Assurance vie et retraite.', 'action', 'CH', 'assurance'),
  a('ABBN.SW', 'ABB', 'Robots, moteurs et électricité pour l’industrie.', 'action', 'CH', 'industrie'),
  a('CFR.SW', 'Richemont', 'Luxe : Cartier, montres de luxe.', 'action', 'CH', 'luxe'),
  a('LOGN.SW', 'Logitech', 'Souris, claviers, webcams.', 'action', 'CH', 'tech', true),
  a('SIKA.SW', 'Sika', 'Produits chimiques pour la construction.', 'action', 'CH', 'construction'),
  a('HOLN.SW', 'Holcim', 'Ciment et matériaux de construction.', 'action', 'CH', 'construction'),
  a('GEBN.SW', 'Geberit', 'Sanitaires : chasses d’eau, tuyaux.', 'action', 'CH', 'construction'),
  a('GIVN.SW', 'Givaudan', 'Arômes et parfums.', 'action', 'CH', 'chimie'),
  a('LONN.SW', 'Lonza', 'Fabrique des médicaments pour d’autres entreprises.', 'action', 'CH', 'santé'),
  a('ALC.SW', 'Alcon', 'Soins des yeux, lentilles.', 'action', 'CH', 'santé'),
  a('SOON.SW', 'Sonova', 'Appareils auditifs.', 'action', 'CH', 'santé'),
  a('KNIN.SW', 'Kuehne + Nagel', 'Transport de marchandises dans le monde.', 'action', 'CH', 'transport'),
  a('PGHN.SW', 'Partners Group', 'Gestion de fortune.', 'action', 'CH', 'finance'),
  // États-Unis
  a('AAPL', 'Apple', 'iPhone, Mac, iPad.', 'action', 'US', 'tech', true),
  a('MSFT', 'Microsoft', 'Windows, Office, Xbox, cloud.', 'action', 'US', 'tech', true),
  a('NVDA', 'Nvidia', 'Puces pour l’intelligence artificielle et les jeux vidéo.', 'action', 'US', 'puces', true),
  a('GOOGL', 'Alphabet (Google)', 'Google, YouTube, Android.', 'action', 'US', 'tech', true),
  a('AMZN', 'Amazon', 'Commerce en ligne et cloud.', 'action', 'US', 'commerce', true),
  a('META', 'Meta', 'Facebook, Instagram, WhatsApp.', 'action', 'US', 'tech', true),
  a('TSLA', 'Tesla', 'Voitures électriques.', 'action', 'US', 'automobile', true),
  a('AMD', 'AMD', 'Processeurs et cartes graphiques.', 'action', 'US', 'puces', true),
  a('NFLX', 'Netflix', 'Films et séries en streaming.', 'action', 'US', 'divertissement', true),
  a('JNJ', 'Johnson & Johnson', 'Médicaments et matériel médical.', 'action', 'US', 'santé'),
  a('PG', 'Procter & Gamble', 'Produits du quotidien : Gillette, Pampers, Ariel.', 'action', 'US', 'consommation'),
  a('KO', 'Coca-Cola', 'Boissons.', 'action', 'US', 'alimentation'),
  a('PEP', 'PepsiCo', 'Boissons et chips.', 'action', 'US', 'alimentation'),
  a('WMT', 'Walmart', 'Supermarchés.', 'action', 'US', 'commerce'),
  a('COST', 'Costco', 'Supermarchés de gros.', 'action', 'US', 'commerce'),
  a('MCD', "McDonald's", 'Restauration rapide.', 'action', 'US', 'restauration'),
  a('JPM', 'JPMorgan Chase', 'La plus grande banque américaine.', 'action', 'US', 'banque'),
  a('V', 'Visa', 'Cartes de paiement.', 'action', 'US', 'paiements'),
  a('XOM', 'ExxonMobil', 'Pétrole et gaz.', 'action', 'US', 'énergie'),
  a('BRK-B', 'Berkshire Hathaway', "La société d'investissement de Warren Buffett.", 'action', 'US', 'finance'),
  // Europe
  a('MC.PA', 'LVMH', 'Luxe : Louis Vuitton, Dior, Moët.', 'action', 'EU', 'luxe'),
  a('OR.PA', "L'Oréal", 'Cosmétiques.', 'action', 'EU', 'consommation'),
  a('SAN.PA', 'Sanofi', 'Médicaments et vaccins.', 'action', 'EU', 'santé'),
  a('TTE.PA', 'TotalEnergies', 'Pétrole, gaz et électricité.', 'action', 'EU', 'énergie'),
  a('ASML.AS', 'ASML', 'Les machines qui fabriquent les puces électroniques.', 'action', 'EU', 'puces', true),
  a('SAP.DE', 'SAP', 'Logiciels pour les entreprises.', 'action', 'EU', 'tech', true),
  a('SIE.DE', 'Siemens', 'Industrie, trains, matériel médical.', 'action', 'EU', 'industrie'),
  a('ALV.DE', 'Allianz', 'Assurances.', 'action', 'EU', 'assurance'),
  // Cryptomonnaies
  a('BTC-USD', 'Bitcoin', 'La première cryptomonnaie. Très agitée.', 'crypto', 'CRYPTO', 'crypto'),
  a('ETH-USD', 'Ethereum', 'La deuxième cryptomonnaie. Très agitée.', 'crypto', 'CRYPTO', 'crypto'),
];

const ASSET_BY_SYMBOL = new Map(ASSETS.map((x) => [x.symbol, x]));

export function assetInfo(symbol: string): AssetInfo | undefined {
  return ASSET_BY_SYMBOL.get(symbol.toUpperCase());
}

const SAFE_KINDS: AssetKind[] = ['obligations', 'or'];

/**
 * Jusqu'à ce niveau de risque, le bot ne choisit que des placements dans la monnaie du compte.
 * Le change ajoute un risque qui ne rapporte rien en moyenne, et il coûte des frais à l'achat et à la vente
 * (environ 1 % chez Yuh) : une personne prudente qui compte en francs n'a pas de raison de le prendre.
 */
export const LOCAL_CURRENCY_MAX_LEVEL = 2;

/**
 * Les placements parmi lesquels le bot choisit, selon la préférence de la personne.
 * Pour un profil prudent, seuls ceux qui sont cotés dans la monnaie du compte (s'il y en a assez).
 */
export function candidatePool(region: string, crypto: boolean, opts: { level?: RiskLevel; currency?: string } = {}): AssetInfo[] {
  if (opts.level !== undefined && opts.currency && opts.level <= LOCAL_CURRENCY_MAX_LEVEL) {
    const local = ASSETS.filter((x) => x.kind !== 'crypto' && x.currency === opts.currency);
    if (local.length >= 6) return local;
  }
  return ASSETS.filter((x) => {
    if (x.kind === 'crypto') return crypto;
    // Les placements très calmes (obligations, or) sont toujours proposés, pour les profils prudents.
    if (SAFE_KINDS.includes(x.kind)) return true;
    if (region === 'ch') return x.region === 'CH';
    if (region === 'tech') return !!x.tech;
    return true; // « monde entier » et « peu importe »
  });
}

// ---------------------------------------------------------------------------
// Le choix des actions
// ---------------------------------------------------------------------------

/** Ce que le serveur a mesuré sur l'année passée pour une action. */
export interface MeasuredAsset {
  symbol: string;
  name: string;
  currency: string;
  price: number;
  /** Volatilité annuelle (en %), mesurée dans la monnaie du compte : de combien le placement varie habituellement sur un an. */
  volatility: number;
  /** Évolution sur un an (en %), dans la monnaie du compte (le change compris). */
  perf1y: number;
}

export interface PickedAsset extends MeasuredAsset {
  band: RiskBand;
  /** Pourquoi le bot l'a choisie, en langage simple. */
  why: string;
  favorite: boolean;
  /** L'action (choisie par la personne) est plus agitée que ce que son profil prévoit. */
  tooRisky: boolean;
}

/** Réponse du serveur : les placements choisis pour le profil, et tout ce qui a été mesuré pour les choisir. */
export interface AssetSuggestion {
  picked: PickedAsset[];
  analysed: number;
  /** Mesures de tous les candidats : gardées avec le bot pour pouvoir expliquer son choix plus tard. */
  measured: MeasuredAsset[];
  /** Date des cours utilisés. */
  time: number;
  errors: string[];
}

/**
 * Simulation honnête d'un profil : le bot se place à une date passée, choisit ses placements avec les seuls cours
 * connus à cette date (l'année d'avant), puis on rejoue ce qui s'est passé ensuite, frais compris.
 */
export interface ProfileSimulation {
  /** Date de départ de la simulation. */
  startTime: number;
  years: number;
  /** Ce que le bot aurait choisi à cette date, avec les mesures de l'époque. */
  picked: PickedAsset[];
  analysed: number;
  result: Omit<BacktestResult, 'charts' | 'overlays'>;
}

const bandIndex = (b: RiskBand) => BANDS.findIndex((x) => x.id === b);
/** Variation typique sur une journée de bourse, plus parlante qu'une volatilité annuelle. */
export const dailyMove = (volatility: number) => volatility / Math.sqrt(252);
/** Rapport gain / risque sur l'année passée (le principe du ratio de Sharpe). */
export const quality = (m: Pick<MeasuredAsset, 'perf1y' | 'volatility'>) => m.perf1y / Math.max(m.volatility, 1);

/** Un candidat d'une case du profil, et ce qui lui est arrivé. */
export interface SlotCandidate extends SelectionMeasure {
  quality: number;
  /**
   * chosen : pris pour cette case · behind : moins bon rapport gain / risque que celui qui a été pris ·
   * taken : déjà pris pour une autre case · sector : déjà deux placements de son secteur.
   */
  status: 'chosen' | 'behind' | 'taken' | 'sector';
}

/** Une « case » du profil (très calme, calme…) et comment le bot l'a remplie. */
export interface SlotTrace {
  band: RiskBand;
  /** Placement pris pour cette case (null : plus aucun candidat). */
  chosen: string | null;
  /** Aucun placement dans cette tranche : le bot a pris le plus proche. */
  nearest: boolean;
  /** Tous les candidats de la tranche, du meilleur rapport gain / risque au moins bon. */
  candidates: SlotCandidate[];
}

export interface SelectionTrace<T> {
  picks: { asset: T; band: RiskBand; why: string; favorite: boolean; tooRisky: boolean }[];
  /** Les entreprises choisies par la personne, prises avant tout le reste. */
  favorites: string[];
  slots: SlotTrace[];
}

type Measure = Pick<MeasuredAsset, 'symbol' | 'name' | 'volatility' | 'perf1y'>;

/**
 * Choisit les placements du bot, en gardant la trace de chaque étape : chaque « case » du profil (très calme, calme,
 * moyen…) reçoit le placement de cette tranche d'agitation qui a eu le meilleur rapport gain / risque l'an passé, sans
 * prendre plus de deux placements du même secteur. Les entreprises choisies par la personne passent en premier.
 */
export function traceSelection<T extends Measure>(level: RiskLevel, measured: T[], favorites: string[] = []): SelectionTrace<T> {
  const profile = PROFILES[level];
  const maxBand = Math.max(...profile.slots.map(bandIndex));
  const bySymbol = new Map(measured.map((m) => [m.symbol, m]));
  const picks: SelectionTrace<T>['picks'] = [];
  const slots: SlotTrace[] = [];
  const sectorCount = new Map<string, number>();
  const sectorOf = (s: string) => assetInfo(s)?.sector ?? s;
  const isTaken = (m: T) => picks.some((p) => p.asset.symbol === m.symbol);
  const sectorFull = (m: T) => (sectorCount.get(sectorOf(m.symbol)) ?? 0) >= 2;
  const take = (m: T, why: string, favorite: boolean) => {
    const band = bandOf(m.volatility);
    picks.push({ asset: m, band, why, favorite, tooRisky: bandIndex(band) > maxBand });
    sectorCount.set(sectorOf(m.symbol), (sectorCount.get(sectorOf(m.symbol)) ?? 0) + 1);
  };

  const favs: string[] = [];
  for (const f of favorites.slice(0, 3)) {
    const m = bySymbol.get(f.toUpperCase());
    if (m && !isTaken(m)) {
      take(m, 'Vous l’avez choisie.', true);
      favs.push(m.symbol);
    }
  }

  for (const slot of profile.slots.slice(0, Math.max(0, profile.slots.length - picks.length))) {
    const free = measured.filter((m) => !isTaken(m) && !sectorFull(m));
    if (free.length === 0) break;
    const inBand = measured.filter((m) => bandOf(m.volatility) === slot).sort((x, y) => quality(y) - quality(x));
    // Ce qui empêche chaque candidat d'être pris, avant de remplir la case.
    const blocked = new Map(inBand.map((m) => [m.symbol, isTaken(m) ? ('taken' as const) : sectorFull(m) ? ('sector' as const) : ('behind' as const)]));
    const label = BANDS[bandIndex(slot)].label.toLowerCase();
    const freeInBand = inBand.filter((m) => blocked.get(m.symbol) === 'behind');
    let chosen: T;
    let nearest = false;
    if (freeInBand.length) {
      chosen = freeInBand[0];
      take(chosen, `Niveau d'agitation ${label}, comme prévu pour votre profil, et meilleur rapport gain / risque de sa catégorie l'an passé.`, false);
    } else {
      // Aucune action libre dans cette tranche : on prend la plus proche.
      const target = slot === 'very_agitated' ? 55 : (BANDS[bandIndex(slot)].max + (bandIndex(slot) > 0 ? BANDS[bandIndex(slot) - 1].max : 0)) / 2;
      chosen = free.reduce((x, y) => (Math.abs(y.volatility - target) < Math.abs(x.volatility - target) ? y : x));
      nearest = true;
      take(chosen, `Le placement le plus proche du niveau d'agitation « ${label} » prévu pour votre profil.`, false);
    }
    const candidates: SlotCandidate[] = inBand.map((m) => ({
      symbol: m.symbol,
      name: m.name,
      volatility: m.volatility,
      perf1y: m.perf1y,
      quality: quality(m),
      status: m.symbol === chosen.symbol ? 'chosen' : (blocked.get(m.symbol) ?? 'behind'),
    }));
    slots.push({ band: slot, chosen: chosen.symbol, nearest, candidates });
  }
  return { picks, favorites: favs, slots };
}

/** Les placements choisis pour un profil (voir traceSelection). */
export function pickAssets(level: RiskLevel, measured: MeasuredAsset[], favorites: string[] = []): PickedAsset[] {
  return traceSelection(level, measured, favorites).picks.map((p) => ({ ...p.asset, band: p.band, why: p.why, favorite: p.favorite, tooRisky: p.tooRisky }));
}

// ---------------------------------------------------------------------------
// Les réglages du bot
// ---------------------------------------------------------------------------

export const BROKER_ANSWERS: { id: BrokerId | 'unknown'; label: string; detail?: string }[] = [
  { id: 'yuh', label: 'Yuh', detail: 'Appli suisse simple, pensée pour débuter' },
  { id: 'swissquote', label: 'Swissquote' },
  { id: 'postfinance', label: 'PostFinance' },
  { id: 'ibkr', label: 'Interactive Brokers' },
  { id: 'unknown', label: 'Je ne sais pas', detail: 'Le bot utilisera les tarifs de Yuh' },
];

/** Les réglages complets du bot, déduits du profil et des placements choisis. */
export function configFromProfile(input: {
  result: Pick<ProfileResult, 'level' | 'maxLossPct'>;
  answers: Answers;
  symbols: string[];
  volatility: Record<string, number>;
  capital: number;
  currency: string;
  broker: string;
  selection?: SelectionSnapshot | null;
}): Omit<BotConfig, 'name'> {
  const profile = PROFILES[input.result.level];
  const n = Math.max(1, input.symbols.length);
  const broker = (['yuh', 'swissquote', 'postfinance', 'ibkr'] as BrokerId[]).includes(input.broker as BrokerId) ? (input.broker as BrokerId) : 'yuh';
  return {
    initialCapital: input.capital,
    symbols: input.symbols,
    strategy: profile.strategy,
    params: { ...profile.params },
    interval: profile.interval,
    positionSizePct: Math.max(1, Math.floor(profile.maxInvestedPct / n)),
    stopLossPct: profile.stopLossPct,
    takeProfitPct: profile.takeProfitPct,
    feePct: 0.1,
    allowFractional: true,
    currency: input.currency,
    broker,
    maxLossPct: input.result.maxLossPct,
    profile: { level: input.result.level, answers: input.answers, volatility: input.volatility, selection: input.selection ?? null },
  };
}
