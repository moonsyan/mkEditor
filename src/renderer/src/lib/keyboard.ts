export const isImeComposing = (event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean =>
  event.isComposing || event.keyCode === 229
