/*
 * 鲸域 · WhaleRealm
 * Copyright (C) 2026 凛枫
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 附加署名要求：任何分发本程序或其衍生作品的行为，必须在显著位置
 * 保留上述版权声明及作者署名。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import type { TranslationKey } from '../i18n/translations/zh-CN'

/**
 * 首次启动教学引导（指向式巡游）。
 *
 * 每一步都指向界面上真实存在的控件，把高亮框套在它的 bounding rect 上，
 * 并在旁边放说明卡片。高亮框 pointer-events 为 none，所以用户在巡游过程中
 * 可以直接点真实按钮"边学边做"。
 *
 * 关闭状态与设置对话框里的「启动时自动显示」开关共用同一个 localStorage 键。
 */

const STORAGE_KEY = 'dsh-launcher:first-run-guide'
const DISMISSED = 'dismissed'

interface TourStep {
  id: string
  /** 要高亮的真实控件选择器；缺省或找不到时说明卡片居中、不加高亮框。 */
  selector?: string
  titleKey: TranslationKey
  bodyKeys: TranslationKey[]
}

const STEPS: TourStep[] = [
  {
    id: 'overview',
    selector: '.instance-switcher__header',
    titleKey: 'guide.overview.title',
    bodyKeys: ['guide.overview.0'],
  },
  {
    id: 'window',
    selector: '.launcher-window-controls',
    titleKey: 'guide.window.title',
    bodyKeys: ['guide.window.0', 'guide.window.1', 'guide.window.2', 'guide.window.3'],
  },
  {
    id: 'collect',
    selector: '.instance-switcher__toolbar',
    titleKey: 'guide.collect.title',
    bodyKeys: ['guide.collect.0', 'guide.collect.1'],
  },
  {
    id: 'create',
    selector: '.instance-switcher__toolbar',
    titleKey: 'guide.create.title',
    bodyKeys: ['guide.create.0', 'guide.create.1'],
  },
  {
    id: 'select',
    selector: '.instance-card__select',
    titleKey: 'guide.select.title',
    bodyKeys: ['guide.select.0', 'guide.select.1'],
  },
  {
    id: 'start-stop',
    selector: '.instance-card__actions',
    titleKey: 'guide.startstop.title',
    bodyKeys: [
      'guide.startstop.0', 'guide.startstop.1', 'guide.startstop.2', 'guide.startstop.3',
      'guide.startstop.4', 'guide.startstop.5', 'guide.startstop.6', 'guide.startstop.7',
      'guide.startstop.8',
    ],
  },
  {
    id: 'token',
    selector: '.instance-card__usage',
    titleKey: 'guide.token.title',
    bodyKeys: ['guide.token.0'],
  },
  {
    id: 'detail',
    selector: '.instance-card__detail-toggle',
    titleKey: 'guide.detail.title',
    bodyKeys: ['guide.detail.0', 'guide.detail.1'],
  },
  {
    id: 'remove',
    selector: '.instance-card__remove',
    titleKey: 'guide.remove.title',
    bodyKeys: ['guide.remove.0', 'guide.remove.1', 'guide.remove.2'],
  },
  {
    id: 'settings',
    selector: '.launcher-window-button',
    titleKey: 'guide.settings.title',
    bodyKeys: [
      'guide.settings.0', 'guide.settings.1', 'guide.settings.2', 'guide.settings.3', 'guide.settings.4',
    ],
  },
  {
    id: 'tray',
    titleKey: 'guide.tray.title',
    bodyKeys: ['guide.tray.0', 'guide.tray.1', 'guide.tray.2', 'guide.tray.3'],
  },
]

const CALLOUT_WIDTH = 360

export function FirstRunGuide() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [doNotShowAgain, setDoNotShowAgain] = useState(false)
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const calloutRef = useRef<HTMLDivElement>(null)
  const [calloutHeight, setCalloutHeight] = useState(300)

  const readDismissed = useCallback((): boolean => {
    try { return window.localStorage.getItem(STORAGE_KEY) === DISMISSED } catch { return false }
  }, [])

  const writeDismissed = useCallback((dismissed: boolean) => {
    try {
      if (dismissed) window.localStorage.setItem(STORAGE_KEY, DISMISSED)
      else window.localStorage.removeItem(STORAGE_KEY)
    } catch { /* 私有模式下存储不可用，忽略 */ }
  }, [])

  useEffect(() => {
    if (!readDismissed()) setOpen(true)
  }, [readDismissed])

  useEffect(() => {
    const handler = (): void => { setStepIndex(0); setDoNotShowAgain(false); setOpen(true) }
    window.addEventListener('dsh-first-run-guide:open', handler)
    return () => window.removeEventListener('dsh-first-run-guide:open', handler)
  }, [])

  const step = STEPS[Math.min(stepIndex, STEPS.length - 1)]

  // 持续跟踪目标控件的位置：窗口缩放、滚动都会改变它。
  // 用 setInterval + resize/scroll 即时刷新，而非 requestAnimationFrame：
  // rAF 在窗口被遮挡/进入后台时被浏览器节流，高亮框停止更新。
  useEffect(() => {
    if (!open) { setRect(null); return }
    const update = () => {
      const target = step.selector ? document.querySelector(step.selector) : null
      if (target) {
        const box = target.getBoundingClientRect()
        setRect({ top: box.top, left: box.left, width: box.width, height: box.height })
      } else {
        setRect(null)
      }
    }
    update()
    const timer = window.setInterval(update, 200)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, step])

  // 实测说明卡片的真实高度，供四向定位精确钳制（写死高度会低估，导致高目标时卡片溢出）。
  useLayoutEffect(() => {
    if (!open) return
    const el = calloutRef.current
    if (!el) return
    const measure = () => setCalloutHeight(el.offsetHeight || 300)
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(el)
      return () => observer.disconnect()
    }
    return undefined
  }, [open, step])

  const close = useCallback(() => {
    writeDismissed(doNotShowAgain)
    setOpen(false)
  }, [doNotShowAgain, writeDismissed])

  const isLast = stepIndex >= STEPS.length - 1
  const showHighlight = open && rect !== null && rect.width > 0

  // 说明卡片位置：优先放在高亮框下方，空间不足依次试上方/右侧/左侧，最后钳制在视口内（含 12px 边距）。
  const calloutStyle: React.CSSProperties = (() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const M = 12
    if (!showHighlight || !rect) {
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: CALLOUT_WIDTH }
    }
    const right = rect.left + rect.width
    const bottom = rect.top + rect.height
    const clampLeft = (x: number) => Math.max(M, Math.min(x, vw - CALLOUT_WIDTH - M))
    const clampTop = (y: number) => Math.max(M, Math.min(y, vh - calloutHeight - M))
    if (bottom + 14 + calloutHeight <= vh - M) return { top: bottom + 14, left: clampLeft(rect.left), width: CALLOUT_WIDTH }
    if (rect.top - 14 - calloutHeight >= M) return { top: rect.top - 14 - calloutHeight, left: clampLeft(rect.left), width: CALLOUT_WIDTH }
    if (right + 14 + CALLOUT_WIDTH <= vw - M) return { top: clampTop(rect.top), left: right + 14, width: CALLOUT_WIDTH }
    if (rect.left - 14 - CALLOUT_WIDTH >= M) return { top: clampTop(rect.top), left: rect.left - 14 - CALLOUT_WIDTH, width: CALLOUT_WIDTH }
    return { top: clampTop(rect.top), left: clampLeft(rect.left), width: CALLOUT_WIDTH }
  })()

  return (
    <>
      {open ? (
        <div role="dialog" aria-modal="false" aria-label={t('guide.ariaLabel')}>
          {showHighlight && rect ? (
            <div
              aria-hidden="true"
              data-testid="guide-highlight"
              style={{
                position: 'fixed', top: rect.top - 4, left: rect.left - 4,
                width: rect.width + 8, height: rect.height + 8,
                borderRadius: 12, border: '2px solid rgba(120,190,255,0.95)',
                boxShadow: '0 0 0 9999px rgba(8,10,12,0.62), 0 0 22px rgba(120,190,255,0.55)',
                pointerEvents: 'none', zIndex: 4000, transition: 'top 120ms ease, left 120ms ease, width 120ms ease, height 120ms ease',
              }}
            />
          ) : (
            <div aria-hidden="true" style={{ position: 'fixed', inset: 0, background: 'rgba(8,10,12,0.62)', pointerEvents: 'none', zIndex: 4000 }} />
          )}

          <div
            ref={calloutRef}
            data-testid="guide-callout"
            style={{
              ...calloutStyle,
              position: 'fixed', zIndex: 4001, borderRadius: 14, padding: '16px 18px',
              border: '1px solid rgba(128,128,128,0.45)', background: 'rgba(20,23,27,0.98)',
              color: '#f2f3f5', boxShadow: '0 18px 48px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
              <div style={{ fontSize: 11, letterSpacing: 0.6, opacity: 0.62, textTransform: 'uppercase' }}>
                {t('guide.label', { step: stepIndex + 1, total: STEPS.length })}
              </div>
              <button type="button" aria-label={t('guide.close')} onClick={close}
                style={{ padding: '2px 9px', fontSize: 12, borderRadius: 7, cursor: 'pointer', border: '1px solid rgba(128,128,128,0.5)', background: 'rgba(128,128,128,0.18)', color: 'inherit' }}>
                ✕
              </button>
            </div>
            <h2 style={{ fontSize: 16.5, fontWeight: 700, margin: '6px 0 8px' }}>{t(step.titleKey)}</h2>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {step.bodyKeys.map(key => (
                <li key={key} style={{ fontSize: 13, lineHeight: 1.7, padding: '3px 0 3px 14px', position: 'relative', opacity: 0.92 }}>
                  <span style={{ position: 'absolute', left: 0, opacity: 0.55 }}>·</span>
                  {t(key)}
                </li>
              ))}
            </ul>

            {step.selector && !rect ? (
              <div style={{ fontSize: 11.5, opacity: 0.7, marginTop: 8 }}>{t('guide.notFound')}</div>
            ) : null}

            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, opacity: 0.82, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={doNotShowAgain} onChange={event => setDoNotShowAgain(event.target.checked)} />
                {t('guide.doNotShow')}
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" disabled={stepIndex === 0}
                  onClick={() => setStepIndex(value => Math.max(0, value - 1))}
                  style={{ padding: '6px 13px', fontSize: 12.5, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(128,128,128,0.5)', background: 'rgba(128,128,128,0.18)', color: 'inherit', opacity: stepIndex === 0 ? 0.45 : 1 }}>
                  {t('guide.prev')}
                </button>
                {isLast ? (
                  <button type="button" onClick={close}
                    style={{ padding: '6px 15px', fontSize: 12.5, fontWeight: 650, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(120,190,255,0.6)', background: 'rgba(120,190,255,0.24)', color: 'inherit' }}>
                    {t('guide.start')}
                  </button>
                ) : (
                  <button type="button" onClick={() => setStepIndex(value => Math.min(STEPS.length - 1, value + 1))}
                    style={{ padding: '6px 15px', fontSize: 12.5, fontWeight: 650, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(120,190,255,0.6)', background: 'rgba(120,190,255,0.24)', color: 'inherit' }}>
                    {t('guide.next')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
