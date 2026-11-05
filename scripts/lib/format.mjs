// Number and date formatting shared by the CLI and the HTML renderer.
// The compact-count behaviour intentionally matches X's UI: 1.2K / 3.4M / 5.6B
// in English and 1.2万 / 3.4亿 in Chinese.

const COMPACT_SUFFIX = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
  w: 10_000,
};

export function isZhLocale(locale = "en") {
  return String(locale).toLowerCase().startsWith("zh");
}

function trimNumber(value) {
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatCompact(value, locale = "en") {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  const n = Math.round(value);
  if (isZhLocale(locale)) {
    if (n < 10_000) return String(n);
    if (n < 100_000_000) return `${trimNumber(n / 10_000)}万`;
    return `${trimNumber(n / 100_000_000)}亿`;
  }
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${trimNumber(n / 1_000)}K`;
  if (n < 1_000_000_000) return `${trimNumber(n / 1_000_000)}M`;
  return `${trimNumber(n / 1_000_000_000)}B`;
}

export function formatFull(value, locale = "en") {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  try {
    return new Intl.NumberFormat(locale).format(Math.round(value));
  } catch {
    return new Intl.NumberFormat("en").format(Math.round(value));
  }
}

/**
 * Parse human count input such as "1234", "1,234", "1.2K", "3万", "2亿".
 * Returns null when the input contains no number.
 */
export function parseCount(input) {
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.max(0, Math.round(input)) : null;
  }
  const raw = String(input ?? "").trim();
  if (!raw) return 0;

  const source = raw.replace(/,/g, "");

  const yi = source.match(/([\d]+(?:\.[\d]+)?)\s*亿/i);
  if (yi) return Math.round(Number(yi[1]) * 100_000_000);
  const wan = source.match(/([\d]+(?:\.[\d]+)?)\s*万/i);
  if (wan) return Math.round(Number(wan[1]) * 10_000);

  const compact = source.match(/([\d]+(?:\.[\d]+)?)\s*([kmbw])\b/i);
  if (compact) {
    const suffix = compact[2].toLowerCase();
    return Math.round(Number(compact[1]) * (COMPACT_SUFFIX[suffix] ?? 1));
  }

  const grouped = raw.match(/(\d{1,3}(?:,\d{3})+)/);
  if (grouped) return Number(grouped[1].replace(/,/g, ""));

  const plain = source.match(/(\d+(?:\.\d+)?)/);
  if (!plain) return null;
  return Math.round(Number(plain[1]));
}

export function formatDate(date, locale = "en", timeZone) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  const options = timeZone ? { timeZone } : {};
  try {
    const time = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      ...options,
    }).format(value);
    const day = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      ...options,
    }).format(value);
    return `${time} · ${day}`;
  } catch {
    const time = new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "2-digit",
    }).format(value);
    const day = new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(value);
    return `${time} · ${day}`;
  }
}

export function localeForLanguage(language) {
  const lang = String(language || "en").toLowerCase();
  if (lang.startsWith("zh")) {
    return lang.includes("tw") || lang.includes("hk") || lang.includes("hant") ? "zh-TW" : "zh-CN";
  }
  if (lang.startsWith("ja")) return "ja-JP";
  if (lang.startsWith("ko")) return "ko-KR";
  if (lang.startsWith("fr")) return "fr-FR";
  if (lang.startsWith("de")) return "de-DE";
  if (lang.startsWith("es")) return "es-ES";
  if (lang.startsWith("pt")) return "pt-PT";
  return "en";
}

const LANGUAGE_NAMES = {
  en: ["English", "英语"],
  zh: ["Chinese", "中文"],
  "zh-cn": ["Chinese (Simplified)", "简体中文"],
  "zh-tw": ["Chinese (Traditional)", "繁體中文"],
  ja: ["Japanese", "日语"],
  ko: ["Korean", "韩语"],
  fr: ["French", "法语"],
  de: ["German", "德语"],
  es: ["Spanish", "西班牙语"],
  pt: ["Portuguese", "葡萄牙语"],
  it: ["Italian", "意大利语"],
  ru: ["Russian", "俄语"],
  ar: ["Arabic", "阿拉伯语"],
  hi: ["Hindi", "印地语"],
  th: ["Thai", "泰语"],
  vi: ["Vietnamese", "越南语"],
  id: ["Indonesian", "印度尼西亚语"],
  tr: ["Turkish", "土耳其语"],
  nl: ["Dutch", "荷兰语"],
  sv: ["Swedish", "瑞典语"],
  pl: ["Polish", "波兰语"],
};

export function languageName(code, locale = "en") {
  const key = String(code || "").toLowerCase();
  const entry = LANGUAGE_NAMES[key] || LANGUAGE_NAMES[key.split("-")[0]];
  if (!entry) return code || "unknown";
  return isZhLocale(locale) ? entry[1] : entry[0];
}
