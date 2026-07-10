import { Board } from './board';
import { clamp } from '@app/utils';

export function start(): Board {
  const b = new Board();
  clamp(0, 0, 1);
  return b;
}
