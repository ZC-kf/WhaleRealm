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
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'

/**
 * 数字输入：正常点击输入框用键盘输入；点击尾部 ▾ 在右侧展开
 * 「上下箭头步进 + 九格数字键盘」。数字键盘满位（达到 max 位数）时再点击
 * 数字会清空当前值重新输入。value/onChange 受控。
 */

interface NumberFieldProps {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  step?: number
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'C']

export function NumberField({ value, onChange, min, max, step = 1 }: NumberFieldProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(() => String(value))
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const rootRef = useRef<HTMLDivElement>(null)

  // max 的位数即最大输入长度（如端口 65535 → 5 位）。
  const maxLength = max !== undefined ? String(max).length : Infinity

  const clamp = (n: number): number => {
    let out = n
    if (min !== undefined && out < min) out = min
    if (max !== undefined && out > max) out = max
    return out
  }

  const emit = (n: number, text: string) => {
    setEditing(text)
    onChange(n)
  }

  // 键盘输入：只保留数字，限制位数；自由输入不夹紧，提交时由调用方校验。
  const onInputChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, maxLength)
    setEditing(digits)
    onChange(Number(digits) || 0)
  }

  const openPopover = () => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect) {
      // 在输入框右侧展开；右侧越界则翻到左侧。
      const panelWidth = 168
      const left = rect.right + 6 + panelWidth > window.innerWidth ? rect.left - panelWidth - 6 : rect.right + 6
      setPos({ top: rect.top, left })
    }
    setOpen(true)
  }

  const pressDigit = (digit: string) => {
    let current = editing
    // 满位时再点击输入 → 清空当前输入重新输入。
    if (current.length >= maxLength) current = ''
    const next = current === '' || current === '0' ? digit : current + digit
    if (next.length > maxLength) return
    emit(clamp(Number(next)), String(clamp(Number(next))))
  }

  const backspace = () => {
    const current = editing
    const next = current.length <= 1 ? '' : current.slice(0, -1)
    emit(next === '' ? (min ?? 0) : Number(next), next)
  }

  const clear = () => emit(min ?? 0, '')

  const stepBy = (dir: 1 | -1) => {
    const base = editing === '' ? (min ?? 0) : Number(editing)
    const n = clamp((Number.isFinite(base) ? base : 0) + dir * step)
    emit(n, String(n))
  }

  // 点击面板外部关闭。
  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (!(event.target as Element).closest?.('.number-field-popover')) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="number-field" ref={rootRef}>
      <input
        className="number-field-input"
        inputMode="numeric"
        value={editing}
        onChange={event => onInputChange(event.target.value)}
        onFocus={() => setOpen(false)}
      />
      <button type="button" className="number-field-tail" aria-label={t('number.keypad')} onClick={() => (open ? setOpen(false) : openPopover())}>▾</button>
      {open && createPortal(
        <div className="number-field-popover" style={{ top: pos.top, left: pos.left }}>
          <div className="number-field-stepper">
            <button type="button" onClick={() => stepBy(1)} disabled={max !== undefined && (editing === '' ? (min ?? 0) : Number(editing)) >= max} aria-label={t('number.increase')}>▲</button>
            <button type="button" onClick={() => stepBy(-1)} disabled={min !== undefined && (editing === '' ? (min ?? 0) : Number(editing)) <= min} aria-label={t('number.decrease')}>▼</button>
          </div>
          <div className="number-field-pad">
            {DIGITS.map(digit => (
              <button
                key={digit}
                type="button"
                className={digit === 'C' ? 'pad-clear' : digit === '⌫' ? 'pad-back' : ''}
                onClick={() => {
                  if (digit === '⌫') backspace()
                  else if (digit === 'C') clear()
                  else pressDigit(digit)
                }}
              >
                {digit}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
