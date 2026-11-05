import { formatCompact, formatDate, formatFull, isZhLocale, languageName, localeForLanguage } from "./format.mjs";

const THEMES = {
  light: {
    bg: "#ffffff",
    text: "#0f1419",
    muted: "#536471",
    border: "#cfd9de",
    mediaBorder: "#cfd9de",
    accent: "#1d9bf0",
    quoteBg: "#ffffff",
  },
  dim: {
    bg: "#15202b",
    text: "#f7f9f9",
    muted: "#8b98a5",
    border: "#38444d",
    mediaBorder: "#38444d",
    accent: "#1d9bf0",
    quoteBg: "#15202b",
  },
  dark: {
    bg: "#000000",
    text: "#e7e9ea",
    muted: "#71767b",
    border: "#2f3336",
    mediaBorder: "#2f3336",
    accent: "#1d9bf0",
    quoteBg: "#000000",
  },
};

const FONT_STACK =
  '"X Chirp", "Chirp", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", Roboto, Helvetica, Arial, sans-serif';

const ICONS = {
  reply:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z"/></svg>',
  repost:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"/></svg>',
  like:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z"/></svg>',
  bookmark:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z"/></svg>',
  share:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z"/></svg>',
  play:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12c0 1.2-1 2-2 2.5l-11 6c-1.4.7-3-.3-3-1.9V5.4c0-1.6 1.6-2.6 3-1.9l11 6c1 .5 2 1.3 2 2.5z"/></svg>',
  more:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
};

const VERIFIED_BADGE =
  '<svg class="badge" viewBox="0 0 22 22" aria-label="Verified account" role="img">' +
  '<path fill="#1d9bf0" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567.54-.354.972-.852 1.245-1.44.607.22 1.264.27 1.897.139.634-.13 1.218-.433 1.687-.878.445-.47.75-1.055.882-1.688.13-.633.082-1.29-.14-1.897.587-.274 1.085-.705 1.44-1.245.355-.541.553-1.17.57-1.817z"/>' +
  '<path fill="#fff" d="M9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></svg>';

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(value) {
  if (typeof value !== "string") return "";
  if (/^https?:\/\//i.test(value)) return escapeHtml(value);
  if (/^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=]+$/i.test(value)) {
    return escapeHtml(value);
  }
  return "";
}

function cssColor(value, fallback) {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  if (/^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]{3,24})$/i.test(text)) {
    return text;
  }
  return fallback;
}

const TOKEN_RE = /(https?:\/\/[^\s<>"']+)|([@#$][\p{L}\p{N}_]{1,40})/gu;

function renderPlainText(text) {
  let html = "";
  let lastIndex = 0;
  for (const match of String(text ?? "").matchAll(TOKEN_RE)) {
    html += escapeHtml(String(text).slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("http")) {
      let href = token;
      let tail = "";
      const trailing = href.match(/[.,!?;:)\]}]+$/);
      if (trailing) {
        tail = trailing[0];
        href = href.slice(0, -tail.length);
      }
      html += `<a href="${safeUrl(href)}" target="_blank" rel="nofollow noopener">${escapeHtml(href)}</a>${escapeHtml(tail)}`;
    } else {
      html += `<a href="https://x.com/search?q=${encodeURIComponent(token.slice(1))}" target="_blank" rel="nofollow noopener">${escapeHtml(token)}</a>`;
    }
    lastIndex = match.index + token.length;
  }
  html += escapeHtml(String(text ?? "").slice(lastIndex));
  return html;
}

function avatarInitial(author) {
  const name = String(author?.name || author?.screenName || "?").trim();
  return escapeHtml((name[0] || "?").toUpperCase());
}

const AVATAR_COLORS = ["#1d9bf0", "#7856ff", "#f4212e", "#00ba7c", "#ff7a00", "#ffd400"];

function avatarColor(seed) {
  let hash = 0;
  const value = String(seed || "");
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function renderAvatar(author, size = 40) {
  const url = safeUrl(author?.avatarUrl);
  const className = size === 40 ? "avatar" : "avatar avatar-small";
  if (url) {
    return `<img class="${className}" src="${url}" alt="" width="${size}" height="${size}" loading="eager">`;
  }
  const background = avatarColor(author?.screenName || author?.name);
  return `<div class="${className} avatar-fallback" style="background:${background}" aria-hidden="true">${avatarInitial(author)}</div>`;
}

function renderBadge(author) {
  return author?.verified ? VERIFIED_BADGE : "";
}

function renderMedia(media, { compact = false } = {}) {
  const items = Array.isArray(media) ? media.filter((item) => safeUrl(item?.url)) : [];
  if (!items.length) return "";
  const count = Math.min(items.length, 4);
  const shown = items.slice(0, 4);

  const cell = (item, index) => {
    const width = Number(item.width) || 16;
    const height = Number(item.height) || 9;
    const ratio = Math.max(0.4, Math.min(3.2, width / height));
    const style = count === 1 ? ` style="aspect-ratio:${width}/${height}"` : "";
    const play =
      item.type === "video" || item.type === "gif"
        ? `<div class="play-badge" aria-hidden="true">${ICONS.play}</div>`
        : "";
    const gif = item.type === "gif" ? '<span class="gif-label">GIF</span>' : "";
    return `<div class="media-cell" data-index="${index}"${style}><img src="${safeUrl(item.url)}" alt="${escapeHtml(item.alt || "")}" loading="eager" referrerpolicy="no-referrer">${play}${gif}</div>`;
  };

  let layout = "single";
  if (count === 2) layout = "grid grid-two";
  if (count === 3) layout = "grid grid-three";
  if (count >= 4) layout = "grid grid-four";

  return `<div class="media ${layout}${compact ? " compact" : ""}">${shown.map(cell).join("")}</div>`;
}

function compactDate(dateValue, locale, timeZone) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  } catch {
    return "";
  }
}

function renderQuote(quote, { locale, timeZone }) {
  if (!quote) return "";
  const text = quote.text ? `<div class="quote-text">${renderPlainText(quote.text)}</div>` : "";
  const media = renderMedia(quote.media || [], { compact: true });
  return `<div class="quote-card">
    <div class="quote-head">
      ${renderAvatar(quote.author, 20)}
      <span class="quote-name">${escapeHtml(quote.author?.name || "")}</span>
      ${renderBadge(quote.author)}
      <span class="quote-handle">@${escapeHtml(quote.author?.screenName || "")}</span>
      <span class="quote-dot">·</span>
      <span class="quote-date">${escapeHtml(compactDate(quote.createdAt, locale, timeZone))}</span>
    </div>
    ${text}
    ${media}
  </div>`;
}

function renderPoll(poll, { locale }) {
  if (!poll || !Array.isArray(poll.options) || !poll.options.length) return "";
  const total = Number(poll.totalVotes) || poll.options.reduce((sum, option) => sum + (Number(option.votes) || 0), 0);
  const rows = poll.options.map((option) => {
    const percentage = Number(option.percentage) || (total > 0 ? Math.round((Number(option.votes) / total) * 100) : 0);
    return `<div class="poll-option">
      <div class="poll-fill" style="width:${Math.max(0, Math.min(100, percentage))}%"></div>
      <span class="poll-label">${escapeHtml(option.label)}</span>
      <span class="poll-percent">${percentage}%</span>
    </div>`;
  });
  const meta = total > 0 ? `${escapeHtml(formatFull(total, locale))} ${isZhLocale(locale) ? "票" : "votes"}` : "";
  return `<div class="poll">${rows.join("")}${meta ? `<div class="poll-meta">${meta}</div>` : ""}</div>`;
}

function renderActions(metrics, { locale, showMetrics }) {
  if (!showMetrics) return "";
  const count = (value) => {
    const formatted = formatCompact(Number(value), locale);
    return formatted ? `<span class="action-count">${formatted}</span>` : "";
  };
  return `<div class="actions">
    <div class="action action-reply" title="Reply">${ICONS.reply}${count(metrics.replies)}</div>
    <div class="action action-repost" title="Repost">${ICONS.repost}${count(metrics.reposts)}</div>
    <div class="action action-like" title="Like">${ICONS.like}${count(metrics.likes)}</div>
    <div class="action action-bookmark" title="Bookmark">${ICONS.bookmark}</div>
    <div class="action action-share" title="Share">${ICONS.share}</div>
  </div>`;
}

function renderMeta(tweet, { locale, timeZone, showMetrics }) {
  if (!showMetrics) return "";
  const date = formatDate(tweet.createdAt, locale, timeZone);
  const views = formatCompact(Number(tweet.metrics?.views), locale);
  const parts = [];
  if (date) parts.push(`<span class="meta-date">${escapeHtml(date)}</span>`);
  if (views) {
    parts.push(
      `<span class="meta-views"><span class="meta-views-count">${views}</span> ${isZhLocale(locale) ? "次观看" : "Views"}</span>`,
    );
  }
  if (!parts.length) return "";
  return `<div class="tweet-meta">${parts.join('<span class="meta-dot">·</span>')}</div>`;
}

function renderTranslation(tweet) {
  const translation = tweet.translation;
  if (!translation?.changed) return "";
  const zh = isZhLocale(translation.to);
  const sourceName = translation.sourceName || languageName(translation.from, translation.to);
  const note = zh ? `翻译自${sourceName}` : `Translated from ${sourceName}`;
  const original = translation.originalText
    ? `<div class="original-block">
        <div class="original-label">${zh ? "原文" : "Original"}</div>
        <div class="original-text" dir="auto">${renderPlainText(translation.originalText)}</div>
      </div>`
    : "";
  return `<div class="translation-note">${escapeHtml(note)}</div>${original}`;
}

export function renderCardHtml(tweet, options = {}) {
  const {
    theme = "dark",
    lang = tweet?.lang || "en",
    width = 600,
    frame = "none",
    pageBg = null,
    cardBg = null,
    radius = null,
    showMetrics = true,
    showMedia = true,
    showAvatar = true,
    customCss = "",
    transparent = false,
    title = "",
    useWebfont = true,
  } = options;

  const locale = localeForLanguage(lang);
  const palette = THEMES[theme] || THEMES.dark;
  const bg = cssColor(cardBg, palette.bg);
  const pageBackground = cssColor(pageBg, bg);
  const cardRadius = radius ?? (frame === "card" ? 16 : 0);
  const cardBorder = frame === "card" ? `1px solid ${palette.border}` : "none";

  const text = tweet.text ? `<div class="tweet-text" dir="auto">${renderPlainText(tweet.text)}</div>` : "";
  const translation = renderTranslation(tweet);
  const media = showMedia ? renderMedia(tweet.media || []) : "";
  const quote = showMedia ? renderQuote(tweet.quote, { locale, timeZone: options.timeZone }) : "";
  const poll = renderPoll(tweet.poll, { locale });
  const meta = renderMeta(tweet, { locale, timeZone: options.timeZone, showMetrics });
  const actions = renderActions(tweet.metrics || {}, { locale, showMetrics });

  const headAvatar = showAvatar ? renderAvatar(tweet.author, 40) : "";
  const header = `<header class="tweet-head">
    ${headAvatar}
    <div class="tweet-head-main">
      <div class="tweet-name-line">
        <span class="tweet-name">${escapeHtml(tweet.author?.name || "")}</span>
        ${renderBadge(tweet.author)}
      </div>
      <div class="tweet-handle">@${escapeHtml(tweet.author?.screenName || "")}</div>
    </div>
    <div class="tweet-more" aria-hidden="true">${ICONS.more}</div>
  </header>`;

  const fontFaces = useWebfont
    ? `@font-face{font-family:"X Chirp";src:url("https://abs.twimg.com/fonts/v2/chirp-regular-web.woff2") format("woff2");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"X Chirp";src:url("https://abs.twimg.com/fonts/v2/chirp-bold-web.woff2") format("woff2");font-weight:700;font-style:normal;font-display:swap}
@font-face{font-family:"X Chirp";src:url("https://abs.twimg.com/fonts/v2/chirp-heavy-web.woff2") format("woff2");font-weight:800;font-style:normal;font-display:swap}`
    : "";

  const css = `
${fontFaces}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:${transparent ? "transparent" : pageBackground};font-family:${FONT_STACK};-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
#card{width:${Number(width)}px;background:${bg};color:${palette.text};padding:16px;border:${cardBorder};border-radius:${cardRadius}px;overflow:hidden;position:relative}
.tweet-head{display:flex;align-items:flex-start;gap:8px}
.avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;flex:0 0 40px;background:${palette.border};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:17px;line-height:1}
.avatar-small{width:20px;height:20px;flex-basis:20px;font-size:11px}
.tweet-head-main{flex:1 1 auto;min-width:0}
.tweet-name-line{display:flex;align-items:center;gap:3px;min-width:0}
.tweet-name{font-size:15px;line-height:20px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{width:18px;height:18px;flex:0 0 18px}
.tweet-handle{font-size:15px;line-height:20px;color:${palette.muted};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tweet-more{margin-left:auto;color:${palette.muted};width:20px;height:20px;flex:0 0 20px}
.tweet-more svg{width:20px;height:20px;fill:currentColor}
.tweet-body{margin-left:48px}
.tweet-text{margin-top:2px;font-size:17px;line-height:24px;white-space:pre-wrap;overflow-wrap:anywhere}
.tweet-text a{color:${palette.accent};text-decoration:none}
.translation-note{margin-top:8px;font-size:15px;line-height:20px;color:${palette.accent}}
.original-block{margin-top:10px;padding-left:10px;border-left:3px solid ${palette.border};color:${palette.muted}}
.original-label{font-size:13px;line-height:16px;font-weight:700;margin-bottom:2px;letter-spacing:.02em}
.original-text{font-size:15px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}
.media{margin-top:12px;border:1px solid ${palette.mediaBorder};border-radius:16px;overflow:hidden;background:${palette.mediaBorder};display:grid;gap:2px}
.media.single{display:block;max-height:510px}
.media-cell{position:relative;overflow:hidden;min-height:80px}
.media.single .media-cell{max-height:510px}
.media-cell img{width:100%;height:100%;object-fit:cover;display:block}
.media.grid-two{grid-template-columns:1fr 1fr}
.media.grid-two .media-cell{aspect-ratio:1/1}
.media.grid-three{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;height:320px}
.media.grid-three .media-cell:first-child{grid-row:span 2}
.media.grid-four{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;height:320px}
.play-badge{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.play-badge::before{content:"";position:absolute;width:64px;height:64px;border-radius:50%;background:rgba(15,20,25,.72);backdrop-filter:blur(2px)}
.play-badge svg{position:relative;width:28px;height:28px;fill:#fff;margin-left:3px}
.gif-label{position:absolute;left:8px;top:8px;background:rgba(0,0,0,.65);color:#fff;font-size:12px;font-weight:700;padding:2px 6px;border-radius:4px;letter-spacing:.03em}
.quote-card{margin-top:12px;border:1px solid ${palette.border};border-radius:16px;padding:12px;background:${palette.quoteBg}}
.quote-head{display:flex;align-items:center;gap:4px;min-width:0}
.quote-name{font-size:15px;line-height:20px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.quote-head .badge{width:16px;height:16px;flex-basis:16px}
.quote-handle,.quote-dot,.quote-date{font-size:15px;line-height:20px;color:${palette.muted};white-space:nowrap}
.quote-text{margin-top:4px;font-size:15px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}
.quote-text a{color:${palette.accent};text-decoration:none}
.quote-card .media{margin-top:8px;border-radius:12px}
.quote-card .media.single{max-height:300px}
.poll{margin-top:12px;display:flex;flex-direction:column;gap:4px}
.poll-option{position:relative;height:40px;border:1px solid ${palette.border};border-radius:4px;overflow:hidden;display:flex;align-items:center;padding:0 12px;font-size:15px}
.poll-fill{position:absolute;left:0;top:0;bottom:0;background:${palette.accent};opacity:.22}
.poll-label{position:relative;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.poll-percent{position:relative;font-weight:700;margin-left:8px}
.poll-meta{margin-top:4px;font-size:13px;line-height:16px;color:${palette.muted}}
.tweet-meta{margin-top:12px;font-size:15px;line-height:20px;color:${palette.muted};display:flex;align-items:center;flex-wrap:wrap;column-gap:4px}
.meta-views-count{font-weight:400}
.meta-dot{padding:0 1px}
.actions{margin-top:12px;display:flex;align-items:center;justify-content:space-between;max-width:425px;color:${palette.muted}}
.action{display:flex;align-items:center;gap:4px;min-width:20px}
.action svg{width:18.75px;height:18.75px;fill:currentColor;display:block}
.action-count{font-size:13px;line-height:16px;font-variant-numeric:tabular-nums}
${customCss}
`;

  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || `X post by @${tweet.author?.screenName || ""}`)}</title>
<style>${css}</style>
</head>
<body>
<main id="card" class="theme-${escapeHtml(theme)}">
  ${header}
  <div class="tweet-body">
    ${text}
    ${translation}
    ${media}
    ${quote}
    ${poll}
    ${meta}
    ${actions}
  </div>
</main>
<script>
(async () => {
  const settle = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
  try { await settle(document.fonts.ready, 2500); } catch (error) {}
  const images = Array.from(document.images);
  await Promise.all(images.map((image) => {
    if (image.complete && image.naturalWidth > 0) return Promise.resolve();
    return settle(new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    }), 5000);
  }));
  await new Promise((resolve) => setTimeout(resolve, 80));
  const card = document.getElementById("card");
  const rect = card.getBoundingClientRect();
  document.body.dataset.width = String(Math.ceil(rect.width));
  document.body.dataset.height = String(Math.ceil(rect.height));
  document.body.dataset.ready = "1";
  document.title = "X2I_READY " + Math.ceil(rect.width) + "x" + Math.ceil(rect.height);
})();
</script>
</body>
</html>`;
}

export function applyMetricOverrides(tweet, overrides = {}) {
  const metrics = { ...(tweet.metrics || {}) };
  for (const key of ["replies", "reposts", "likes", "views", "quotes", "bookmarks"]) {
    if (overrides[key] !== undefined && overrides[key] !== null) {
      metrics[key] = overrides[key];
    }
  }
  return { ...tweet, metrics };
}
