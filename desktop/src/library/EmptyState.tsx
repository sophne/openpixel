/* Empty states: a small animated pixel-art scene (drawn with OpenPixel by
   desktop/tools/make-empty-states.py, in the accent orange and grays) over the message. The picture is decoration; the
   text says what is going on. */
import type { ReactElement } from 'react';

export function EmptyState({ art, text, small = false, cls = 'empty' }: { art: string; text: string; small?: boolean; cls?: string }): ReactElement {
  return (
    <div className={`${cls} empty-state${small ? ' small' : ''}`} role="status">
      <span className={`pxa pxa-${art}`} aria-hidden="true"></span>
      <p>{text}</p>
    </div>
  );
}
