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

import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { useI18n } from '../../i18n'

/** 托盘窗口宽高比（400×560 = 5:7）；裁剪框严格保持此比例，可等比例缩放。 */
const TRAY_RATIO = 5 / 7
/** 裁剪框最小宽度（CSS 像素）。 */
const MIN_WIDTH_PX = 40

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** 裁剪框：x/y 为相对容器的百分比位置，w 为相对容器宽度的百分比宽度（高度由 5:7 比例推导）。 */
interface CropBox { x: number; y: number; w: number }

/**
 * 托盘背景图裁剪对话框：在导入的图片上拖动选择要展示的区域。
 * 裁剪框严格保持托盘窗口比例（5:7），既可拖动移动，也可拖动右下角圆点等比例缩放。
 * 确认后用 canvas 裁剪并输出 PNG dataURL。
 */
export function CropDialog({ imageName, onCancel, onConfirm }: { imageName: string; onCancel: () => void; onConfirm: (dataUrl: string) => void }) {
  const { t } = useI18n()
  // 经 fetch 把图片转成同源 blob URL：既用于展示，也避免跨源图片污染 canvas 导致 toDataURL 抛错（"确认截取"无反应）。
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState<CropBox | null>(null)
  const [drag, setDrag] = useState<null | { mode: 'move' | 'resize'; startX: number; startY: number; start: CropBox }>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let disposed = false
    let objectUrl: string | null = null
    void fetch(`launcher-asset://${imageName}`)
      .then(response => { if (!response.ok) throw new Error('加载失败'); return response.blob() })
      .then(blob => {
        if (disposed) return
        objectUrl = URL.createObjectURL(blob)
        setImgSrc(objectUrl)
      })
      .catch(() => { /* 加载失败保持空白，确认按钮保持禁用 */ })
    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [imageName])

  // 图片加载完成后，把初始裁剪框约束到容器内并居中。
  const onImageLoad = () => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    // 裁剪框物理高度 = 宽度 × (7/5)，因此宽度受容器高度约束。
    const maxWpx = Math.min(rect.width, rect.height * TRAY_RATIO)
    const w = Math.min(maxWpx, rect.width * 0.6)
    const boxH = w / TRAY_RATIO
    const x = (rect.width - w) / 2
    const y = (rect.height - boxH) / 2
    setCrop({ x: (x / rect.width) * 100, y: (y / rect.height) * 100, w: (w / rect.width) * 100 })
  }

  const begin = (mode: 'move' | 'resize', event: React.MouseEvent) => {
    if (!crop) return
    event.preventDefault()
    event.stopPropagation()
    setDrag({ mode, startX: event.clientX, startY: event.clientY, start: crop })
  }

  useEffect(() => {
    if (!drag) return
    const onMove = (event: MouseEvent) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const startWpx = rect.width * (drag.start.w / 100)
      const startLeftPx = rect.width * (drag.start.x / 100)
      const startTopPx = rect.height * (drag.start.y / 100)
      const dxPx = event.clientX - drag.startX
      const dyPx = event.clientY - drag.startY

      if (drag.mode === 'move') {
        const boxH = startWpx / TRAY_RATIO
        const left = clamp(startLeftPx + dxPx, 0, rect.width - startWpx)
        const top = clamp(startTopPx + dyPx, 0, rect.height - boxH)
        setCrop({ x: (left / rect.width) * 100, y: (top / rect.height) * 100, w: drag.start.w })
      } else {
        // 等比例缩放：锚定左上角，右下角随鼠标移动；取横、纵两个方向里更小者以保持比例并留在容器内。
        const maxWpx = Math.min(rect.width - startLeftPx, (rect.height - startTopPx) * TRAY_RATIO)
        const minWpx = Math.min(MIN_WIDTH_PX, maxWpx)
        const candidateW = Math.min(startWpx + dxPx, startWpx + dyPx * TRAY_RATIO)
        const w = clamp(candidateW, minWpx, maxWpx)
        setCrop({ x: drag.start.x, y: drag.start.y, w: (w / rect.width) * 100 })
      }
    }
    const onUp = () => setDrag(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag])

  const confirm = () => {
    const img = imgRef.current
    const container = containerRef.current
    if (!img || !img.naturalWidth || !container || !crop) return
    const rect = container.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    // 图片按 width:100% 展示，横向缩放 = naturalWidth / rect.width；
    // 纵向用容器高度换算，避免 max-height 裁剪导致纵向错位。
    const scale = img.naturalWidth / rect.width
    const sx = (crop.x / 100) * rect.width * scale
    const sy = (crop.y / 100) * rect.height * scale
    const sw = (crop.w / 100) * rect.width * scale
    const sh = sw / TRAY_RATIO // = sw × 7/5，严格保持托盘比例
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(sw))
    canvas.height = Math.max(1, Math.round(sh))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    onConfirm(canvas.toDataURL('image/png'))
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onCancel() }}>
      <section className="modal crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <header>
          <div><h2 id="crop-title">{t('crop.title')}</h2></div>
          <button type="button" className="icon-button" onClick={onCancel} aria-label={t('common.cancel')}><X size={18} /></button>
        </header>
        <div className="modal-content">
          <p className="crop-hint">{t('crop.hint')}</p>
          <div className="crop-container">
            <div className="crop-canvas" ref={containerRef}>
              {imgSrc && <img ref={imgRef} src={imgSrc} alt={t('crop.alt')} draggable={false} onLoad={onImageLoad} />}
              {crop && (
                <div
                  className={`crop-box${drag?.mode === 'move' ? ' dragging' : ''}`}
                  style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, aspectRatio: '5 / 7' }}
                  onMouseDown={event => begin('move', event)}
                >
                  <span className="crop-resize-handle" onMouseDown={event => begin('resize', event)} />
                </div>
              )}
            </div>
          </div>
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={onCancel}>{t('common.cancel')}</button>
          <button type="button" className="primary-command" onClick={confirm} disabled={!crop}><Check size={17} />{t('crop.confirm')}</button>
        </footer>
      </section>
    </div>
  )
}
