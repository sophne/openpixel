/* Number steppers: a field between − and +. The buttons step
   by `stepSize` and clamp, ↑ and ↓ do the same from the field, Return leaves the field, and leaving it clamps what
   was typed.
   The markup (style.css and the UI test know it):
     <div class="stepper" data-min data-max [data-step-size] [title]>
       <button type="button" data-step="-1" aria-label="Decrease">−</button><input …><button type="button" data-step="1" aria-label="Increase">+</button>
     </div>
   The field is not controlled: read and write its value through the DOM (or `inputRef`), as the old code did. */
import { useCallback, useRef, type HTMLAttributes, type InputHTMLAttributes, type ReactElement, type Ref } from 'react';
import { useEvent } from '../lib/dom';

export interface StepperProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onChange'> {
  min?: number;
  max?: number;
  /** How much − and + change the value (data-step-size); 1 when left out. */
  stepSize?: number;
  /** The field's own attributes: id, className ("mono"), defaultValue, inputMode, aria-label… Its onKeyDown and
   *  onBlur run after the stepper's own handling. */
  input?: InputHTMLAttributes<HTMLInputElement> & Record<`data-${string}`, string | undefined>;
  inputRef?: Ref<HTMLInputElement>;
  /** The field's real `change` event (what `.onchange` got): after − or +, and when typing is committed. */
  onCommit?: (value: string, input: HTMLInputElement) => void;
}

export function Stepper({ min: minProp, max: maxProp, stepSize, input: inputProps, inputRef, onCommit, className, ...rest }: StepperProps): ReactElement {
  const field = useRef<HTMLInputElement | null>(null);
  const min = minProp || 1, max = maxProp || 9999, size = stepSize || 1;
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  const step = (dir: number) => {
    const input = field.current!;
    input.value = String(clamp((parseInt(input.value, 10) || min) + dir * size));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const setField = useCallback((el: HTMLInputElement | null) => {
    field.current = el;
    if (typeof inputRef === 'function') inputRef(el); else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = el;
  }, [inputRef]);
  useEvent<Event>(field, 'change', () => { if (onCommit && field.current) onCommit(field.current.value, field.current); });
  return (
    <div {...rest} className={className ? `stepper ${className}` : 'stepper'} data-min={minProp} data-max={maxProp} data-step-size={stepSize}>
      <button type="button" data-step="-1" aria-label="Decrease" onClick={() => step(-1)}>−</button>
      <input {...inputProps}
        ref={setField}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            e.currentTarget.parentElement!.querySelector<HTMLButtonElement>(`button[data-step="${e.key === 'ArrowUp' ? 1 : -1}"]`)!.click();
          }
          if (e.key === 'Enter') e.currentTarget.blur();
          if (inputProps && inputProps.onKeyDown) inputProps.onKeyDown(e);
        }}
        onBlur={(e) => {
          const v = parseInt(e.currentTarget.value, 10);
          e.currentTarget.value = String(clamp(isNaN(v) ? min : v));
          if (inputProps && inputProps.onBlur) inputProps.onBlur(e);
        }} />
      <button type="button" data-step="1" aria-label="Increase" onClick={() => step(1)}>+</button>
    </div>
  );
}
