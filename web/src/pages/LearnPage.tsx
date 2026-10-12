// Explication du fonctionnement du bot (utile pour le dossier écrit et la présentation orale).

import type { ReactNode } from 'react';
import { useAppData } from '../App.tsx';
import { Card } from '../components/ui.tsx';

const STEPS: { title: string; text: string }[] = [
  { title: '1. Données', text: 'Le bot télécharge les cours réels (bougies : ouverture, haut, bas, clôture) depuis Yahoo Finance.' },
  { title: '2. Indicateurs', text: 'Il calcule des indicateurs mathématiques : moyennes mobiles, RSI, MACD, écart-type…' },
  { title: '3. Signal', text: 'La stratégie compare ces indicateurs à des règles et produit un signal : ACHAT, VENTE ou ATTENTE.' },
  { title: '4. Risque', text: 'Taille de la position, liquidités disponibles, stop-loss et take-profit sont vérifiés.' },
  { title: '5. Exécution', text: "L'ordre est simulé au cours actuel, frais de courtage inclus. Aucun argent réel n'est engagé." },
  { title: '6. Suivi', text: 'Chaque trade est enregistré avec sa justification ; la performance est comparée au Buy & Hold.' },
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

      <Card title={`La boucle de décision (répétée toutes les ${config.tickSeconds} secondes)`}>
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
          <Term name="Taille de position">Part du portefeuille investie à chaque achat (ex. 20 %). Elle évite de tout miser sur une seule action.</Term>
          <Term name="Stop-loss">Vente automatique si le cours baisse d'un certain pourcentage sous le prix d'achat : on limite la perte.</Term>
          <Term name="Take-profit">Vente automatique quand le gain atteint l'objectif fixé : on sécurise le bénéfice.</Term>
          <Term name="Frais de courtage">Chaque ordre coûte un pourcentage du montant. Un bot qui trade beaucoup paie beaucoup de frais.</Term>
        </div>
      </Section>

      <Section title="Mesurer la performance">
        <div className="grid gap-3 md:grid-cols-2">
          <Term name="Rendement">(Valeur finale − capital initial) / capital initial.</Term>
          <Term name="Buy & Hold (référence)">
            Ce qu'aurait rapporté l'achat des mêmes actions, à parts égales, au lancement du bot. Un algorithme n'est utile que s'il fait mieux, à risque égal.
          </Term>
          <Term name="Drawdown maximal">La plus forte baisse entre un sommet et le creux suivant : la pire perte qu'un investisseur aurait subie.</Term>
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
