/** Display actual stock dates only; statistical/sync dates are not fallbacks. */
export function inventoryDateLabel(earliest: string | null, latest: string | null, missing = 0): string {
  if (!earliest || !latest) return '未提供'
  const label = earliest === latest ? earliest : `${earliest} 至 ${latest}`
  return missing > 0 ? `${label}（部分未提供）` : label
}
