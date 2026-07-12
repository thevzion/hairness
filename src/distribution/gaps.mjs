import { HairnessError } from '../core/errors.mjs'

export function nextUnansweredGap(gaps, answers) {
  return gaps.find((gap) => answers[gap.id] === undefined) ?? null
}

export function assertGapAnswer(gap, value, code = 'gap_answer_invalid') {
  if (!gap.allowCustom && !gap.options.some((option) => option.value === value)) {
    throw new HairnessError(code, `Invalid value for ${gap.id}: ${value}`, { exitCode: 2 })
  }
  return value
}

export function uniqueCandidates(values) {
  const seen = new Set()
  return values.filter((value) => {
    const key = JSON.stringify(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
