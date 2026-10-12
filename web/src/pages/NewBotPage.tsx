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
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Nouveau bot</h1>
        <p className="mt-1 text-sm text-ink-3">
          Le bot démarre immédiatement. Il suit les cours réels et passe des ordres fictifs pendant les heures d'ouverture de la bourse.
        </p>
      </div>

      <Card>
        <Field label="Nom du bot">
          <input className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
      </Card>

      <ConfigForm value={value} onChange={setValue} strategies={strategies} intervals={config.intervals} />

      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex justify-end gap-3">
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
