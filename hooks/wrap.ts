export const linesWhenWrapped = (text: string, width: number) => {
  const room = Math.max(1, width)
  let lines = 1
  let used = 0

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const length = [...word].length
    const needed = used === 0 ? length : used + 1 + length

    if (needed <= room) {
      used = needed
      continue
    }

    lines += used === 0 ? 0 : 1
    lines += Math.floor(Math.max(0, length - 1) / room)
    used = length % room || room
  }

  return lines
}
