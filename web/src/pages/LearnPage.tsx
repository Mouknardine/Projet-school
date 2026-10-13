// Explication du fonctionnement du bot (utile pour le dossier écrit et la présentation orale).

import type { ReactNode } from 'react';
import { useAppData } from '../App.tsx';
import { Link } from 'react-router';
import { BANDS, PROFILES } from '../../../shared/profile.ts';
import type { RiskLevel } from '../../../shared/types.ts';
import { LEVEL_COLORS } from '../components/profile.tsx';
import { Card } from '../components/ui.tsx';
import { nbsp } from '../lib/format.ts';

const STEPS: { title: string; text: string }[] = [
  { title: '1. Il lit les cours', text: 'Le bot télécharge les vrais cours de la bourse depuis Yahoo Finance, résumés en « bougies » (prix d’ouverture, plus haut, plus bas, clôture).' },
  { title: '2. Il calcule', text: 'Il calcule des indicateurs mathématiques à partir de ces prix : moyennes, RSI, MACD, écart-type…' },
  { title: '3. Il décide', text: 'Sa stratégie compare ces indicateurs à des règles précises et donne un signal : ACHETER, VENDRE ou ATTENDRE.' },
  { title: '4. Il vérifie', text: 'Il applique ses règles de prudence : part maximale par achat, liquidités disponibles, stop-loss et objectif.' },
  { title: '5. Il passe l’ordre', text: "L'achat ou la vente est simulé au cours actuel, avec les vrais frais de la banque choisie (courtage, change, taxes). Aucun argent réel n'est engagé." },
  { title: '6. Il explique', text: 'Chaque trade est enregistré avec sa raison, et le résultat est comparé à « acheter et garder ».' },
];

/** Les mots qu'on croise dans l'application, expliqués en une phrase. */
const GLOSSARY: { term: string; text: string }[] = [
  { term: 'Action', text: "Une petite part d'une entreprise (Apple, Nestlé…), qu'on peut acheter et revendre en bourse." },
  { term: 'Cours', text: "Le prix actuel d'une action. Il change à chaque instant pendant que la bourse est ouverte." },
  { term: 'Bougie', text: 'Le résumé des prix sur une durée (5 min, 1 h, 1 jour…) : prix au début, à la fin, le plus haut et le plus bas.' },
  { term: 'Trade (ordre)', text: 'Un achat ou une vente passé par le bot.' },
  { term: 'Liquidités', text: "L'argent du bot qui n'est pas investi en actions." },
  { term: 'Profil de risque', text: 'Le niveau de risque qui vous convient, de « Très prudent » à « Audacieux », calculé à partir du questionnaire.' },
  { term: 'Volatilité (agitation)', text: "De combien le prix d'une action bouge habituellement. Plus elle est agitée, plus elle peut monter… ou baisser." },
  { term: 'Diversification', text: "Répartir son argent sur plusieurs placements, pour que la chute de l'un ne fasse pas tout perdre." },
  { term: 'Obligation', text: "Un prêt à un État ou à une entreprise, remboursé avec des intérêts. Plus sûr qu'une action, mais rapporte moins." },
  { term: 'Fonds (ETF)', text: "Un panier de dizaines ou de centaines d'actions qu'on achète en une seule fois." },
  { term: 'Limite de perte', text: 'La baisse maximale que vous acceptez : si le placement baisse autant, le bot vend tout pour protéger le reste.' },
  { term: 'Courtage', text: 'Ce que la banque facture pour exécuter un achat ou une vente.' },
  { term: 'Taux de change', text: 'Le prix d’une monnaie dans une autre : par exemple, combien de francs vaut 1 dollar.' },
  { term: 'Droit de timbre', text: 'Un impôt suisse prélevé sur chaque achat et chaque vente de titres passés par une banque suisse.' },
  { term: 'Stop-loss', text: 'Vente automatique quand une action a trop baissé, pour limiter la perte.' },
  { term: 'Objectif (take-profit)', text: 'Vente automatique quand une action a assez monté, pour encaisser le gain.' },
  { term: 'Acheter et garder (Buy & Hold)', text: 'Acheter les actions au départ et ne plus y toucher. Sert de point de comparaison pour les bots.' },
  { term: 'Pire chute (drawdown)', text: 'La plus forte baisse de valeur depuis un sommet : elle mesure le risque.' },
  { term: 'Backtest', text: "Tester une stratégie sur les cours du passé pour voir ce qu'elle aurait donné." },
  { term: 'Paper trading', text: 'Trader avec de l’argent fictif sur les vrais cours, comme dans cette application.' },
  { term: 'Indicateur', text: "Un calcul fait à partir des prix (moyenne, RSI, MACD…) qui aide la stratégie à décider." },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <div className="space-y-3 text-sm leading-relaxed text-ink-2">{children}</div>
    </Card>
  );
}

function Term({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-page/60 px-3 py-2.5">
      <div className="font-semibold text-ink">{name}</div>
      <div className="mt-0.5 text-ink-3">{children}</div>
    </div>
  );
}

export function LearnPage() {
  const { strategies, config } = useAppData();
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Comment fonctionne le bot ?</h1>
        <p className="mt-1 text-sm text-ink-3">
          Un algorithme de trading est une suite de règles précises qui transforme des données de marché en décisions d'achat ou de vente, sans
          intervention humaine.
        </p>
      </div>

      <Card title="À quoi sert cette application ?">
        <div className="space-y-3 text-[15px] leading-relaxed text-ink-2">
          <p>
            TradeBot fait tourner des <b className="font-semibold text-ink">robots de trading</b> : des programmes qui achètent et vendent des actions tout seuls, en
            suivant des règles mathématiques. Ils utilisent les <b className="font-semibold text-ink">vrais cours de la bourse</b>, mais de l'
            <b className="font-semibold text-ink">argent fictif</b> : personne ne peut rien perdre.
          </p>
          <p>
            La question à laquelle l'application répond : <b className="font-semibold text-ink">peut-on investir avec un robot, sans prendre soi-même aucune décision ?</b>{' '}
            La personne répond seulement à un questionnaire. Le bot fait tout le reste : il choisit les actions, décide quand acheter et vendre, et protège
            l'argent. Pour juger s'il fait du bon travail, chaque bot est comparé à la stratégie « acheter et garder », et chacune de ses décisions est
            expliquée en français.
          </p>
        </div>
      </Card>

      <Section title="Du questionnaire au bot">
        <p>
          Le questionnaire s'inspire de ceux des banques suisses, qui doivent vérifier qu'un placement convient à leur client (loi sur les services financiers,
          LSFin). Il mesure trois choses :
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <Term name="1. La capacité de risque">
            Ce que votre situation vous permet de perdre : dans combien de temps vous aurez besoin de l'argent, quelle part de vos économies il représente, si
            vous avez une réserve en cas d'imprévu.
          </Term>
          <Term name="2. La tolérance au risque">Ce que vous êtes prêt à supporter : votre objectif, votre réaction face à une baisse, la perte maximale acceptée.</Term>
          <Term name="3. Les connaissances">Votre expérience et deux petites questions. Un débutant ne reçoit pas un profil plus risqué que « Équilibré ».</Term>
        </div>
        <p>
          <b className="font-semibold text-ink">Le profil retenu est le plus prudent des trois</b> : c'est le maillon le plus faible qui décide. Quelqu'un
          d'audacieux qui aura besoin de son argent dans six mois reçoit donc un profil très prudent.
        </p>
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-ink-3">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">Profil</th>
                <th className="py-2 pr-3 font-medium">Ce que le bot achète</th>
                <th className="py-2 pr-3 font-medium">Comment il décide</th>
                <th className="py-2 pr-3 font-medium">Réserve</th>
                <th className="py-2 font-medium">Limite de perte</th>
              </tr>
            </thead>
            <tbody>
              {([1, 2, 3, 4, 5] as RiskLevel[]).map((l) => {
                const p = PROFILES[l];
                const kinds = [...new Set(p.slots)].map((b) => BANDS.find((x) => x.id === b)?.label.toLowerCase()).join(', ');
                return (
                  <tr key={l} className="border-b border-line align-top last:border-0">
                    <td className="py-2.5 pr-3 font-semibold whitespace-nowrap" style={{ color: LEVEL_COLORS[l] }}>
                      {l}. {p.name}
                    </td>
                    <td className="py-2.5 pr-3 text-ink-3">
                      {p.slots.length} placements : {kinds}
                    </td>
                    <td className="py-2.5 pr-3 text-ink-3">
                      {p.strategy === 'buy_hold' ? 'Achète, garde et protège' : (strategies.find((s) => s.id === p.strategy)?.name ?? p.strategy)}
                    </td>
                    <td className="py-2.5 pr-3 text-ink-3">{100 - p.maxInvestedPct}&nbsp;%</td>
                    <td className="py-2.5 text-ink-3">−{p.maxLossPct}&nbsp;%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p>
          <b className="font-semibold text-ink">Le choix des actions.</b> Le bot télécharge un an de cours pour une soixantaine de placements (actions suisses,
          américaines et européennes, fonds, obligations, or, cryptos si vous les acceptez) et mesure leur <b className="font-semibold text-ink">volatilité</b> :
          l'écart-type des variations quotidiennes, ramené sur un an (σ × √252). Il classe chaque placement par agitation (
          {BANDS.map((b) => b.label.toLowerCase()).join(', ')}), puis remplit chaque « case » du profil avec le placement qui a eu le meilleur rapport
          gain / risque l'an passé, sans prendre plus de deux placements du même secteur (diversification).
        </p>
        <p>
          <b className="font-semibold text-ink">La limite de perte.</b> À chaque analyse, le bot compare la valeur du placement à la baisse maximale acceptée. Si
          elle est atteinte, il vend tout et se met en pause : c'est la traduction directe de votre réponse « à partir de quelle baisse ne dormiriez-vous plus
          tranquille ? ».
        </p>
      </Section>

      <Section title="Ce que nos tests ont montré : acheter et garder, ou acheter et vendre souvent ?">
        <p>
          Avant de choisir comment le bot gère un placement, nous avons rejoué deux façons de faire sur les vrais cours, avec les vrais frais de Yuh et un
          compte en francs. Les placements testés sont ceux que le bot choisit pour chaque profil. Les deux façons de faire sont comparées sur la même période,
          de mars 2022 à octobre 2026 (avec la forte baisse de 2022).
        </p>
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="num w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs text-ink-3">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">Profil</th>
                <th className="py-2 pr-3 font-medium">Acheter et garder</th>
                <th className="py-2 pr-3 font-medium">Suivre la tendance (achète et vend)</th>
                <th className="py-2 font-medium">Frais payés par la tendance</th>
              </tr>
            </thead>
            <tbody className="text-ink-2">
              {[
                ['Équilibré', '+61 %', '+19 %', '845 CHF (44 opérations)'],
                ['Dynamique', '+220 %', '+155 %', '1 861 CHF (50 opérations)'],
                ['Audacieux', '+159 %', '+79 %', '1 815 CHF (61 opérations)'],
              ].map(([name, hold, trend, fees]) => (
                <tr key={name} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 font-semibold text-ink">{name}</td>
                  <td className="py-2 pr-3 text-up">{nbsp(hold)}</td>
                  <td className="py-2 pr-3">{nbsp(trend)}</td>
                  <td className="py-2">{nbsp(fees)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Pour 10 000 CHF placés, avec une moyenne sur 100 jours et une marge de 10 %, le meilleur réglage testé. Les autres réglages (moyenne sur 50 ou 200 jours,
          marge de 4 ou 5 %) n'ont pas fait mieux face à « acheter et garder ». Et la tendance n'a pas protégé des baisses : pour le profil prudent, la pire
          baisse a même été plus forte (−21 % au lieu de −13 %).
        </p>
        <p>
          <b className="font-semibold text-ink">Conclusion :</b> pour un petit investisseur, chaque achat ou vente d'une action étrangère coûte environ 1,6 % chez Yuh
          (courtage, change, droit de timbre). Un bot qui achète et vend souvent perd ce que les allers-retours devraient lui faire gagner. Pour quelqu'un qui veut juste placer son
          argent, le bot ajoute donc de la valeur en <b className="font-semibold text-ink">choisissant</b> des placements adaptés au profil, en{' '}
          <b className="font-semibold text-ink">répartissant</b> l'argent et en <b className="font-semibold text-ink">protégeant</b> le placement, plutôt qu'en
          essayant de deviner le bon moment. Les stratégies actives restent disponibles dans le mode expert, pour faire vos propres tests.
        </p>
        <p className="text-xs text-ink-3">Tests faits le 13 octobre 2026 avec le backtest de l'application. Les résultats passés ne garantissent rien pour l'avenir.</p>
      </Section>

      <Card title="Les mots à connaître">
        <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {GLOSSARY.map((g) => (
            <div key={g.term} className="rounded-lg bg-page/60 px-3 py-2.5">
              <dt className="font-semibold text-ink">{g.term}</dt>
              <dd className="mt-0.5 leading-snug text-ink-3">{g.text}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title={`Ce que fait le bot, toutes les ${config.tickSeconds} secondes`}>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-lg border border-line bg-page/60 p-3">
              <div className="text-sm font-semibold text-up">{s.title}</div>
              <p className="mt-1 text-sm text-ink-3">{s.text}</p>
              {i < STEPS.length - 1 && <span className="absolute -right-2.5 top-1/2 hidden -translate-y-1/2 text-ink-3 lg:block">→</span>}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-ink-3">
          Le bot ne décide qu'une fois par bougie <b>clôturée</b> : une bougie en cours peut encore changer, et un signal calculé dessus pourrait disparaître.
          Les ordres ne sont passés que pendant les heures d'ouverture de la bourse ; le reste du temps, le bot continue de suivre la valeur du portefeuille.
        </p>
      </Card>

      <Section title="Les stratégies disponibles">
        <div className="grid gap-3 md:grid-cols-2">
          {strategies.map((s) => (
            <div key={s.id} className="rounded-lg border border-line bg-page/60 p-3">
              <div className="font-semibold text-ink">{s.name}</div>
              <p className="mt-1 text-ink-3">{s.description}</p>
              <p className="mt-2 text-up">Achat : {s.rules.buy}</p>
              <p className="text-down">Vente : {s.rules.sell}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Les indicateurs en formules">
        <div className="grid gap-3 md:grid-cols-2">
          <Term name="Moyenne mobile simple (MM)">
            MM<sub>n</sub> = (P<sub>t</sub> + P<sub>t−1</sub> + … + P<sub>t−n+1</sub>) / n — la moyenne des n derniers prix de clôture.
          </Term>
          <Term name="Moyenne mobile exponentielle (EMA)">
            EMA<sub>t</sub> = α·P<sub>t</sub> + (1 − α)·EMA<sub>t−1</sub>, avec α = 2 / (n + 1) : les prix récents pèsent davantage.
          </Term>
          <Term name="RSI (Relative Strength Index)">
            RSI = 100 − 100 / (1 + RS), où RS = moyenne des hausses / moyenne des baisses sur n périodes. Il varie entre 0 et 100.
          </Term>
          <Term name="MACD">MACD = EMA<sub>12</sub> − EMA<sub>26</sub> ; ligne de signal = EMA<sub>9</sub> du MACD.</Term>
          <Term name="Bandes de Bollinger">
            Moyenne ± k·σ, où σ est l'écart-type des n derniers prix. Si les variations suivaient une loi normale, environ 95 % des prix resteraient entre les
            bandes pour k = 2.
          </Term>
          <Term name="Score multi-indicateurs">
            Somme de trois « votes » (+1 / 0 / −1) : un modèle de décision simple qui combine plusieurs sources d'information.
          </Term>
        </div>
      </Section>

      <Section title="Gestion du risque">
        <div className="grid gap-3 md:grid-cols-2">
          <Term name="Part investie par achat (taille de position)">Part du portefeuille investie à chaque achat (ex. 20 %). Elle évite de tout miser sur une seule action.</Term>
          <Term name="Stop-loss">Vente automatique si le cours baisse d'un certain pourcentage sous le prix d'achat : on limite la perte.</Term>
          <Term name="Objectif (take-profit)">Vente automatique quand le gain atteint l'objectif fixé : on sécurise le bénéfice.</Term>
          <Term name="Les frais">Chaque ordre coûte de l'argent (voir ci-dessous). Un bot qui trade beaucoup paie beaucoup de frais.</Term>
        </div>
      </Section>

      <Section title="Ce que coûte vraiment un achat ou une vente">
        <p>
          Comme dans la réalité, un ordre de bourse coûte plus que le prix des actions. Le bot paie les frais de la banque choisie à sa création, calculés
          ordre par ordre :
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Term name="1. Le courtage (la banque)">
            Ce que la banque facture pour passer l'ordre : un montant fixe par palier (Swissquote, PostFinance), un pourcentage (Yuh) ou quelques centimes
            par action (Interactive Brokers).
          </Term>
          <Term name="2. Le change (la conversion de monnaie)">
            Pour acheter une action américaine avec des francs, la banque convertit les francs en dollars au taux du moment, et prend une marge (0,95 % chez
            Yuh et Swissquote). Le bot utilise le vrai taux de change de Yahoo Finance, et la valeur de ses actions bouge aussi quand le dollar ou l'euro
            monte ou baisse.
          </Term>
          <Term name="3. Le droit de timbre suisse (l'impôt fédéral)">
            0,075 % pour une action suisse, 0,15 % pour une action étrangère, à l'achat comme à la vente. Il est prélevé par les banques suisses, pas par
            les courtiers étrangers comme Interactive Brokers. Les cryptomonnaies n'y sont pas soumises.
          </Term>
          <Term name="4. Les taxes étrangères">
            France : 0,4 % sur l'achat d'actions de grandes sociétés françaises (taxe sur les transactions financières). Royaume-Uni : 0,5 % sur les achats.
            États-Unis : une petite taxe de la SEC sur les ventes (20,60 dollars par million).
          </Term>
        </div>
        <div className="rounded-lg border border-line bg-page/60 p-3">
          <div className="font-semibold text-ink">Exemple : acheter pour 2 000 CHF d'actions Apple chez Yuh</div>
          <ul className="num mt-2 space-y-1 text-ink-3">
            {[
              ['Courtage : 0,5 %', '10.00 CHF'],
              ['Change CHF → USD : 0,95 %', '19.00 CHF'],
              ['Droit de timbre (action étrangère) : 0,15 %', '3.00 CHF'],
            ].map(([label, amount]) => (
              <li key={label} className="flex justify-between gap-3">
                <span>{nbsp(label)}</span>
                <span className="shrink-0">{nbsp(amount)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 border-t border-line pt-1 font-semibold text-ink">
              <span>Frais à l'achat</span>
              <span className="shrink-0">{nbsp('32.00 CHF (1,6 %)')}</span>
            </li>
          </ul>
          <p className="mt-2 text-ink-3">
            À la revente, à peu près autant. L'action doit donc monter d'environ 3 % avant que le bot gagne quoi que ce soit. C'est pour ça qu'un bot qui
            achète et vend très souvent a du mal à battre « acheter et garder ».
          </p>
        </div>
        {config.brokers?.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {config.brokers
              .filter((b) => b.id !== 'simple')
              .map((b) => (
                <div key={b.id} className="rounded-lg border border-line bg-page/60 p-3">
                  <div className="font-semibold text-ink">{b.name}</div>
                  <div className="text-xs text-ink-3">{b.kind}</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-3">
                    {b.fees.map((f) => (
                      <li key={f}>{nbsp(f)}</li>
                    ))}
                  </ul>
                  {b.source && (
                    <a href={b.source} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-accent-text hover:underline">
                      Source : tarifs officiels
                    </a>
                  )}
                </div>
              ))}
          </div>
        )}
        <p className="text-xs text-ink-3">Tarifs relevés sur les sites officiels des banques et des administrations fiscales le 12 octobre 2026.</p>
      </Section>

      <Section title="Mesurer la performance">
        <div className="grid gap-3 md:grid-cols-2">
          <Term name="Rendement">(Valeur finale − capital initial) / capital initial.</Term>
          <Term name="Acheter et garder (Buy & Hold)">
            Ce qu'aurait rapporté l'achat des mêmes actions, à parts égales, au lancement du bot. Un algorithme n'est utile que s'il fait mieux, à risque égal.
          </Term>
          <Term name="Pire chute (drawdown maximal)">La plus forte baisse entre un sommet et le creux suivant : la pire perte qu'un investisseur aurait subie.</Term>
          <Term name="Ratio de Sharpe">
            Rendement moyen / écart-type des rendements, annualisé (×√nombre de périodes par an). Au-dessus de 1, le rendement compense bien le risque.
          </Term>
          <Term name="Taux de réussite">Part des ventes réalisées avec un gain.</Term>
          <Term name="Profit factor">Somme des gains / somme des pertes. Au-dessus de 1, la stratégie gagne plus qu'elle ne perd.</Term>
        </div>
      </Section>

      <Section title="Limites de la simulation">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <b>Paper trading</b> : les ordres sont fictifs. En réalité, un gros ordre peut faire bouger le prix et être exécuté à un cours moins favorable
            (« slippage »).
          </li>
          <li>Les cours de Yahoo Finance peuvent être différés d'environ 15 minutes selon la bourse.</li>
          <li>
            Le bot achète au dernier cours, sans l'écart entre prix d'achat et prix de vente (« spread ») que les bourses appliquent, en général quelques
            centimes par action.
          </li>
          <li>
            Frais simplifiés sur quelques points : la taxe française est appliquée à toutes les actions de Paris (sauf quelques sociétés étrangères comme
            Airbus ou Stellantis), alors qu'elle ne vise que les sociétés françaises de plus d'un milliard d'euros ; le taux de change de PostFinance est une
            estimation ; les droits de garde annuels ne sont pas comptés.
          </li>
          <li>
            Les dividendes ne sont pas comptabilisés, et le backtest ne tient pas compte des actions qui ont disparu de la bourse (biais du survivant).
          </li>
          <li>
            <b>Surapprentissage</b> : en testant beaucoup de paramètres sur le passé, on finit par trouver une combinaison qui « marche »… par hasard.
          </li>
          <li>
            Le questionnaire est simplifié par rapport à celui d'une vraie banque, et le passé (volatilité, rendement d'une action) ne prédit pas l'avenir : le
            choix des actions reste une estimation.
          </li>
          <li>
            En Suisse, gérer la fortune de clients (y compris via un robo-advisor) nécessite une autorisation de la FINMA (loi sur les établissements
            financiers, LEFin). Cette application est un outil pédagogique et ne constitue pas un conseil en investissement.
          </li>
        </ul>
      </Section>

      <Card title="Mode expert">
        <p className="text-sm leading-relaxed text-ink-2">
          Pour aller plus loin (et pour le dossier du TIP) : régler soi-même un bot sans passer par le questionnaire, ou tester une stratégie sur plusieurs
          années de cours passés pour comparer les approches.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/bots/new" className="inline-flex h-9 items-center rounded-lg border border-line bg-raised px-3.5 text-sm font-medium text-ink hover:bg-line">
            Créer un bot à la main
          </Link>
          <Link to="/backtest" className="inline-flex h-9 items-center rounded-lg border border-line bg-raised px-3.5 text-sm font-medium text-ink hover:bg-line">
            Tester une stratégie sur le passé
          </Link>
        </div>
      </Card>
    </div>
  );
}
