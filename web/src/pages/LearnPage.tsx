// Explication du fonctionnement du bot (utile pour le dossier écrit et la présentation orale).

import type { ReactNode } from 'react';
import { useAppData } from '../App.tsx';
import { Card } from '../components/ui.tsx';

const STEPS: { title: string; text: string }[] = [
  { title: '1. Il lit les cours', text: 'Le bot télécharge les vrais cours de la bourse depuis Yahoo Finance, résumés en « bougies » (prix d’ouverture, plus haut, plus bas, clôture).' },
  { title: '2. Il calcule', text: 'Il calcule des indicateurs mathématiques à partir de ces prix : moyennes, RSI, MACD, écart-type…' },
  { title: '3. Il décide', text: 'Sa stratégie compare ces indicateurs à des règles précises et donne un signal : ACHETER, VENDRE ou ATTENDRE.' },
  { title: '4. Il vérifie', text: 'Il applique ses règles de prudence : part maximale par achat, liquidités disponibles, stop-loss et objectif.' },
  { title: '5. Il passe l’ordre', text: "L'achat ou la vente est simulé au cours actuel, frais compris. Aucun argent réel n'est engagé." },
  { title: '6. Il explique', text: 'Chaque trade est enregistré avec sa raison, et le résultat est comparé à « acheter et garder ».' },
];

/** Les mots qu'on croise dans l'application, expliqués en une phrase. */
const GLOSSARY: { term: string; text: string }[] = [
  { term: 'Action', text: "Une petite part d'une entreprise (Apple, Nestlé…), qu'on peut acheter et revendre en bourse." },
  { term: 'Cours', text: "Le prix actuel d'une action. Il change à chaque instant pendant que la bourse est ouverte." },
  { term: 'Bougie', text: 'Le résumé des prix sur une durée (5 min, 1 h, 1 jour…) : prix au début, à la fin, le plus haut et le plus bas.' },
  { term: 'Trade (ordre)', text: 'Un achat ou une vente passé par le bot.' },
  { term: 'Liquidités', text: "L'argent du bot qui n'est pas investi en actions." },
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
            La question à laquelle l'application répond : <b className="font-semibold text-ink">un algorithme fait-il mieux qu'un investisseur qui achète des actions et attend ?</b>{' '}
            Pour le savoir, chaque bot est comparé à la stratégie « acheter et garder », et chacune de ses décisions est expliquée en français.
          </p>
        </div>
      </Card>

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
          <Term name="Frais de courtage">Chaque ordre coûte un pourcentage du montant. Un bot qui trade beaucoup paie beaucoup de frais.</Term>
        </div>
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
            Les dividendes ne sont pas comptabilisés, et le backtest ne tient pas compte des actions qui ont disparu de la bourse (biais du survivant).
          </li>
          <li>
            <b>Surapprentissage</b> : en testant beaucoup de paramètres sur le passé, on finit par trouver une combinaison qui « marche »… par hasard.
          </li>
          <li>
            En Suisse, gérer la fortune de clients (y compris via un robo-advisor) nécessite une autorisation de la FINMA (loi sur les établissements
            financiers, LEFin). Cette application est un outil pédagogique et ne constitue pas un conseil en investissement.
          </li>
        </ul>
      </Section>
    </div>
  );
}
