/** Спрощений рендер markdown-подібного тексту з відповідей моделі. */
import * as React from 'react'
import { cx } from './format'

/* ------------------------------------------------------------------------------------------------
 * Markdownish — висновок AI з Markdown-подібного тексту: абзаци, **жирний**, списки (-, *, 1.), малі заголовки (###, ####).
 * Вигляд — клас .op-prose з index.css (кеглі й відступи з токенів, ширина рядка ≤68ch).
 * Якщо в поточному коді парсер інший — лишити його і додати лише className="op-prose".
 * ---------------------------------------------------------------------------------------------- */
export interface MarkdownishProps {
  text?: string
  children?: string
  className?: string
}

function renderInline(src: string, key: React.Key): React.ReactNode {
  const parts = src.split(/(\*\*[^*]+\*\*)/g)
  return (
    <React.Fragment key={key}>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </React.Fragment>
  )
}

export function Markdownish({ text, children, className }: MarkdownishProps) {
  const src = (text ?? children ?? '').replace(/\r\n/g, '\n').trim()
  const blocks = src.split(/\n{2,}/)
  return (
    <div className={cx('op-prose', className)}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n')
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d+[.)]\s+/.test(lines[0])
          const items = lines.map((l, i) => (
            <li key={i}>{renderInline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), i)}</li>
          ))
          return ordered ? <ol key={bi}>{items}</ol> : <ul key={bi}>{items}</ul>
        }
        const h = /^(#{1,6})\s+(.*)$/.exec(lines[0])
        if (h && lines.length === 1) {
          return h[1].length <= 3 ? (
            <h3 key={bi}>{renderInline(h[2], bi)}</h3>
          ) : (
            <h4 key={bi}>{renderInline(h[2], bi)}</h4>
          )
        }
        return (
          <p key={bi}>
            {lines.map((l, i) => (
              <React.Fragment key={i}>
                {i > 0 && <br />}
                {renderInline(l, i)}
              </React.Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
