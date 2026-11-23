/** iOS WebKit can deliver the IME's final Enter with isComposing already false. */
export function confirmsInput(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && !event.isComposing && event.keyCode !== 229;
}
