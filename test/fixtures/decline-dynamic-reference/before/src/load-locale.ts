export type Messages = Record<string, string>;

export async function loadLocale(lang: string): Promise<Messages> {
  const locale: { messages: Messages } = await import(`./locales/${lang}.js`);
  return locale.messages;
}
