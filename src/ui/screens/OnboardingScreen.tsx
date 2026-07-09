import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';

export function OnboardingScreen() {
  const [acked, setAcked] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 px-6">
      <h1 className="text-3xl font-bold">Apnea Trainer</h1>
      <p className="text-[color:var(--text-dim)]">
        Dry static apnea training to build your breath-hold for spearfishing.
      </p>
      <Card className="border-[color:var(--danger)]">
        <h2 className="mb-2 font-semibold text-[color:var(--danger)]">Safety first</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[color:var(--text-dim)]">
          <li>Train on <strong>dry land only</strong>. Never in or near water alone.</li>
          <li>No hyperventilation — it hides the urge to breathe and raises blackout risk.</li>
          <li>Stop any time you feel unwell. This app is not medical advice.</li>
        </ul>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} aria-label="I understand: dry land only, never in water alone" />
          I understand and will train on dry land only.
        </label>
      </Card>
      <Button disabled={!acked} onClick={() => navigate('/baseline')}>Continue</Button>
    </div>
  );
}
