import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import MarkdownRenderer from '../MarkdownRenderer'

export default function ModelInfoTooltip({ content, contentRef }: { content: string; contentRef: RefObject<HTMLDivElement | null> }) {
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 320 })

  const show = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setOpen(true)
  }
  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setOpen(false)
  }
  const hideSoon = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    // 给鼠标从图标移到浮层留出时间，方便阅读、滚动和打开链接。
    timerRef.current = setTimeout(() => setOpen(false), 150)
  }

  useCloseOnEscape(open, hide)
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!buttonRef.current?.contains(target) && !contentRef.current?.contains(target)) hide()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, contentRef])

  useLayoutEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const button = buttonRef.current
      const panel = contentRef.current
      if (!button || !panel) return
      const rect = button.getBoundingClientRect()
      const above = Math.max(0, rect.top - 16)
      const below = Math.max(0, window.innerHeight - rect.bottom - 16)
      const showAbove = above > below
      const maxHeight = Math.min(320, showAbove ? above : below)
      const height = Math.min(panel.scrollHeight, maxHeight)
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8)),
        top: showAbove ? rect.top - height - 8 : rect.bottom + 8,
        maxHeight,
      })
    }
    updatePosition()
    // Markdown 异步加载后高度会变化，需要重新定位。
    const observer = new ResizeObserver(updatePosition)
    if (contentRef.current) observer.observe(contentRef.current)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, contentRef])

  return (
    <span className="inline-flex" onMouseEnter={show} onMouseLeave={hideSoon} onFocus={show} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget) && !contentRef.current?.contains(event.relatedTarget)) hideSoon()
    }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={show}
        aria-label="查看当前模型说明"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        className="rounded-full p-0.5 text-gray-400 transition-colors hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:text-gray-500 dark:hover:text-blue-400"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={contentRef}
          id={id}
          role="tooltip"
          tabIndex={0}
          data-selectable-text
          style={position}
          className="custom-scrollbar fixed z-[120] w-96 max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white p-3 text-xs leading-5 text-gray-600 shadow-xl dark:border-white/10 dark:bg-gray-800 dark:text-gray-300"
        >
          <MarkdownRenderer content={content} />
        </div>,
        document.body,
      )}
    </span>
  )
}
