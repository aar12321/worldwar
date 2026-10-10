/** Player-facing wording for engine messages that still use internal resource names. */
export function speak(text: string): string {
  return text
    .replaceAll('Political Points', 'influence')
    .replaceAll('Tech Points', 'research')
    .replaceAll('military manpower', 'soldiers')
    .replaceAll('Capital', 'money')
}
