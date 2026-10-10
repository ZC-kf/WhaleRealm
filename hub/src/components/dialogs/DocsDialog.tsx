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

import { useEffect, useState } from 'react'
import { ArrowLeft, BookOpen, X } from 'lucide-react'
import { useLauncherApi } from '../../api/client'
import { useI18n } from '../../i18n'
import type { LanguageCode } from '../../i18n/locales'
import type { TranslationKey } from '../../i18n/translations/zh-CN'
import { renderMarkdown } from '../../lib/markdown'

/**
 * 项目文档弹窗：先列出当前语言下的文档清单（标题/简介走翻译），
 * 点击一篇打开阅读视图。正文按 lang → en → zh-CN 回退链读取。
 */

interface DocsDialogProps {
  language: LanguageCode
  onClose: () => void
}

/** 源码中的文档注册表：决定显示顺序与 i18n key；后续新增文档在此追加。 */
const DOC_REGISTRY: Array<{ id: string; titleKey: TranslationKey; descKey: TranslationKey }> = [
  { id: 'introduction', titleKey: 'docs.entry.title.introduction', descKey: 'docs.entry.desc.introduction' },
  { id: 'quick-start', titleKey: 'docs.entry.title.quick-start', descKey: 'docs.entry.desc.quick-start' },
  { id: 'instance-guide', titleKey: 'docs.entry.title.instance-guide', descKey: 'docs.entry.desc.instance-guide' },
  { id: 'technical-overview', titleKey: 'docs.entry.title.technical-overview', descKey: 'docs.entry.desc.technical-overview' },
  { id: 'troubleshooting', titleKey: 'docs.entry.title.troubleshooting', descKey: 'docs.entry.desc.troubleshooting' },
]

export function DocsDialog({ language, onClose }: DocsDialogProps) {
  const api = useLauncherApi()
  const { t } = useI18n()
  const [entries, setEntries] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let disposed = false
    void api.listDocs().then(result => {
      if (disposed || !result.ok) return
      const available = new Set(result.ids)
      setEntries(DOC_REGISTRY.filter(doc => available.has(doc.id)).map(doc => doc.id))
    }).catch(() => { if (!disposed) setEntries([]) })
    return () => { disposed = true }
  }, [api])

  const openDoc = (id: string) => {
    setActiveId(id)
    setContent(null)
    setFailed(false)
    setBusy(true)
    void api.readDoc(id, language).then(result => {
      if (result.ok && result.content !== null) {
        setContent(result.content)
      } else {
        setFailed(true)
      }
    }).catch(() => setFailed(true)).finally(() => setBusy(false))
  }

  const backToList = () => {
    setActiveId(null)
    setContent(null)
    setFailed(false)
  }

  const openLink = (url: string) => {
    if (/^https?:\/\//i.test(url)) void api.openExternal(url)
  }

  const active = DOC_REGISTRY.find(doc => doc.id === activeId) ?? null

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose() }}>
      <section className="modal docs-dialog" role="dialog" aria-modal="true" aria-labelledby="docs-dialog-title">
        <header>
          <div><BookOpen size={17} /><h2 id="docs-dialog-title">{t('docs.title')}</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
        </header>
        <div className="modal-content docs-content">
          {active === null ? (
            <div className="docs-list">
              <p className="docs-list-hint">{t('docs.listHint')}</p>
              {entries.map(id => {
                const doc = DOC_REGISTRY.find(item => item.id === id)
                if (!doc) return null
                return (
                  <button key={id} type="button" className="docs-entry" onClick={() => openDoc(id)}>
                    <span className="docs-entry-title">{t(doc.titleKey)}</span>
                    <span className="docs-entry-desc">{t(doc.descKey)}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="docs-reader">
              <div className="docs-reader-bar">
                <button type="button" className="secondary-button" onClick={backToList}><ArrowLeft size={13} />{t('docs.backToList')}</button>
                {active && <strong className="docs-reader-title">{t(active.titleKey)}</strong>}
              </div>
              {busy ? (
                <p className="docs-status">{t('docs.reading')}</p>
              ) : failed || content === null ? (
                <p className="docs-status">{t('docs.notFound')}</p>
              ) : (
                <article className="docs-markdown">{renderMarkdown(content, openLink)}</article>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
