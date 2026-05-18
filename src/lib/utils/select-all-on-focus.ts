/**
 * Handler de onFocus que selecciona todo el texto del input/textarea.
 * Útil para campos donde el usuario quiere reemplazar el valor existente tipeando.
 *
 * @example
 * <Input type="number" onFocus={selectAllOnFocus} />
 * <Textarea onFocus={selectAllOnFocus} />
 */
export function selectAllOnFocus(
  e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>
): void {
  const el = e.currentTarget
  requestAnimationFrame(() => {
    el.select()
  })
}