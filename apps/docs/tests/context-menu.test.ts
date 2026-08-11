import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { editorExtensions } from '../src/renderer/editor/extensions'
import {
  EditorContextMenu,
  FontDialog,
  ParagraphDialog,
} from '../src/renderer/components/ContextMenu'

function createEditor(paraAttrs: Record<string, unknown> = {}): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'docParagraph',
          attrs: { docxIndex: 0, ...paraAttrs },
          content: [{ type: 'text', text: 'EVs market research' }],
        },
      ],
    },
  })
}

function select(editor: Editor, from: number, to: number) {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
  )
}

function render(element: React.ReactElement): {
  container: HTMLElement
  rerender: (next: React.ReactElement) => void
  unmount: () => void
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return {
    container,
    rerender: (next) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

const noop = () => {}

function menuProps(editor: Editor, overrides: Record<string, unknown> = {}) {
  return {
    editor,
    menu: { x: 10, y: 10 },
    onClose: noop,
    onFontDialog: noop,
    onParagraphDialog: noop,
    onLink: noop,
    onNewComment: noop,
    onAiPreset: noop,
    ...overrides,
  }
}

describe('EditorContextMenu', () => {
  it('disables selection-dependent items when nothing is selected', () => {
    const editor = createEditor()
    const { container, unmount } = render(createElement(EditorContextMenu, menuProps(editor)))
    const byLabel = (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('.ctx-item')].find(
        (b) => b.querySelector('.ctx-label')?.textContent === label,
      )!
    expect(byLabel('剪切').disabled).toBe(true)
    expect(byLabel('复制').disabled).toBe(true)
    expect(byLabel('粘贴').disabled).toBe(false)
    expect(byLabel('字体…').disabled).toBe(false)
    expect(byLabel('段落…').disabled).toBe(false)
    expect(byLabel('新建批注').disabled).toBe(true)
    expect(byLabel('Fynix AI')).toBeUndefined()
    unmount()
    editor.destroy()
  })

  it('enables everything and routes New Comment / Font… when text is selected', () => {
    const editor = createEditor()
    select(editor, 1, 5)
    const onNewComment = vi.fn()
    const onFontDialog = vi.fn()
    const onClose = vi.fn()
    const { container, unmount } = render(
      createElement(EditorContextMenu, menuProps(editor, { onNewComment, onFontDialog, onClose })),
    )
    const byLabel = (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('.ctx-item')].find(
        (b) => b.querySelector('.ctx-label')?.textContent === label,
      )!
    expect(byLabel('剪切').disabled).toBe(false)
    expect(byLabel('新建批注').disabled).toBe(false)
    act(() => byLabel('新建批注').click())
    expect(onNewComment).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalled()
    act(() => byLabel('字体…').click())
    expect(onFontDialog).toHaveBeenCalledOnce()
    unmount()
    editor.destroy()
  })

  it('sends the selected text to the AI panel for Synonyms', () => {
    const editor = createEditor()
    select(editor, 1, 4)
    const onAiPreset = vi.fn()
    const { container, unmount } = render(
      createElement(EditorContextMenu, menuProps(editor, { onAiPreset })),
    )
    const synonym = [...container.querySelectorAll<HTMLButtonElement>('.ctx-item')].find(
      (b) => b.querySelector('.ctx-label')?.textContent === '同义词',
    )!
    expect(synonym.disabled).toBe(false)
    act(() => synonym.click())
    expect(onAiPreset).toHaveBeenCalledOnce()
    expect(String(onAiPreset.mock.calls[0][0])).toContain('EVs')
    unmount()
    editor.destroy()
  })

  it('offers Fynix AI tools for selected text and preserves that selection as context', () => {
    const editor = createEditor()
    select(editor, 1, 4)
    const onAiPreset = vi.fn()
    const { container, unmount } = render(
      createElement(EditorContextMenu, menuProps(editor, { onAiPreset })),
    )
    const byLabel = (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('.ctx-item')].find(
        (button) => button.querySelector('.ctx-label')?.textContent === label,
      )
    const fynixAi = byLabel('Fynix AI')
    expect(fynixAi).toBeDefined()
    act(() => fynixAi!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    const summarize = byLabel('AI 总结')
    expect(summarize).toBeDefined()
    expect(byLabel('AI 重写')).toBeDefined()

    // Simulate focus moving away from the editor while the menu is open.
    select(editor, 8, 8)
    act(() => summarize!.click())

    const instruction = String(onAiPreset.mock.calls[0][0])
    expect(instruction).toContain('Summarize only the user-highlighted text')
    expect(instruction).toContain('<selected_text_json>"EVs"</selected_text_json>')
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe(
      'EVs',
    )
    unmount()
    editor.destroy()
  })

  it('refreshes AI context when a second right-click repositions an open menu', () => {
    const editor = createEditor()
    select(editor, 1, 4)
    const onAiPreset = vi.fn()
    const props = menuProps(editor, { onAiPreset })
    const rendered = render(createElement(EditorContextMenu, props))

    select(editor, 5, 11)
    rendered.rerender(
      createElement(EditorContextMenu, { ...props, menu: { x: 30, y: 30 } }),
    )
    const byLabel = (label: string) =>
      [...rendered.container.querySelectorAll<HTMLButtonElement>('.ctx-item')].find(
        (button) => button.querySelector('.ctx-label')?.textContent === label,
      )
    act(() => byLabel('Fynix AI')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    act(() => byLabel('AI 总结')!.click())

    expect(String(onAiPreset.mock.calls[0][0])).toContain(
      '<selected_text_json>"market"</selected_text_json>',
    )
    rendered.unmount()
    editor.destroy()
  })

  it('routes Rewrite through the highlighted section only', () => {
    const editor = createEditor()
    select(editor, 5, 11)
    const onAiPreset = vi.fn()
    const { container, unmount } = render(
      createElement(EditorContextMenu, menuProps(editor, { onAiPreset })),
    )
    const byLabel = (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('.ctx-item')].find(
        (button) => button.querySelector('.ctx-label')?.textContent === label,
      )
    act(() => byLabel('Fynix AI')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    act(() => byLabel('AI 重写')!.click())

    const instruction = String(onAiPreset.mock.calls[0][0])
    expect(instruction).toContain('must call replace_selection')
    expect(instruction).toContain('from=5, to=11')
    expect(instruction).toContain('<selected_text_json>"market"</selected_text_json>')
    unmount()
    editor.destroy()
  })

  it('marks AI-backed items (Synonyms/Translate) with the copilot badge', () => {
    const editor = createEditor()
    select(editor, 1, 4)
    const { container, unmount } = render(createElement(EditorContextMenu, menuProps(editor)))
    const badged = [...container.querySelectorAll<HTMLButtonElement>('.ctx-item')]
      .filter((b) => b.querySelector('.copilot-badge'))
      .map((b) => b.querySelector('.ctx-label')?.textContent)
    expect(badged).toContain('同义词')
    expect(badged).toContain('翻译')
    unmount()
    editor.destroy()
  })
})

describe('FontDialog', () => {
  it('applies font marks to the selection on OK', () => {
    const editor = createEditor()
    select(editor, 1, 10)
    const { container, unmount } = render(createElement(FontDialog, { editor, onClose: noop }))
    const selects = container.querySelectorAll('select')
    act(() => {
      // Font style → bold
      selects[1].value = 'bold'
      selects[1].dispatchEvent(new Event('change', { bubbles: true }))
    })
    const ok = [...container.querySelectorAll('button')].find((b) => b.textContent === '确定')!
    act(() => ok.click())
    expect(editor.isActive('bold')).toBe(true)
    expect(editor.getAttributes('docTextStyle').sizeHalfPoints).toBe(22)
    unmount()
    editor.destroy()
  })
})

describe('ParagraphDialog', () => {
  it('applies alignment and spacing to the paragraph on OK', () => {
    const editor = createEditor()
    select(editor, 2, 2)
    const { container, unmount } = render(createElement(ParagraphDialog, { editor, onClose: noop }))
    const selects = container.querySelectorAll('select')
    act(() => {
      selects[0].value = 'center'
      selects[0].dispatchEvent(new Event('change', { bubbles: true }))
    })
    const ok = [...container.querySelectorAll('button')].find((b) => b.textContent === '确定')!
    act(() => ok.click())
    expect(editor.getAttributes('docParagraph').align).toBe('center')
    unmount()
    editor.destroy()
  })

  it('resolves visual left/right against the paragraph direction (LTR)', () => {
    const editor = createEditor({ align: 'right' })
    select(editor, 2, 2)
    const { container, unmount } = render(createElement(ParagraphDialog, { editor, onClose: noop }))
    const alignSelect = container.querySelector('select')!
    expect(alignSelect.value).toBe('right')
    act(() => {
      alignSelect.value = 'left'
      alignSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const ok = [...container.querySelectorAll('button')].find((b) => b.textContent === '确定')!
    act(() => ok.click())
    // visual left is the start side in LTR → stored as null
    expect(editor.getAttributes('docParagraph').align).toBeNull()
    unmount()
    editor.destroy()
  })

  it('shows the start side as Right in RTL and stores visual left explicitly', () => {
    const editor = createEditor({ bidi: true })
    select(editor, 2, 2)
    const { container, unmount } = render(createElement(ParagraphDialog, { editor, onClose: noop }))
    const alignSelect = container.querySelector('select')!
    // unset align in an RTL paragraph renders right, so the dialog shows Right
    expect(alignSelect.value).toBe('right')
    act(() => {
      alignSelect.value = 'left'
      alignSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const ok = [...container.querySelectorAll('button')].find((b) => b.textContent === '确定')!
    act(() => ok.click())
    // visual left is the end side in RTL → stored explicitly
    expect(editor.getAttributes('docParagraph').align).toBe('left')
    unmount()
    editor.destroy()
  })

  it('clears the align attr when re-selecting the start side in RTL', () => {
    const editor = createEditor({ bidi: true, align: 'left' })
    select(editor, 2, 2)
    const { container, unmount } = render(createElement(ParagraphDialog, { editor, onClose: noop }))
    const alignSelect = container.querySelector('select')!
    expect(alignSelect.value).toBe('left')
    act(() => {
      alignSelect.value = 'right'
      alignSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const ok = [...container.querySelectorAll('button')].find((b) => b.textContent === '确定')!
    act(() => ok.click())
    expect(editor.getAttributes('docParagraph').align).toBeNull()
    unmount()
    editor.destroy()
  })
})
