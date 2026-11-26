import type { Draft } from './draft';

export type StepProps = {
  values: Draft;
  onChange: (patch: Partial<Draft>) => void;
  /** clés i18n par champ */
  errors: Record<string, string>;
};
