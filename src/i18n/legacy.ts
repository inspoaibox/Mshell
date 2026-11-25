import i18n from './index'
import translations from './template-translations.json'

const reverseTranslations = Object.fromEntries(
  Object.entries(translations).map(([zh, en]) => [en, zh])
)
const translationEntries = Object.entries(translations)
  .filter(([zh]) => zh.length >= 2)
  .sort(([a], [b]) => b.length - a.length)
const reverseEntries = Object.entries(reverseTranslations).sort(([a], [b]) => b.length - a.length)

export function translateLegacy(value: string): string {
  // `legacy: false` exposes the global locale as a WritableComputedRef.
  // Reading the ref object itself makes every locale comparison fail and
  // prevents legacy template text from following the selected language.
  const locale = i18n.global.locale.value
  if (locale === 'zh-CN') {
    if (reverseTranslations[value]) return reverseTranslations[value]
    const entry = reverseEntries.find(([en]) => value.startsWith(en))
    return entry ? `${entry[1]}${value.slice(entry[0].length)}` : value
  }
  if (translations[value as keyof typeof translations]) {
    return translations[value as keyof typeof translations]
  }
  const entry = translationEntries.find(([zh]) => value.startsWith(zh))
  return entry ? `${entry[1]}${value.slice(entry[0].length)}` : value
}
