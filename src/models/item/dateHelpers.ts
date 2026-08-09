export function formatDateShort(value: string | number): {
  display: string
  full: string
} {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return { display: '-', full: '-' }
  }

  // Краткая форма: авг. 2026 (дата без времени, точка после месяца без "г.")
  const datePart = date.toLocaleDateString('ru-RU', {
    month: 'short',
    year: 'numeric'
  })

  const display = datePart

  // Полная форма: ДД.ММ.ГГГГ ЧЧ:ММ
  const full = date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

  return { display, full }
}
