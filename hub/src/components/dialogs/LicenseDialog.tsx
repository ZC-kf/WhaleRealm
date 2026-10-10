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
import { ScrollText, X } from 'lucide-react'
import { useLauncherApi } from '../../api/client'
import { useI18n } from '../../i18n'
import { renderMarkdown } from '../../lib/markdown'

/**
 * 开源协议弹窗：两种模式——
 *  gpl：从 licenses/GPL-3.0.txt 读取官方全文滚动展示；
 *  third-party：读取随软件分发的 licenses/THIRD_PARTY_NOTICES.md 并以 Markdown 渲染（表格 + 许可证列加粗）。
 */

interface LicenseDialogProps {
  kind: 'gpl' | 'third-party'
  onClose: () => void
}

export function LicenseDialog({ kind, onClose }: LicenseDialogProps) {
  const api = useLauncherApi()
  const { t } = useI18n()
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let disposed = false
    const loader = kind === 'gpl' ? () => api.readLicense() : () => api.readThirdPartyNotices()
    setText(null)
    setFailed(false)
    void loader().then(result => {
      if (disposed) return
      if (result === null) setFailed(true)
      else setText(result)
    }).catch(() => { if (!disposed) setFailed(true) })
    return () => { disposed = true }
  }, [api, kind])

  const title = kind === 'gpl' ? t('settings.about.licenseDialogTitle') : t('settings.about.thirdPartyDialogTitle')

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose() }}>
      <section className="modal license-dialog" role="dialog" aria-modal="true" aria-labelledby="license-dialog-title">
        <header>
          <div><ScrollText size={17} /><h2 id="license-dialog-title">{title}</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
        </header>
        <div className="modal-content license-content">
          {failed ? (
            <p className="docs-status">{t('settings.about.licenseReadFailed')}</p>
          ) : text === null ? (
            <p className="docs-status">{t('docs.reading')}</p>
          ) : kind === 'gpl' ? (
            <pre className="license-text">{text}</pre>
          ) : (
            <div className="license-third-party">
              <article className="docs-markdown">{renderMarkdown(text)}</article>
              <p className="docs-status">{t('settings.about.licenseHint')}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
