import { useId } from 'react';
import type { TrendVariable, TrendVariableId } from '../../contracts/dashboard';
import styles from './dashboard.module.css';

interface TrendVariablePickerProps {
  variables: TrendVariable[];
  value: TrendVariableId;
  onChange: (id: TrendVariableId) => void;
}

/** Row of radio buttons choosing which variable the trend chart shows */
export function TrendVariablePicker({ variables, value, onChange }: TrendVariablePickerProps) {
  const name = useId();

  return (
    <fieldset className={styles.variablePicker}>
      <legend className={styles.filterLabel}>Variable</legend>
      <div className={styles.variableOptions}>
        {variables.map((v) => (
          <label key={v.id} className={styles.variableOption}>
            <input
              type="radio"
              name={name}
              value={v.id}
              checked={value === v.id}
              onChange={() => onChange(v.id)}
            />
            <span>
              {v.label}
              {v.unit && <span className={styles.variableUnit}> ({v.unit})</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
