// Création d'un nouveau bot.

import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAppData } from '../App.tsx';
import { ConfigForm, DEFAULT_CONFIG, validateConfig, type ConfigValue } from '../components/ConfigForm.tsx';
import { Button, Card, ErrorBox, Field, inputClass } from '../components/ui.tsx';
import { api } from '../lib/api.ts';

export function NewBotPage() {
  const { strategies, config } = useAppData();
  const navigate = useNavigate();
  const location = useLocation();
  // Si on arrive depuis un backtest, on reprend ses paramètres.
  const fromBacktest = (location.state as { config?: ConfigValue } | null)?.config;
  const [value, setValue] = useState<ConfigValue>(fromBacktest ?? DEFAULT_CONFIG);
  const [name, setName] = useState('Mon bot');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = validateConfig(value) ?? (name.trim() ? null : 'Donnez un nom au bot.');
    if (invalid) return setError(invalid);
    setSubmitting(true);
    setError(null);
    try {
      const detail = await api.createBot({ ...value, name: name.trim() });
      navigate(`/bots/${detail.bot.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-4xl space-y-5">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-warn">Mode expert</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Créer un bot à la main</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
          Répondez aux 6 questions ci-dessous. Le bot démarre tout de suite : il suit les vrais cours et achète ou vend avec de l'argent fictif, pendant les heures
          d'ouverture de la bourse.
        </p>
        <p className="mt-1.5 text-sm text-ink-3">
          Vous débutez ? Le <a href="/investir" className="text-accent-text hover:underline">questionnaire</a> règle tout pour vous. Pas sûr de votre stratégie ?{' '}
          <a href="/backtest" className="text-accent-text hover:underline">Testez-la d'abord sur le passé</a>.
        </p>
      </div>

      <Card>
        <Field label="Nom du bot" hint="Pour le reconnaître dans la liste, par exemple « Tech US – RSI ».">
          <input className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
      </Card>

      <ConfigForm
        value={value}
        onChange={setValue}
        strategies={strategies}
        intervals={config.intervals}
        brokers={config.brokers ?? []}
        currencies={config.accountCurrencies ?? ['CHF', 'EUR', 'USD']}
      />

      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
          Annuler
        </Button>
        <Button type="submit" variant="primary" disabled={submitting} className="px-5 py-2">
          {submitting ? 'Création et première analyse…' : 'Lancer le bot'}
        </Button>
      </div>
    </form>
  );
}
