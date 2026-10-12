import { useEffect, useRef, useState } from 'react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '#/components/ui/input-group'

/** A number box with a unit, applied a moment after typing stops (Enter applies at once). */
export function NumberField({
  label,
  suffix,
  step,
  placeholder,
  value,
  onCommit,
  onEnter,
}: {
  label: string
  suffix: string
  step: number
  placeholder?: string
  value: number | null
  onCommit: (value: number | null) => void
  onEnter?: () => void
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    setText((cur) =>
      cur !== '' && Number(cur) === value
        ? cur
        : value == null
          ? ''
          : String(value),
    )
  }, [value])
  useEffect(() => () => clearTimeout(timer.current), [])
  const commit = (s: string) =>
    onCommit(s === '' || !Number.isFinite(Number(s)) ? null : Number(s))
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <InputGroup>
        <InputGroupInput
          type="number"
          min={0}
          step={step}
          inputMode="numeric"
          value={text}
          placeholder={placeholder}
          className="tabular"
          onChange={(e) => {
            const v = e.target.value
            setText(v)
            clearTimeout(timer.current)
            timer.current = setTimeout(() => commit(v), 300)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            clearTimeout(timer.current)
            commit(text)
            onEnter?.()
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText className="text-[13px]">{suffix}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </label>
  )
}
